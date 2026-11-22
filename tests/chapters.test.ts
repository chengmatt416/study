import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import JSZip from "jszip";
import { testDatabase } from "./helpers/d1";
import { callApi } from "../src/worker/mcp/internal";
import { enforceAccess, readableBookFile } from "../src/worker/lib/access";
import chapters from "../src/worker/routes/chapters";
import type { AppEnv } from "../src/worker/lib/types";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { materialFormat, materialPage, studyPlan, type ChapterDetail, type ChapterSummary } from "../src/shared/chapter";
import { pptxToMarkdown } from "../src/shared/zip";
import type { ContentItem } from "../src/shared/content";

const user = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const admin = { ...user, id: "admin", email: "admin@test.example", role: "admin" as const };
const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;

function bucket() {
  const objects = new Map<string, { data: Uint8Array; type?: string }>();
  return {
    objects,
    async put(key: string, value: ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }) {
      const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { data, type: options?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { body: new Blob([o.data.slice()]).stream(), httpMetadata: { contentType: o.type }, text: async () => new TextDecoder().decode(o.data) } : null;
    },
    async delete(keys: string | string[]) { for (const key of [keys].flat()) objects.delete(key); },
  };
}

describe("chapters", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  let r2: ReturnType<typeof bucket>;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  /** Multipart requests go straight to the chapter routes behind the same access middleware. */
  const upload = async (chapterId: string, file: File, text: string, who = user) => {
    const app = new Hono<AppEnv>().basePath("/api");
    app.use("*", async (c, next) => { c.set("user", who); await next(); });
    app.use("*", enforceAccess);
    app.route("/chapters", chapters);
    app.onError((err) => err instanceof HTTPException ? err.getResponse() : Response.json({ error: String(err) }, { status: 500 }));
    const form = new FormData(); form.set("file", file); form.set("text", text); form.set("sections", "2");
    return app.fetch(new Request(`https://t/api/chapters/${chapterId}/materials`, { method: "POST", body: form }), env, ctx);
  };
  beforeEach(() => {
    fixture = testDatabase();
    for (const who of [user, other, admin]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,?,1)").run(who.email, who.role);
    }
    fixture.db.exec(`INSERT INTO subjects(id,slug,name,sort) VALUES ('chem','chem','Chemistry',1),('phys','phys','Physics',2);
      INSERT INTO documents(id,slug,title,kind,subject_id,status,visibility,created_by,created_at,updated_at) VALUES
        ('note','kinetics','Kinetics notes','note','chem','published','shared','owner',1,5),
        ('exam','kinetics-exam','Kinetics exam','exam','chem','published','shared','owner',1,5),
        ('mine','secret','My private notes','note','chem','published','private','owner',1,6),
        ('phys-note','waves','Waves','note','phys','published','shared','owner',1,6);
      INSERT INTO decks(id,title,subject_id,visibility,created_by,created_at,updated_at) VALUES ('deck','Kinetics words','chem','shared','owner',1,3);`);
    r2 = bucket();
    env = { DB: fixture.DB, BUCKET: r2 } as unknown as Env;
  });
  afterEach(() => fixture.db.close());

  it("gathers notes, exams and decks, hides other people's private content, and keeps content when the chapter goes", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Reaction kinetics", code: "R2.2", visibility: "shared" });
    for (const [type, cid] of [["document", "kinetics"], ["document", "kinetics-exam"], ["deck", "deck"], ["document", "secret"]]) await api("POST", `/api/chapters/${id}/links`, { type, id: cid });
    await expect(api("POST", `/api/chapters/${id}/links`, { type: "document", id: "waves" })).rejects.toMatchObject({ status: 422 });
    const mine = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`)).chapter;
    expect(mine.note_list.map((n) => n.slug).sort()).toEqual(["kinetics", "secret"]);
    expect(mine.exam_list.map((e) => e.slug)).toEqual(["kinetics-exam"]);
    expect(mine.deck_list.map((d) => d.id)).toEqual(["deck"]);
    const theirs = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`, undefined, other)).chapter;
    // The owner's private note went shared with the chapter, so the other learner sees it too.
    expect(theirs.note_list.map((n) => n.slug).sort()).toEqual(["kinetics", "secret"]);
    expect(theirs.can_edit).toBe(false);
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters?subject_id=chem", undefined, other)).chapters[0]).toMatchObject({ notes: 2, exams: 1, decks: 1, preference: null });
    await expect(api("PUT", `/api/chapters/${id}`, { title: "x" }, other)).rejects.toMatchObject({ status: 403 });
    await expect(api("DELETE", `/api/chapters/${id}`, undefined, other)).rejects.toMatchObject({ status: 403 });
    await api("DELETE", `/api/chapters/${id}`);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM content_links").get()).toEqual({ n: 0 });
  });

  it("deleting a chapter deletes the content inside it that the user may delete, and only takes out the rest", async () => {
    fixture.db.exec(`INSERT INTO decks(id,title,subject_id,visibility,created_by,created_at,updated_at) VALUES ('my-deck','My words','chem','private','owner',1,1);
      INSERT INTO documents(id,slug,title,kind,subject_id,status,visibility,created_by,created_at,updated_at) VALUES ('theirs','theirs','Their notes','note','chem','published','shared','other',1,1);`);
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics", visibility: "shared" });
    const { id: second } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Equilibrium", visibility: "shared" });
    for (const [type, cid] of [["document", "kinetics"], ["document", "kinetics-exam"], ["deck", "deck"], ["deck", "my-deck"], ["document", "secret"]]) await api("POST", `/api/chapters/${id}/links`, { type, id: cid });
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "theirs" }, other);
    await api("POST", `/api/chapters/${second}/links`, { type: "document", id: "secret" });
    await upload(id, new File(["x"], "notes.md"), "# 教材");
    const plan = await api<{ remove: { id: string }[]; keep: { id: string; reason: string }[]; materials: number }>("GET", `/api/chapters/${id}/deletion`);
    // "my-deck" is private, but it went shared when it joined this shared chapter, so only an admin can delete it now.
    expect(plan.remove.map((i) => i.id).sort()).toEqual(["exam", "note"]);
    expect(Object.fromEntries(plan.keep.map((i) => [i.id, i.reason]))).toEqual({ deck: "共享字卡組只有管理員能刪除", "my-deck": "共享字卡組只有管理員能刪除", theirs: "不是你建立的", mine: "也在其他章節" });
    expect(plan.materials).toBe(1);
    await expect(api("GET", `/api/chapters/${id}/deletion`, undefined, other)).rejects.toMatchObject({ status: 403 });

    const done = await api<{ deleted: { id: string }[]; kept: { id: string }[] }>("DELETE", `/api/chapters/${id}`);
    expect(done.deleted.map((i) => i.id).sort()).toEqual(["exam", "note"]);
    const status = (docId: string) => (fixture.db.prepare("SELECT status FROM documents WHERE id=?").get(docId) as { status: string }).status;
    expect([status("note"), status("exam"), status("mine"), status("theirs")]).toEqual(["archived", "archived", "published", "published"]);
    expect(fixture.db.prepare("SELECT id FROM decks ORDER BY id").all()).toEqual([{ id: "deck" }, { id: "my-deck" }]);
    expect(r2.objects.size).toBe(0);
    // The other chapter keeps its note.
    expect((await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${second}`)).chapter.note_list.map((n) => n.id)).toEqual(["mine"]);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('document.delete','deck.delete')").get()).toEqual({ n: 2 });
  });

  it("content the owner put in a chapter follows the chapter's visibility, and a shared chapter holds it", async () => {
    fixture.db.exec(`INSERT INTO documents(id,slug,title,kind,subject_id,status,visibility,created_by,created_at,updated_at) VALUES
      ('shared-chem','shared-chem','Shared chem','note','chem','published','shared','owner',1,1);`);
    const vis = (table: "documents" | "decks", id: string) => (fixture.db.prepare(`SELECT visibility FROM ${table} WHERE id=?`).get(id) as { visibility: string }).visibility;
    const toggle = (kind: "documents" | "decks", slug: string, visibility: string) => api("PUT", `/api/${kind}/${slug}/visibility`, { visibility });

    // A private chapter takes the owner's shared notes, exams and decks in as private.
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics" });
    expect(await api<{ visibility: string; visibility_changed: boolean }>("POST", `/api/chapters/${id}/links`, { type: "document", id: "kinetics" })).toMatchObject({ visibility: "private", visibility_changed: true });
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "kinetics-exam" });
    await api("POST", `/api/chapters/${id}/links`, { type: "deck", id: "deck" });
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "mine" });
    expect([vis("documents", "note"), vis("documents", "exam"), vis("decks", "deck"), vis("documents", "mine")]).toEqual(["private", "private", "private", "private"]);

    // While the chapter is private, the owner's content cannot be made shared on its own.
    await expect(toggle("documents", "kinetics", "shared")).rejects.toMatchObject({ status: 409 });
    await expect(toggle("decks", "deck", "shared")).rejects.toMatchObject({ status: 409 });

    // Going shared shares everything the owner put in it, including the private note.
    const shared = await api<{ visibility: string; content_updated: unknown[] }>("PUT", `/api/chapters/${id}`, { visibility: "shared" });
    expect(shared.content_updated).toHaveLength(4);
    expect([vis("documents", "note"), vis("documents", "exam"), vis("decks", "deck"), vis("documents", "mine")]).toEqual(["shared", "shared", "shared", "shared"]);
    await expect(toggle("documents", "kinetics", "private")).rejects.toMatchObject({ status: 409 });
    await expect(toggle("decks", "deck", "private")).rejects.toMatchObject({ status: 409 });

    // A second shared chapter holds the note: the first chapter cannot go private without hiding it there.
    const { id: second } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Equilibrium", visibility: "shared" });
    await api("POST", `/api/chapters/${second}/links`, { type: "document", id: "kinetics" });
    await expect(api("PUT", `/api/chapters/${id}`, { visibility: "private" })).rejects.toMatchObject({ status: 409 });
    expect(vis("documents", "note")).toBe("shared");
    await api("DELETE", `/api/chapters/${second}/links/document/note`);
    const back = await api<{ visibility: string; content_updated: { id: string }[] }>("PUT", `/api/chapters/${id}`, { visibility: "private" });
    expect(back.content_updated.map((item) => item.id).sort()).toEqual(["deck", "exam", "mine", "note"]);
    expect([vis("documents", "note"), vis("documents", "exam"), vis("decks", "deck"), vis("documents", "mine")]).toEqual(["private", "private", "private", "private"]);
    // Other shared chapters are untouched, and their own content is not moved by this chapter.
    expect(vis("documents", "shared-chem")).toBe("shared");

    // Adding private content to a shared chapter makes it shared; adding shared content to a private chapter makes it private.
    const { id: open } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Open", visibility: "shared" });
    expect(await api<{ visibility_changed: boolean; visibility: string }>("POST", `/api/chapters/${open}/links`, { type: "document", id: "mine" })).toMatchObject({ visibility: "shared", visibility_changed: true });
    expect(vis("documents", "mine")).toBe("shared");
    await expect(api("POST", `/api/chapters/${id}/links`, { type: "document", id: "shared-chem" })).resolves.toMatchObject({ visibility: "private", visibility_changed: true });
    await api("POST", `/api/chapters/${open}/links`, { type: "document", id: "shared-chem" });
    // shared-chem is now in the open shared chapter, so the private chapter cannot take it.
    const { id: priv } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Private notes" });
    await expect(api("POST", `/api/chapters/${priv}/links`, { type: "document", id: "shared-chem" })).rejects.toMatchObject({ status: 409 });
    // Content that is not the owner's keeps its own setting when the owner links it.
    fixture.db.exec(`INSERT INTO documents(id,slug,title,kind,subject_id,status,visibility,created_by,created_at,updated_at) VALUES ('theirs-shared','theirs-shared','Their shared','note','chem','published','shared','other',1,1);`);
    expect(await api<{ visibility: string; visibility_changed: boolean }>("POST", `/api/chapters/${id}/links`, { type: "document", id: "theirs-shared" })).toMatchObject({ visibility: "shared", visibility_changed: false });
    expect(vis("documents", "theirs-shared")).toBe("shared");
  });

  it("a chapter's PDF opens in the default ebook reader as one book record that follows the chapter's visibility", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics", visibility: "shared" });
    const uploaded = await upload(id, new File(["%PDF-1.7 fake"], "kinetics.pdf"), "## 第 1 頁\n\nVelocity");
    expect(uploaded.status).toBe(201);
    const { id: materialId } = (await uploaded.json()) as { id: string };
    const { book_id } = await api<{ book_id: string }>("POST", `/api/chapters/${id}/materials/${materialId}/reader`);
    // Opening it again reuses the same record.
    expect(await api<{ book_id: string }>("POST", `/api/chapters/${id}/materials/${materialId}/reader`)).toEqual({ book_id });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM books WHERE kind='chapter'").get()).toEqual({ n: 1 });
    // It is not a library book: not on the shelf, not in the content library.
    expect((await api<{ books: { id: string }[] }>("GET", "/api/books")).books.map((b) => b.id)).not.toContain(book_id);
    expect((await api<{ items: { id: string }[] }>("GET", "/api/content?view=all&limit=100")).items.map((i) => i.id)).not.toContain(book_id);
    // Learners who can see the chapter open it like any book, with its own annotations and progress.
    const detail = await api<{ book: { kind: string; chapter: { id: string } | null } }>("GET", `/api/books/${book_id}`, undefined, other);
    expect(detail.book).toMatchObject({ kind: "chapter", chapter: { id } });
    await expect(api("GET", `/api/books/${book_id}/annotations`, undefined, other)).resolves.toBeDefined();
    // The file follows the chapter: a private chapter's PDF is the owner's only.
    expect(await readableBookFile(env, other, book_id)).toBe(`chapter-materials/${id}/${materialId}/original.pdf`);
    await expect(api("DELETE", `/api/books/${book_id}`, undefined, admin)).rejects.toMatchObject({ status: 400 });
    await api("PUT", `/api/chapters/${id}`, { visibility: "private" });
    await expect(api("GET", `/api/books/${book_id}`, undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("GET", `/api/books/${book_id}`, undefined, admin)).rejects.toMatchObject({ status: 404 });
    expect(await readableBookFile(env, other, book_id)).toBeNull();
    expect(await readableBookFile(env, admin, book_id)).toBeNull();
    expect(await readableBookFile(env, user, book_id)).toBe(`chapter-materials/${id}/${materialId}/original.pdf`);
    // Deleting the book from the shelf is refused; deleting the material removes its record.
    await api("DELETE", `/api/chapters/${id}/materials/${materialId}`);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM books WHERE kind='chapter'").get()).toEqual({ n: 0 });
  });

  it("remembers each learner's onboarding choice and builds the study path from it", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics", visibility: "shared" });
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "kinetics" });
    await api("POST", `/api/chapters/${id}/links`, { type: "deck", id: "deck" });
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "kinetics-exam" });
    await expect(api("PUT", `/api/chapters/${id}/preference`, { study_mode: "video", cards_before_exam: true })).rejects.toMatchObject({ status: 400 });
    await api("PUT", `/api/chapters/${id}/preference`, { study_mode: "summary", cards_before_exam: true });
    await api("PUT", `/api/chapters/${id}/preference`, { study_mode: "course", cards_before_exam: false }, other);
    const mine = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`)).chapter;
    expect(mine.preference).toEqual({ study_mode: "summary", cards_before_exam: true });
    expect(studyPlan(mine, mine.preference!).map((s) => [s.kind, s.ready])).toEqual([["summary", true], ["cards", true], ["exam", true]]);
    const theirs = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`, undefined, other)).chapter;
    // No course yet: the course step falls back to the notes; no flashcards step was chosen.
    expect(studyPlan(theirs, theirs.preference!).map((s) => [s.kind, s.ready, s.url])).toEqual([["course", false, "/notes/kinetics"], ["exam", true, "/exams/kinetics-exam"]]);
    // An exam waiting for the chatbot's IB review is not offered yet.
    fixture.db.exec("INSERT INTO exam_reviews(document_id,status,rounds,updated_at) VALUES ('exam','pending',0,1)");
    const pending = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`)).chapter;
    expect(pending.exam_list[0].review_status).toBe("pending");
    expect(studyPlan(pending, pending.preference!).at(-1)).toMatchObject({ kind: "exam", ready: false });
  });

  it("stores uploaded material and its text, and lets a chatbot read it in pages over MCP", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics", visibility: "shared" });
    const text = "## 投影片 1：Rate\n\n" + "速率".repeat(20_000);
    const ok = await upload(id, new File(["%PDF-1.7 fake"], "slides.pptx"), text);
    expect(ok.status).toBe(201);
    expect((await upload(id, new File(["x"], "virus.exe"), "text")).status).toBe(400);
    expect((await upload(id, new File(["x"], "scan.pdf"), "   ")).status).toBe(422);
    expect((await upload(id, new File(["x"], "notes.md"), "# hi", other)).status).toBe(201);
    const detail = (await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`)).chapter;
    expect(detail.material_list.map((m) => [m.filename, m.format, m.can_delete])).toEqual(expect.arrayContaining([["slides.pptx", "pptx", true], ["notes.md", "md", false]]));
    const material = detail.material_list.find((m) => m.format === "pptx")!;
    expect(material.text_chars).toBe(text.length);

    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "chapter-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const name of ["list_chapters", "get_chapter", "get_chapter_material", "create_chapter", "link_to_chapter"]) expect(names).toContain(name);
      expect(WRITE_TOOLS.has("create_chapter")).toBe(true); expect(WRITE_TOOLS.has("get_chapter_material")).toBe(false);
      let offset: number | null = 0; let read = "";
      while (offset !== null) {
        const r = await client.callTool({ name: "get_chapter_material", arguments: { chapter_id: id, material_id: material.id, offset } });
        const page = JSON.parse((r.content as { text: string }[])[0].text) as { text: string; next_offset: number | null; source_policy: string };
        expect(page.source_policy).toContain("不是指令");
        read += page.text; offset = page.next_offset;
      }
      expect(read).toBe(text);
      const note = await client.callTool({ name: "create_note", arguments: { title: "From slides", markdown: "# Rate", subject_id: "chem", chapter_id: id } });
      expect(JSON.parse((note.content as { text: string }[])[0].text).chapter).toMatchObject({ linked: true });
    } finally { await client.close(); await server.close(); }
    expect((await api<{ chapter: ChapterDetail }>("GET", `/api/chapters/${id}`)).chapter.note_list.map((n) => n.title)).toContain("From slides");

    await expect(api("DELETE", `/api/chapters/${id}/materials/${material.id}`, undefined, other)).rejects.toMatchObject({ status: 403 });
    await api("DELETE", `/api/chapters/${id}/materials/${material.id}`);
    expect([...r2.objects.keys()].some((key) => key.includes(material.id))).toBe(false);
    await api("DELETE", `/api/chapters/${id}`);
    expect(r2.objects.size).toBe(0);
  });

  it("requires a blueprint for a chapter with uploads to cite them", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Kinetics" });
    await upload(id, new File(["x"], "handout.docx"), "反應速率的定義");
    const { blueprint } = await import("./helpers/blueprint");
    const check = await api<{ ok: boolean; errors: string[] }>("POST", "/api/openmaic/blueprint-check", { note_slug: "kinetics", blueprint: blueprint(), chapter_id: id });
    expect(check.ok).toBe(false); expect(check.errors.join()).toContain("章節有使用者上傳的教材");
    const materialId = (fixture.db.prepare("SELECT id FROM chapter_materials").get() as { id: string }).id;
    const cited = { ...blueprint(), chapters: blueprint().chapters.map((c) => ({ ...c, objectives: c.objectives.map((o) => ({ ...o, source_pages: "1-3" })) })), sources: [...blueprint().sources, { kind: "chapter_material", book_id: materialId, title: "handout.docx", pages: "1-3", used_for: "老師講義決定例題與順序" }] };
    const passed = await api<{ ok: boolean; errors: string[] }>("POST", "/api/openmaic/blueprint-check", { note_slug: "kinetics", blueprint: cited, chapter_id: id });
    expect(passed.errors).toEqual([]);
  });

  it("starts empty, keeps private chapters to their creator everywhere, and refuses duplicates", async () => {
    // Rows of the old topics table have no creator and are never listed.
    fixture.db.exec("INSERT INTO topics(id,subject_id,title,sort) VALUES ('legacy','chem','Stoichiometry (old seed)',1)");
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters")).chapters).toEqual([]);
    await expect(api("GET", "/api/chapters/legacy")).rejects.toMatchObject({ status: 404 });

    const mine = await api<{ id: string; visibility: string }>("POST", "/api/chapters", { subject_id: "chem", title: "My kinetics" });
    expect(mine.visibility).toBe("private");
    await upload(mine.id, new File(["x"], "notes.md"), "# 私人筆記");
    const materialId = (fixture.db.prepare("SELECT id FROM chapter_materials").get() as { id: string }).id;
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters")).chapters.map((c) => [c.title, c.visibility, c.mine])).toEqual([["My kinetics", "private", true]]);
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters", undefined, other)).chapters).toEqual([]);
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters", undefined, admin)).chapters).toEqual([]);
    for (const [method, path, body] of [["GET", `/api/chapters/${mine.id}`], ["GET", `/api/chapters/${mine.id}/materials/${materialId}/text`], ["POST", `/api/chapters/${mine.id}/links`, { type: "document", id: "kinetics" }], ["PUT", `/api/chapters/${mine.id}/preference`, { study_mode: "summary", cards_before_exam: true }], ["DELETE", `/api/chapters/${mine.id}`]] as const)
      await expect(api(method, path, body, other)).rejects.toMatchObject({ status: 404 });
    expect((await upload(mine.id, new File(["x"], "b.md"), "# b", other)).status).toBe(404);
    await expect(api("POST", "/api/openmaic/blueprint-check", { note_slug: "kinetics", blueprint: {}, chapter_id: mine.id }, other)).rejects.toMatchObject({ status: 404 });

    await expect(api("POST", "/api/chapters", { subject_id: "chem", title: " my KINETICS " })).rejects.toMatchObject({ status: 409 });
    // Someone else may use the same name for their own private chapter: they cannot see this one.
    expect(await api("POST", "/api/chapters", { subject_id: "chem", title: "My kinetics" }, other)).toMatchObject({ visibility: "private" });
  });

  it("lets the creator manage a chapter: rename, make public or private, delete", async () => {
    const { id } = await api<{ id: string }>("POST", "/api/chapters", { subject_id: "chem", title: "Rates" });
    await api("PUT", `/api/chapters/${id}`, { title: "Reaction rates", visibility: "shared" });
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters", undefined, other)).chapters.map((c) => [c.title, c.visibility, c.mine, c.can_edit])).toEqual([["Reaction rates", "shared", false, false]]);
    // An admin may manage a shared chapter but not switch who sees it.
    await api("PUT", `/api/chapters/${id}`, { description: "admin note" }, admin);
    await expect(api("PUT", `/api/chapters/${id}`, { visibility: "private" }, admin)).rejects.toMatchObject({ status: 403 });
    await expect(api("PUT", `/api/chapters/${id}`, { title: "x" }, other)).rejects.toMatchObject({ status: 403 });
    // Someone else's note in the shared chapter keeps it shared.
    fixture.db.exec("INSERT INTO documents(id,slug,title,kind,subject_id,status,visibility,created_by,created_at,updated_at) VALUES ('theirs','theirs','Their notes','note','chem','published','shared','other',1,1)");
    await api("POST", `/api/chapters/${id}/links`, { type: "document", id: "theirs" }, other);
    await expect(api("PUT", `/api/chapters/${id}`, { visibility: "private" })).rejects.toMatchObject({ status: 409 });
    await api("DELETE", `/api/chapters/${id}/links/document/theirs`, undefined, other);
    await api("PUT", `/api/chapters/${id}`, { visibility: "private" });
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters", undefined, other)).chapters).toEqual([]);
    await api("DELETE", `/api/chapters/${id}`);
    expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters")).chapters).toEqual([]);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE id='theirs'").get()).toEqual({ n: 1 });
  });

  it("lets a chatbot manage chapters over MCP: rename, share, unlink, remove material, preview and delete", async () => {
    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "chapter-mcp", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); const text = (r.content as { text: string }[])[0].text; if (r.isError) throw new Error(text); return JSON.parse(text); };
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const name of ["update_chapter", "delete_chapter", "unlink_from_chapter", "delete_chapter_material"]) { expect(names).toContain(name); expect(WRITE_TOOLS.has(name)).toBe(true); }
      expect(WRITE_TOOLS.has("get_chapter_deletion_plan")).toBe(false);
      const made = await call("create_chapter", { subject_id: "chem", title: "Rates" });
      expect(made.visibility).toBe("private");
      const id = made.chapter_id as string;
      await call("link_to_chapter", { chapter_id: id, type: "note", id: "kinetics" });
      await call("link_to_chapter", { chapter_id: id, type: "exam", id: "kinetics-exam" });
      await upload(id, new File(["x"], "a.md"), "# a");
      expect(await call("update_chapter", { chapter_id: id, title: "Reaction rates", visibility: "shared" })).toMatchObject({ ok: true, visibility: "shared" });
      expect((await api<{ chapters: ChapterSummary[] }>("GET", "/api/chapters", undefined, other)).chapters.map((c) => c.title)).toEqual(["Reaction rates"]);
      await call("unlink_from_chapter", { chapter_id: id, type: "note", id: "note" });
      const detail = await call("get_chapter", { chapter_id: id });
      expect(detail.chapter.note_list).toEqual([]);
      await call("delete_chapter_material", { chapter_id: id, material_id: detail.chapter.material_list[0].id });
      const plan = await call("get_chapter_deletion_plan", { chapter_id: id });
      expect(plan).toMatchObject({ remove: [{ id: "exam" }], keep: [], materials: 0 });
      await expect(call("delete_chapter", { chapter_id: id })).rejects.toThrow();
      expect(await call("delete_chapter", { chapter_id: id, confirm: true })).toMatchObject({ ok: true, deleted: [{ id: "exam" }] });
      expect((fixture.db.prepare("SELECT status FROM documents WHERE id='exam'").get() as { status: string }).status).toBe("archived");
      // Unlinked content was only taken out, never deleted.
      expect((fixture.db.prepare("SELECT status FROM documents WHERE id='note'").get() as { status: string }).status).toBe("published");
    } finally { await client.close(); await server.close(); }
  });

  it("offers delete in the content library only where the delete routes allow it", async () => {
    fixture.db.exec("INSERT INTO decks(id,title,visibility,created_by,created_at,updated_at) VALUES ('private-deck','Mine','private','owner',1,3)");
    const items = (await api<{ items: ContentItem[] }>("GET", "/api/content?view=all")).items;
    const can = Object.fromEntries(items.map((item) => [item.id, item.can_delete]));
    expect(can).toMatchObject({ note: true, exam: true, mine: true, deck: false, "private-deck": true });
    const theirs = Object.fromEntries((await api<{ items: ContentItem[] }>("GET", "/api/content?view=all", undefined, other)).items.map((item) => [item.id, item.can_delete]));
    expect(theirs).toMatchObject({ note: false, deck: false });
    expect(Object.values(Object.fromEntries((await api<{ items: ContentItem[] }>("GET", "/api/content?view=all", undefined, admin)).items.map((item) => [item.id, item.can_delete])))).not.toContain(false);
  });
});

describe("material text", () => {
  it("reads pptx slides in order with their speaker notes", async () => {
    const zip = new JSZip();
    const slide = (texts: string[]) => `<p:sld><p:cSld><p:spTree>${texts.map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("")}</p:spTree></p:cSld></p:sld>`;
    zip.file("ppt/slides/slide2.xml", slide(["Rate law", "rate = k[A]^m"]));
    zip.file("ppt/slides/slide10.xml", slide(["Summary"]));
    zip.file("ppt/slides/slide1.xml", slide(["Kinetics &amp; rates", "Collision theory"]));
    zip.file("ppt/notesSlides/notesSlide1.xml", `<p:notes><a:p><a:r><a:t>Start with a demo</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>`);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const { markdown, sections } = await pptxToMarkdown(bytes);
    expect(sections).toBe(3);
    expect(markdown).toBe("## 投影片 1：Kinetics & rates\n\n- Collision theory\n\n> 講者備註：Start with a demo\n\n## 投影片 2：Rate law\n\n- rate = k[A]^m\n\n## 投影片 10：Summary");
  });
  it("knows the formats and pages long text without splitting characters", () => {
    expect(["a.PPTX", "b.htm", "c.markdown", "d.pdf", "e.docx", "f.txt"].map(materialFormat)).toEqual(["pptx", "html", "md", "pdf", "docx", null]);
    const text = "a".repeat(9) + "😀" + "b";
    const first = materialPage(text, 0, 10);
    expect(first.text).toBe("a".repeat(9));
    expect(materialPage(text, first.next_offset!, 10)).toMatchObject({ text: "😀b", next_offset: null });
  });
});
