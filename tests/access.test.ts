import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { canAccess } from "../src/shared/access";
import { callApi } from "../src/worker/mcp/internal";
import accessAdmin from "../src/worker/routes/access-admin";
import { requireDocumentAccess, userAccess } from "../src/worker/lib/access";
import type { AppEnv } from "../src/worker/lib/types";
import { testDatabase } from "./helpers/d1";

describe("群組存取權限（網站與 MCP 共用路由）", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const user = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
  const admin = { ...user, id: "admin", email: "admin@test.example", role: "admin" as const };
  const ctx = { waitUntil: () => undefined } as ExecutionContext;
  let storage: ReturnType<typeof vi.fn>;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const rule = (type: string, id: string, allowed: number, group = "students") => fixture.db.prepare("INSERT INTO access_rules (group_id,resource_type,resource_id,allowed) VALUES (?,?,?,?) ON CONFLICT DO UPDATE SET allowed=excluded.allowed").run(group, type, id, allowed);
  beforeEach(() => {
    fixture = testDatabase();
    const db = fixture.db;
    db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1),('admin@test.example','admin',1)");
    db.exec("INSERT INTO users(id,email,created_at) VALUES ('member','member@test.example',1),('admin','admin@test.example',1)");
    db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1)");
    db.exec("INSERT INTO access_group_members(group_id,email) VALUES ('students','member@test.example')");
    db.exec("INSERT INTO books(id,title,kind,status,r2_key,created_at,updated_at) VALUES ('ins','INS','book','ready','books/ins.pdf',1,1),('chem','Chemistry','book','ready','books/chem.pdf',1,1),('data','Data Booklet','booklet','ready','books/data.pdf',1,1)");
    db.exec("INSERT INTO documents(id,kind,slug,title,status,created_at,updated_at) VALUES ('lesson','note','lesson','Secret Lesson','published',1,1),('open','note','open','Open Lesson','published',1,1),('exam','exam','exam','Exam','published',1,1)");
    db.exec("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('rev','lesson','Secret text ![img](/api/assets/secret-image)','import',1)");
    db.exec("UPDATE documents SET current_revision_id='rev' WHERE id='lesson'");
    db.exec("INSERT INTO decks(id,title,created_at,updated_at) VALUES ('deck','Restricted deck',1,1)");
    db.exec("INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES ('card','deck',1,'Secret term','Secret definition',1,1)");
    db.exec("INSERT INTO answer_revisions(id,document_id,answers_json,status,created_at) VALUES ('answers','exam','{}','approved',1)");
    db.exec("INSERT INTO exam_attempts(id,user_id,document_id,revision_id,answers_revision_id,started_at) VALUES ('attempt','member','exam','rev','answers',1)");
    db.exec("INSERT INTO assets(id,r2_key,mime,size_bytes,uploaded_by,created_at) VALUES ('secret-image','assets/secret.png','image/png',10,'member',1)");
    storage = vi.fn(async () => ({ body: "pdf bytes", size: 9, httpEtag: '"etag"', httpMetadata: { contentType: "application/pdf" } }));
    env = { DB: fixture.DB, BUCKET: { get: storage } } as Env;
  });
  afterEach(() => fixture.db.close());

  it("可停用電子書，但仍讀取資料手冊、其他功能；包含直接 PDF 連結", async () => {
    rule("feature", "ebooks", 0);
    expect(await api("GET", "/api/books")).toMatchObject({ books: [] });
    expect(await api("GET", "/api/books?kind=booklet")).toHaveProperty("books.0.id", "data");
    await expect(api("GET", "/api/books/ins/file")).rejects.toMatchObject({ status: 403 });
    await expect(api("GET", "/api/books/chem/cover")).rejects.toMatchObject({ status: 403 });
    expect(storage).not.toHaveBeenCalled();
    const state = await userAccess(env, user);
    expect(state.features).toMatchObject({ ebooks: false, booklets: true, notes: true });
    expect(await api("GET", "/api/documents/open")).toHaveProperty("document.id", "open");
  });

  it("只封鎖 INS 與特定課程：清單、搜尋、修訂、課程、MCP 與圖片全部遵守", async () => {
    rule("book", "ins", 0); rule("document", "lesson", 0);
    expect(await api("GET", "/api/books")).toHaveProperty("books.0.id", "chem");
    for (const path of ["/api/books/ins", "/api/documents/lesson", "/api/documents/lesson/revisions", "/api/documents/lesson/course", "/api/documents/lesson/collab", "/api/assets/secret-image"]) await expect(api("GET", path)).rejects.toMatchObject({ status: 403 });
    await expect(api("POST", "/api/course-generations", { note_slug: "lesson", topic: "Secret" })).rejects.toMatchObject({ status: 403 });
    const search = await api<{ documents: unknown[]; cards: unknown[] }>("GET", "/api/search?q=Secret");
    expect(search.documents).toEqual([]);
    expect(search.cards).toHaveLength(1);
    expect(await requireDocumentAccess(env, user, "lesson")).toBe(false);
    expect(await requireDocumentAccess(env, admin, "lesson")).toBe(true);
    fixture.db.exec("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('shared-ref','open','![img](/api/assets/secret-image)','import',1)");
    await expect(api("GET", "/api/assets/secret-image")).rejects.toMatchObject({ status: 403 });
  });

  it("個別允許可覆寫同群組預設；跨群組拒絕優先，移除會員後立即套用", async () => {
    rule("feature", "ebooks", 0); rule("book", "ins", 1);
    expect(await api("GET", "/api/books")).toHaveProperty("books.0.id", "ins");
    expect((await userAccess(env, user)).features.ebooks).toBe(true);
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('other','Other',1); INSERT INTO access_group_members(group_id,email) VALUES ('other','member@test.example')");
    rule("book", "ins", 0, "other");
    await expect(api("GET", "/api/books/ins")).rejects.toMatchObject({ status: 403 });
    fixture.db.exec("DELETE FROM access_group_members WHERE group_id='other'");
    expect(await api("GET", "/api/books/ins")).toHaveProperty("book.id", "ins");
  });

  it("卡片、批次複習與測驗紀錄不能繞過限制；管理員保有存取", async () => {
    rule("deck", "deck", 0); rule("document", "exam", 0);
    await expect(api("GET", "/api/decks/cards/card/revisions")).rejects.toMatchObject({ status: 403 });
    await expect(api("POST", "/api/reviews", { items: [{ id: "review", card_id: "card", rating: 3, mode: "smart", reviewed_at: 1 }] })).rejects.toMatchObject({ status: 403 });
    await expect(api("GET", "/api/exams/attempts/attempt")).rejects.toMatchObject({ status: 403 });
    expect(await api("GET", "/api/exams/attempts")).toMatchObject({ attempts: [] });
    expect(await api("GET", "/api/decks")).toMatchObject({ decks: [] });
    expect(await callApi(env, ctx, admin, "GET", "/api/decks/deck")).toHaveProperty("deck.id", "deck");
  });

  it("允許書籍的 URL 不能修改已被拒絕書籍的標注或書籤", async () => {
    rule("book", "ins", 0);
    fixture.db.exec("INSERT INTO annotations(id,book_id,user_id,page,type,data_json,created_at,updated_at) VALUES ('restricted-ann','ins','member',1,'ink','{}',1,1)");
    fixture.db.exec("INSERT INTO bookmarks(id,book_id,user_id,page,created_at) VALUES ('restricted-bookmark','ins','member',1,1)");
    await api("DELETE", "/api/books/chem/annotations/restricted-ann");
    await api("DELETE", "/api/books/chem/bookmarks/restricted-bookmark");
    await api("POST", "/api/books/chem/annotations/batch", { delete: ["restricted-ann"], create: [{ id: "restricted-ann", page: 1, type: "ink", data: { replaced: true } }] });
    expect(fixture.db.prepare("SELECT data_json,deleted_at FROM annotations WHERE id='restricted-ann'").get()).toMatchObject({ data_json: "{}", deleted_at: null });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE id='restricted-bookmark'").get()).toMatchObject({ n: 1 });
  });

  it("功能預設關閉時，明確允許的字卡組仍可匯入與提交複習", async () => {
    rule("feature", "decks", 0); rule("deck", "deck", 1);
    expect(await api("GET", "/api/decks")).toHaveProperty("decks.0.id", "deck");
    expect(await api("POST", "/api/decks/import/preview", { deck_id: "deck", json: [{ front: "New term", back: "Definition" }] })).toHaveProperty("plan.add.length", 1);
    const review = await api("POST", "/api/reviews", { items: [{ id: "review-exception", card_id: "card", rating: 3, mode: "shuffle", reviewed_at: Date.now() }] });
    expect(review).toHaveProperty("updated");
    await expect(api("POST", "/api/decks", { title: "New deck" })).rejects.toMatchObject({ status: 403 });
  });

  it("管理員建立/修改群組，驗證規則與成員，拒絕一般成員及舊版本覆寫", async () => {
    const app = new Hono<AppEnv>();
    let active = admin;
    app.use("*", async (c, next) => { c.set("user", active); await next(); });
    app.route("/", accessAdmin);
    app.onError((e) => e instanceof HTTPException ? e.getResponse() : Response.json({ error: e.message }, { status: 500 }));
    const request = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
    const payload = { name: "New group", members: [user.email], rules: [{ resource_type: "feature", resource_id: "ebooks", allowed: 0 }] };
    let response = await request("POST", "/", payload);
    expect(response.status).toBe(200);
    const created = await response.json() as { id: string; version: number };
    response = await request("PUT", `/${created.id}`, { ...payload, expected_version: created.version, rules: [] });
    expect(response.status).toBe(200);
    response = await request("PUT", `/${created.id}`, { ...payload, expected_version: created.version });
    expect(response.status).toBe(409);
    expect(fixture.db.prepare("SELECT * FROM access_rules WHERE group_id=?").all(created.id)).toEqual([]);
    expect((await request("POST", "/", { ...payload, name: "Invalid", members: ["unknown@test.example"] })).status).toBe(400);
    active = { ...user, role: "member" } as typeof admin;
    expect((await request("GET", "/")).status).toBe(403);
  });
});

it("預設開放與群組規則優先順序是明確、可預期的", () => {
  expect(canAccess([], "ebooks")).toBe(true);
  const rules = [{ group_id: "g", resource_type: "feature" as const, resource_id: "ebooks", allowed: 0 }, { group_id: "g", resource_type: "book" as const, resource_id: "ins", allowed: 1 }];
  expect(canAccess(rules, "ebooks", "book", "ins")).toBe(true);
  expect(canAccess(rules, "ebooks", "book", "other")).toBe(false);
});
