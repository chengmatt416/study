import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/worker/lib/types";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { testDatabase } from "./helpers/d1";
import { callApi, callApiResponse } from "../src/worker/mcp/internal";
import { buildServer } from "../src/worker/mcp/server";
import { enforceAccess, requireDocumentAccess, requireDocumentWrite, userAccess } from "../src/worker/lib/access";
import { generatedCourse } from "./fixtures/course-generation";
import { requireAdmin } from "../src/worker/lib/auth";
import adminRoutes from "../src/worker/routes/admin";
const user = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const admin = { ...user, id: "admin", email: "admin@test.example", role: "admin" as const };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
const paper = '::::question{#q1}\nChoose one.\n:::choices\n- (A) Yes\n- (B) No\n:::\n::::';
const answers = { schema: "exam-answers/v1", questions: [{ id: "q1", type: "single_choice", answer: "A", points: 1 }] };
describe("私人內容與共享寫入權限", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const noSharedWrite = () => fixture.db.exec("INSERT OR REPLACE INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','feature','shared_write',0)");
  const note = (visibility: "private" | "shared" = "private") => api<{ id: string; slug: string }>("POST", "/api/documents", { kind: "note", title: "Hidden private subject", body_md: "# Private body", visibility });
  beforeEach(() => {
    fixture = testDatabase();
    for (const who of [user, other, admin]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,?,1)").run(who.email, who.role);
    }
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1)");
    fixture.db.exec("INSERT INTO access_group_members(group_id,email) VALUES ('students','owner@test.example')");
    fixture.db.exec("INSERT INTO documents(id,slug,title,kind,status,created_by,created_at,updated_at) VALUES ('shared','shared','Shared note','note','published','owner',1,1),('exam','exam','Shared exam','exam','published','owner',1,1)");
    fixture.db.exec("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('shared-rev','shared','# Shared','import',1),('exam-rev','exam','Exam','import',1)");
    fixture.db.exec("UPDATE documents SET current_revision_id='shared-rev',baseline_revision_id='shared-rev' WHERE id='shared'");
    fixture.db.exec("UPDATE documents SET current_revision_id='exam-rev',baseline_revision_id='exam-rev' WHERE id='exam'");
    fixture.db.exec("INSERT INTO decks(id,title,created_by,created_at,updated_at) VALUES ('shared-deck','Shared deck','owner',1,1)");
    fixture.db.exec("INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES ('shared-card','shared-deck',1,'Q','A',1,1)");
    fixture.db.exec("INSERT INTO books(id,title,status,r2_key,created_at,updated_at) VALUES ('book','Book','ready','books/book.pdf',1,1)");
    env = { DB: fixture.DB, DOC_ROOM: { idFromName: (id: string) => id, get: () => ({ fetch: vi.fn(async () => new Response('ok')) }) }, BUCKET: { get: vi.fn(async () => ({ body: new Blob(['image']).stream(), size: 5, httpMetadata: { contentType: "image/png" } })) } } as unknown as Env;
  });
  afterEach(() => fixture.db.close());

  it("共享寫入停用後，直接 API 不能修改共享文件、卡片、答案、課程或共享檔案", async () => {
    noSharedWrite();
    for (const [method, path, body] of [
      ["PUT", "/api/documents/shared", { title: "Changed" }], ["POST", "/api/documents/shared/revisions", { body_md: "Changed", force: true }],
      ["DELETE", "/api/documents/shared", undefined], ["POST", "/api/decks/shared-deck/cards", { front: "New", back: "A" }],
      ["PUT", "/api/decks/cards/shared-card", { front: "Changed", back: "A" }], ["POST", "/api/decks/import/commit", { deck_id: "shared-deck", text: "Q :: Changed" }],
      ["POST", "/api/exams/exam/answers", { answers }], ["PUT", "/api/documents/shared/course", { course: generatedCourse(), expected_version: 0 }],
      ["POST", "/api/course-generations", { note_slug: "shared", topic: "Topic" }], ["POST", "/api/books/uploads", { title: "Booklet", kind: "booklet", size: 30 }],
    ] as const) await expect(api(method, path, body)).rejects.toMatchObject({ status: 403 });
    expect(fixture.db.prepare("SELECT title FROM documents WHERE id='shared'").get()).toMatchObject({ title: "Shared note" });
  });
  it("仍可用書籤、閱讀進度、複習及個人字卡設定；僅禁止共享標注", async () => {
    noSharedWrite();
    expect(await api("PUT", "/api/books/book/progress", { page: 3 })).toHaveProperty("ok", true);
    expect(await api("POST", "/api/books/book/bookmarks", { page: 3, label: "Mine" })).toHaveProperty("id");
    expect(await api("PUT", "/api/decks/shared-deck/settings", { new_per_day: 5 })).toHaveProperty("ok", true);
    expect(await api("POST", "/api/reviews", { items: [{ id: "personal-review", card_id: "shared-card", rating: 3, mode: "smart", reviewed_at: Date.now() }] })).toHaveProperty("updated.shared-card");
    expect(await api("POST", "/api/books/book/annotations", { id: "private-ann", page: 1, type: "ink", data: {}, visibility: "private" })).toHaveProperty("id");
    await expect(api("POST", "/api/books/book/annotations", { id: "public-ann", page: 1, type: "ink", data: {}, visibility: "shared" })).rejects.toMatchObject({ status: 403 });
    fixture.db.exec("INSERT INTO annotations(id,book_id,user_id,page,type,data_json,visibility,created_at,updated_at) VALUES ('shared-ann','book','owner',1,'ink','{}','shared',1,1)");
    await expect(api("POST", "/api/books/book/annotations/batch", { create: [{ id: "shared-ann", page: 1, type: "ink", data: {}, visibility: "private" }] })).rejects.toMatchObject({ status: 403 });
    await expect(api("DELETE", "/api/books/book/annotations/shared-ann")).rejects.toMatchObject({ status: 403 });
  });
  it("被停用者預設建立私人內容，明確要求共享則拒絕；私人修訂立即成為基準", async () => {
    noSharedWrite();
    await expect(note("shared")).rejects.toMatchObject({ status: 403 });
    const created = await api<{ id: string; slug: string; visibility: string }>("POST", "/api/documents", { kind: "note", title: "My private note" });
    expect(created.visibility).toBe("private");
    await api("POST", `/api/documents/${created.slug}/revisions`, { body_md: "# Updated private note", force: true });
    expect(await api("GET", `/api/documents/${created.slug}`)).toMatchObject({ baseline: null, document: { visibility: "private" } });
    expect(await api("PUT", `/api/documents/${created.slug}/course`, { course: generatedCourse(), expected_version: 0 })).toHaveProperty("version", 1);
    expect(await requireDocumentWrite(env, user, created.id)).toBe(true);
    expect(await requireDocumentWrite(env, user, "shared")).toBe(false);
  });
  it("私人字卡可建立、編修與刪除，新增與修改不標記待管理員確認", async () => {
    noSharedWrite();
    const created = await api<{ id: string }>("POST", "/api/decks", { title: "Private deck" });
    const card = await api<{ id: string }>("POST", `/api/decks/${created.id}/cards`, { front: "Private Q", back: "Private A" });
    await api("PUT", `/api/decks/cards/${card.id}`, { front: "New Q", back: "New A" });
    const stored = fixture.db.prepare("SELECT front,back,baseline_front,baseline_back FROM cards WHERE id=?").get(card.id);
    expect(stored).toMatchObject({ front: "New Q", back: "New A", baseline_front: "New Q", baseline_back: "New A" });
    await expect(api("GET", `/api/decks/${created.id}`, undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("GET", `/api/decks/cards/${card.id}/revisions`, undefined, admin)).rejects.toMatchObject({ status: 404 });
    expect(await api("DELETE", `/api/decks/${created.id}`)).toHaveProperty("ok", true);
  });
  it("私人資料不出現在其他成員與管理員的清單、搜尋、修訂或管理待審", async () => {
    const created = await note();
    const deck = await api<{ deckId: string }>("POST", "/api/decks/import/commit", { title: "Hidden private deck", visibility: "private", text: "Privatecard :: Answer" });
    for (const who of [other, admin]) {
      for (const path of [`/api/documents/${created.slug}`, `/api/documents/${created.slug}/revisions`, `/api/documents/${created.slug}/course`, `/api/decks/${deck.deckId}`]) await expect(api("GET", path, undefined, who)).rejects.toMatchObject({ status: 404 });
      expect(JSON.stringify(await api("GET", "/api/documents", undefined, who))).not.toContain(created.slug);
      expect(JSON.stringify(await api("GET", "/api/search?q=private", undefined, who))).not.toContain("Hidden private");
      expect(JSON.stringify(await api("GET", "/api/decks", undefined, who))).not.toContain(deck.deckId);
      expect(await requireDocumentAccess(env, who, created.id)).toBe(false);
      expect(JSON.stringify(await userAccess(env, who))).not.toContain(created.slug);
    }
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id IN (?,?)").get(created.id, deck.deckId)).toMatchObject({ n: 0 });
  });
  it("私人試卷答案自動生效，擁有者可直接作答，不進入待審", async () => {
    noSharedWrite();
    const exam = await api<{ slug: string }>("POST", "/api/documents", { kind: "exam", title: "My exam", body_md: paper, visibility: "private" });
    const result = await api("POST", `/api/exams/${exam.slug}/answers`, { answers });
    expect(result.status).toBe("approved");
    expect(await api("POST", `/api/exams/${exam.slug}/attempts`)).toHaveProperty("id");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM answer_revisions WHERE status='pending'").get()).toMatchObject({ n: 0 });
  });
  it("管理端的待審、回收桶、稽核與群組目錄不洩漏私人內容，私人資料永不列入待審", async () => {
    const created = await note();
    const deck = await api<{ id: string }>("POST", "/api/decks", { title: "Secret private deck", visibility: "private" });
    fixture.db.prepare("INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES ('private-card',?,1,'Q','A',1,1)").run(deck.id);
    fixture.db.prepare("UPDATE documents SET baseline_revision_id=NULL WHERE id=?").run(created.id);
    fixture.db.prepare("INSERT INTO answer_revisions(id,document_id,answers_json,author_id,created_at) VALUES ('secret-answer',?,'{}','owner',1)").run(created.id);
    fixture.db.prepare("INSERT INTO audit_log(id,actor_id,action,entity,entity_id,meta_json,created_at) VALUES ('old-private-log','owner','document.edit','document',?,'{}',1)").run(created.id);
    const app = new Hono<AppEnv>().basePath("/api");
    app.use("*", async (c, next) => { c.set("user", admin); await next(); });
    app.use("*", enforceAccess);
    app.use("/admin/*", requireAdmin);
    app.route("/admin", adminRoutes);
    const get = async (path: string) => {
      const response = await app.request(`https://test/api/admin/${path}`, undefined, env, ctx);
      expect(response.status).toBe(200);
      return response.json() as Promise<Record<string, unknown>>;
    };
    for (const path of ["revisions/pending", "access-groups", "audit"]) {
      const result = JSON.stringify(await get(path));
      expect(result).not.toContain(created.id);
      expect(result).not.toContain(deck.id);
      expect(result).not.toContain("secret-answer");
    }
    const usage = await get("usage");
    expect(usage.counts).toMatchObject({ pending_answers: 0, docs_with_revisions: 0 });
    fixture.db.prepare("UPDATE documents SET status='archived' WHERE id=?").run(created.id);
    expect(JSON.stringify(await get("trash"))).not.toContain(created.id);
    // Even an admin's own private work has no moderation queue.
    fixture.db.prepare("UPDATE documents SET created_by='admin',status='published' WHERE id=?").run(created.id);
    expect(JSON.stringify(await get("revisions/pending"))).not.toContain(created.id);
  });
  it("私人附件對其他使用者（含管理員）不可見，不能透過共享筆記引用繞過", async () => {
    const created = await api<{ id: string; slug: string }>("POST", "/api/documents", { kind: "note", title: "Image private note", visibility: "private", body_md: "![secret](/api/assets/private-image)" });
    fixture.db.exec("INSERT INTO assets(id,r2_key,mime,size_bytes,uploaded_by,created_at) VALUES ('private-image','private.png','image/png',5,'owner',1)");
    expect((await callApiResponse(env, ctx, user, "GET", "/api/assets/private-image")).status).toBe(200);
    fixture.db.exec("UPDATE revisions SET body_md='![secret](/api/assets/private-image)' WHERE id='shared-rev'");
    for (const who of [other, admin]) expect((await callApiResponse(env, ctx, who, "GET", "/api/assets/private-image")).status).toBe(403);
    expect(await requireDocumentAccess(env, user, created.id)).toBe(true);
  });
  it("建立者一鍵切換筆記的私人與共享；別人看不到私人版本，也不能代為切換", async () => {
    const created = await note("private");
    const path = `/api/documents/${created.slug}`;
    await expect(api("GET", path, undefined, other)).rejects.toMatchObject({ status: 404 });
    expect(await api("PUT", `${path}/visibility`, { visibility: "shared" })).toMatchObject({ ok: true, visibility: "shared" });
    expect(await api("GET", path, undefined, other)).toMatchObject({ document: { visibility: "shared" }, baseline: null });
    await expect(api("PUT", `${path}/visibility`, { visibility: "private" }, other)).rejects.toMatchObject({ status: 403 });
    expect(await api("PUT", `${path}/visibility`, { visibility: "shared" })).toMatchObject({ visibility: "shared" });
    expect(await api("PUT", `${path}/visibility`, { visibility: "private" })).toMatchObject({ visibility: "private" });
    await expect(api("GET", path, undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("GET", path, undefined, admin)).rejects.toMatchObject({ status: 404 });
    await expect(api("PUT", `${path}/visibility`, { visibility: "public" })).rejects.toMatchObject({ status: 400 });
    await expect(api("PUT", path, { visibility: "shared" })).rejects.toMatchObject({ status: 400 });
  });
  it("一鍵切換字卡組的可見範圍，改為私人時目前卡片成為原版", async () => {
    fixture.db.exec("UPDATE cards SET front='Edited' WHERE id='shared-card'");
    expect(await api("PUT", "/api/decks/shared-deck/visibility", { visibility: "private" })).toMatchObject({ visibility: "private" });
    expect(fixture.db.prepare("SELECT baseline_front FROM cards WHERE id='shared-card'").get()).toMatchObject({ baseline_front: "Edited" });
    await expect(api("GET", "/api/decks/shared-deck", undefined, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("PUT", "/api/decks/shared-deck/visibility", { visibility: "shared" }, other)).rejects.toMatchObject({ status: 404 });
    expect(await api("PUT", "/api/decks/shared-deck/visibility", { visibility: "shared" })).toMatchObject({ visibility: "shared" });
    expect(await api("GET", "/api/decks/shared-deck", undefined, other)).toHaveProperty("deck");
  });
  it("群組停用共享寫入後，不能把私人內容改為共享，但仍可改為私人", async () => {
    const created = await note("private");
    noSharedWrite();
    await expect(api("PUT", `/api/documents/${created.slug}/visibility`, { visibility: "shared" })).rejects.toMatchObject({ status: 403 });
    expect(fixture.db.prepare("SELECT visibility FROM documents WHERE id=?").get(created.id)).toMatchObject({ visibility: "private" });
  });
  it("MCP 尊重私人選項及群組寫入限制，外部模型也不能繞過", async () => {
    noSharedWrite();
    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "private-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const created = await client.callTool({ name: "create_note", arguments: { title: "MCP private note", markdown: "# Private" } });
      expect(created.isError).not.toBe(true);
      const result = JSON.parse(created.content[0].type === "text" ? created.content[0].text : "{}");
      expect(result.visibility).toBe("private");
      expect((await client.callTool({ name: "create_note", arguments: { title: "Not allowed", markdown: "# Shared", visibility: "shared" } })).isError).toBe(true);
      expect((await client.callTool({ name: "update_document", arguments: { slug: "shared", markdown: "Not allowed" } })).isError).toBe(true);
      const overview = await client.callTool({ name: "study_overview", arguments: {} });
      expect(JSON.stringify(overview.content)).toContain('shared_write');
    } finally { await client.close(); await server.close(); }
  });
});
