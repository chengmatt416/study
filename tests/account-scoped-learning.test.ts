import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./helpers/d1";
import { callApi } from "../src/worker/mcp/internal";

const first = { id: "first", email: "first@test.example", name: "First", avatar_url: null, role: "member" as const };
const second = { ...first, id: "second", email: "second@test.example" };
describe("shared-device learning account guards", () => {
  let fixture: ReturnType<typeof testDatabase>, env: Env;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user = first) => callApi<T>(env, { waitUntil: () => undefined } as ExecutionContext, user, method, path, body);
  beforeEach(() => {
    fixture = testDatabase(); env = { DB: fixture.DB } as Env;
    for (const who of [first, second]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,'member',1)").run(who.email);
    }
    fixture.db.exec("INSERT INTO books(id,title,status,created_at,updated_at) VALUES ('book','Shared book','ready',1,1); INSERT INTO decks(id,title,created_at,updated_at) VALUES ('deck','Shared deck',1,1); INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES ('card','deck',1,'Question','Answer',1,1)");
  });
  afterEach(() => fixture.db.close());

  it("never records another account's delayed reviews after a cookie/account switch", async () => {
    const review = { id: "first-review", card_id: "card", rating: 3, mode: "smart", reviewed_at: Date.now() - 1000 };
    await expect(api("POST", "/api/reviews", { owner_id: first.id, items: [review] }, second)).rejects.toMatchObject({ status: 409 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM review_log").get()).toEqual({ n: 0 });
    await api("POST", "/api/reviews", { owner_id: first.id, items: [review] });
    expect(fixture.db.prepare("SELECT user_id FROM review_state").all()).toEqual([{ user_id: first.id }]);
    // Already-open older clients remain compatible, while new clients always bind an owner.
    await api("POST", "/api/reviews", { items: [{ ...review, id: "second-review" }] }, second);
    expect(fixture.db.prepare("SELECT user_id FROM review_state ORDER BY user_id").all()).toEqual([{ user_id: first.id }, { user_id: second.id }]);
  });

  it("authenticates annotation cache identity and rejects old-account creates and deletes atomically", async () => {
    const annotation = { id: "annotation-first", page: 1, type: "ink", data: { strokes: [1] }, visibility: "private" };
    await api("POST", "/api/books/book/annotations/batch", { owner_id: first.id, create: [annotation] });
    const own = await api<{ owner_id: string; annotations: { id: string }[] }>("GET", "/api/books/book/annotations");
    expect(own.owner_id).toBe(first.id); expect(own.annotations.map(item => item.id)).toEqual([annotation.id]);
    await expect(api("POST", "/api/books/book/annotations/batch", { owner_id: first.id, delete: [annotation.id], create: [{ ...annotation, id: "annotation-wrong" }] }, second)).rejects.toMatchObject({ status: 409 });
    expect(fixture.db.prepare("SELECT id,deleted_at FROM annotations").all()).toEqual([{ id: annotation.id, deleted_at: null }]);
    expect(await api("GET", "/api/books/book/annotations", undefined, second)).toEqual({ owner_id: second.id, annotations: [] });
  });

  it("binds delayed reading-position and bookmark writes to the original account", async () => {
    await expect(api("PUT", "/api/books/book/progress", { page: 5, owner_id: first.id }, second)).rejects.toMatchObject({ status: 409 });
    await expect(api("POST", "/api/books/book/bookmarks", { page: 5, label: "Private reading", owner_id: first.id }, second)).rejects.toMatchObject({ status: 409 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM reading_progress").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM bookmarks").get()).toEqual({ n: 0 });
    const saved = await api<{ progress_updated_at: number }>("PUT", "/api/books/book/progress", { page: 5, owner_id: first.id });
    expect(await api("GET", "/api/books/book")).toMatchObject({ owner_id: first.id, lastPage: 5, progress_updated_at: saved.progress_updated_at });
    expect(await api("GET", "/api/books/book", undefined, second)).toMatchObject({ owner_id: second.id, lastPage: null, progress_updated_at: null });
    await expect(api("PUT", "/api/books/book/progress", { page: 0 })).rejects.toMatchObject({ status: 400 });
  });

  it("orders reading intent separately from server commits so an old request cannot rewind a later page", async () => {
    const at = Date.now() - 10_000;
    const old = await api<{ page: number; progress_changed_at: number; progress_updated_at: number }>("PUT", "/api/books/book/progress", { page: 4, owner_id: first.id, changed_at: at });
    expect(old.progress_changed_at).toBe(at); expect(old.progress_updated_at).toBeGreaterThan(at);
    const newer = await api("PUT", "/api/books/book/progress", { page: 5, owner_id: first.id, changed_at: at + 1000 });
    expect(newer).toMatchObject({ page: 5, progress_changed_at: at + 1000 });
    expect(await api("PUT", "/api/books/book/progress", { page: 4, owner_id: first.id, changed_at: at })).toMatchObject({ page: 5, progress_changed_at: at + 1000 });
    expect(await api("GET", "/api/books/book")).toMatchObject({ lastPage: 5, progress_changed_at: at + 1000 });
    await expect(api("PUT", "/api/books/book/progress", { page: 6, changed_at: Date.now() + 600_000 })).rejects.toMatchObject({ status: 400 });
  });

  it("returns the learner's actual attempt ids for personal result-history links", async () => {
    fixture.db.exec("INSERT INTO documents(id,kind,slug,title,status,created_at,updated_at) VALUES ('exam','exam','physics','Physics','published',1,1); INSERT INTO exam_attempts(id,document_id,revision_id,answers_revision_id,user_id,started_at,submitted_at,score,max_score) VALUES ('my-attempt','exam','r','a','first',1,2,4,6),('other-attempt','exam','r','a','second',1,3,6,6)");
    const stats = await api<{ exams: { attempt_id: string; slug: string }[] }>("GET", "/api/me/stats");
    expect(stats.exams).toHaveLength(1);
    expect(stats.exams[0]).toMatchObject({ attempt_id: "my-attempt", slug: "physics" });
  });

  it("does not replay an old delete after a later undo or accept changed contents under the same operation id", async () => {
    const annotation = { id: "annotation-first", page: 1, type: "ink", data: { strokes: [1] } };
    const batch = (operation_id: string, data: Record<string, unknown>) => api("POST", "/api/books/book/annotations/batch", { owner_id: first.id, operation_id, ...data });
    await batch("operation-create", { create: [annotation] });
    await batch("operation-delete", { delete: [annotation.id] });
    await batch("operation-undo", { create: [annotation] });
    expect(await batch("operation-delete", { delete: [annotation.id] })).toHaveProperty("replayed", true);
    expect(fixture.db.prepare("SELECT deleted_at,data_json FROM annotations WHERE id=?").get(annotation.id)).toEqual({ deleted_at: null, data_json: JSON.stringify(annotation.data) });
    await expect(batch("operation-delete", { create: [{ ...annotation, data: { strokes: [9] } }] })).rejects.toMatchObject({ status: 409 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM annotation_operations").get()).toEqual({ n: 3 });
    await expect(batch("operation-invalid", { create: {} })).rejects.toMatchObject({ status: 400 });
  });

  it("commits the mutation and its operation receipt together, including a failed write and retry", async () => {
    const annotation = { id: "annotation-first", page: 1, type: "ink", data: { strokes: [1] } };
    await api("POST", "/api/books/book/annotations/batch", { create: [annotation] });
    fixture.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON annotation_operations WHEN NEW.operation_id='operation-failure' BEGIN SELECT RAISE(ABORT,'injected operation receipt failure'); END");
    const body = { owner_id: first.id, operation_id: "operation-failure", delete: [annotation.id] };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try { await expect(api("POST", "/api/books/book/annotations/batch", body)).rejects.toMatchObject({ status: 500 }); }
    finally { log.mockRestore(); }
    expect(fixture.db.prepare("SELECT deleted_at FROM annotations WHERE id=?").get(annotation.id)).toEqual({ deleted_at: null });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM annotation_operations").get()).toEqual({ n: 0 });
    fixture.db.exec("DROP TRIGGER fail_receipt");
    await api("POST", "/api/books/book/annotations/batch", body);
    expect(fixture.db.prepare("SELECT deleted_at FROM annotations WHERE id=?").get(annotation.id)?.deleted_at).toBeTypeOf("number");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM annotation_operations").get()).toEqual({ n: 1 });
  });

  it("applies concurrent retries only once even when both initially see no receipt", async () => {
    const annotation = { id: "annotation-first", page: 1, type: "ink", data: { strokes: [1] } };
    await api("POST", "/api/books/book/annotations/batch", { create: [annotation] });
    fixture.db.exec("CREATE TABLE annotation_mutations(n INTEGER); CREATE TRIGGER count_annotation_mutations AFTER UPDATE ON annotations BEGIN INSERT INTO annotation_mutations VALUES (1); END");
    const original = fixture.DB.prepare;
    let readers = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    const prepare = (sql: string, params: (string | number | null)[] = []): ReturnType<typeof original> => {
      const statement = original(sql).bind(...params);
      return { ...statement, bind: (...values: (string | number | null)[]) => prepare(sql, values), first: async () => {
        const row = await statement.first();
        if (sql.startsWith("SELECT payload_hash") && params[2] === "operation-parallel" && !row) { readers++; if (readers === 2) release(); await bothRead; }
        return row;
      } };
    };
    env.DB = { ...fixture.DB, prepare } as unknown as D1Database;
    const body = { owner_id: first.id, operation_id: "operation-parallel", delete: [annotation.id] };
    await Promise.all([api("POST", "/api/books/book/annotations/batch", body), api("POST", "/api/books/book/annotations/batch", body)]);
    expect(readers).toBe(2);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM annotation_mutations").get()).toEqual({ n: 1 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM annotation_operations").get()).toEqual({ n: 1 });
  });
});
