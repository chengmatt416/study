import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { academicYearLabel, currentSyllabusTerm, syllabusTermSchema } from "../src/shared/syllabus";
import { matchesLegacyUpload, uploadResumeKey } from "../src/shared/book-upload";
import { callApi, callApiResponse } from "../src/worker/mcp/internal";
import { buildServer } from "../src/worker/mcp/server";
import { createBookPdfGrant } from "../src/worker/mcp/book-pdf";
import { userAccess } from "../src/worker/lib/access";
import { testDatabase } from "./helpers/d1";

const user = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
const admin = { ...user, id: "admin", email: "admin@test.example", role: "admin" as const };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
describe("學期課綱", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  let upload: ReturnType<typeof vi.fn>;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const rule = (type: string, id: string, allowed = 0) => fixture.db.prepare("INSERT OR REPLACE INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students',?,?,?)").run(type, id, allowed);
  const seed = (id: string, year: number, semester: string, subject: string | null = null) => fixture.db.prepare("INSERT INTO books(id,title,kind,status,r2_key,academic_year,semester,subject_id,created_at,updated_at) VALUES (?,?,'syllabus','ready',?,?,?,?,1,1)").run(id, id, `books/${id}.pdf`, year, semester, subject);
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1),('admin@test.example','admin',1)");
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('member','member@test.example',1),('admin','admin@test.example',1)");
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1)");
    fixture.db.exec("INSERT INTO access_group_members(group_id,email) VALUES ('students','member@test.example')");
    fixture.db.exec("INSERT INTO subjects(id,slug,name,sort) VALUES ('chem','chem','Chemistry',1)");
    upload = vi.fn(async () => ({ uploadId: crypto.randomUUID() }));
    env = { DB: fixture.DB, BUCKET: { createMultipartUpload: upload, head: vi.fn(async () => ({ size: 30, httpEtag: '"one"' })), get: vi.fn(async () => ({ body: new Blob(["%PDF-syllabus"]).stream(), size: 13, httpEtag: '"one"' })) } } as Env;
  });
  afterEach(() => fixture.db.close());

  it("八月學年預設使用 UTC+8，明確學期與年度可覆寫", () => {
    expect(currentSyllabusTerm(new Date("2026-07-31T15:59:00Z"))).toEqual({ academic_year: 2025, semester: "2" });
    expect(currentSyllabusTerm(new Date("2026-07-31T16:00:00Z"))).toEqual({ academic_year: 2026, semester: "1" });
    expect(currentSyllabusTerm(new Date("2027-01-10T00:00:00Z"))).toEqual({ academic_year: 2026, semester: "1" });
    expect(academicYearLabel(2026)).toBe("2026–2027");
    expect(syllabusTermSchema.safeParse({ academic_year: 2026, semester: "summer" }).success).toBe(true);
    expect(syllabusTermSchema.safeParse({ academic_year: 2026.5, semester: "3" }).success).toBe(false);
  });
  it("只有管理員能上傳，學年度／學期必填且參照檔上限 100MB", async () => {
    const body = { title: "Chemistry syllabus", kind: "syllabus", size: 30, academic_year: 2026, semester: "1", subject_id: "chem" };
    await expect(api("POST", "/api/books/uploads", body)).rejects.toMatchObject({ status: 403 });
    for (const invalid of [{ ...body, academic_year: undefined }, { ...body, semester: "bad" }, { ...body, academic_year: null }]) await expect(api("POST", "/api/books/uploads", invalid, admin)).rejects.toMatchObject({ status: 400 });
    await expect(api("POST", "/api/books/uploads", { ...body, size: 100 * 1024 * 1024 + 1 }, admin)).rejects.toMatchObject({ status: 413 });
    expect(upload).not.toHaveBeenCalled();
    const result = await api<{ bookId: string }>("POST", "/api/books/uploads", body, admin);
    expect(fixture.db.prepare("SELECT kind,academic_year,semester,subject_id,status FROM books WHERE id=?").get(result.bookId)).toMatchObject({ kind: "syllabus", academic_year: 2026, semester: "1", subject_id: "chem", status: "uploading" });
    expect(upload).toHaveBeenCalledOnce();
  });
  it("依學年、學期及科目篩選，保留歷年並與電子書／手冊分離", async () => {
    seed("current", 2026, "1", "chem"); seed("last", 2025, "2"); seed("next", 2026, "2");
    expect(await api("GET", "/api/books")).toMatchObject({ books: [] });
    expect(await api("GET", "/api/books?kind=booklet")).toMatchObject({ books: [] });
    const result = await api<{ books: { id: string }[] }>("GET", "/api/books?kind=syllabus&academic_year=2026&semester=1&subject=chem");
    expect(result.books.map((b) => b.id)).toEqual(["current"]);
    expect((await api<{ books: unknown[] }>("GET", "/api/books?kind=syllabus")).books).toHaveLength(3);
    await expect(api("GET", "/api/books?kind=syllabus&academic_year=invalid")).rejects.toMatchObject({ status: 400 });
  });
  it("關閉電子書與手冊仍能讀課綱，課綱功能／個別內容可獨立限制", async () => {
    seed("current", 2026, "1"); seed("private", 2026, "1");
    rule("feature", "ebooks"); rule("feature", "booklets"); rule("book", "private");
    expect((await userAccess(env, user)).features).toMatchObject({ ebooks: false, booklets: false, syllabi: true });
    expect((await api<{ books: { id: string }[] }>("GET", "/api/books?kind=syllabus")).books.map((b) => b.id)).toEqual(["current"]);
    expect((await callApiResponse(env, ctx, user, "GET", "/api/books/current/file")).status).toBe(200);
    expect((await callApiResponse(env, ctx, user, "GET", "/api/books/private/file")).status).toBe(403);
    rule("feature", "syllabi");
    expect(await api("GET", "/api/books?kind=syllabus")).toMatchObject({ books: [] });
    await expect(createBookPdfGrant(env, ctx, user, "current", "https://study.test")).rejects.toMatchObject({ status: 403 });
    rule("book", "current", 1);
    expect((await callApiResponse(env, ctx, user, "GET", "/api/books/current/file")).status).toBe(200);
  });
  it("替換沿用實際檔案類型與學期，不能以 book 標籤繞過 100MB 上限", async () => {
    seed("current", 2026, "1");
    await expect(api("POST", "/api/books/uploads", { book_id: "current", title: "Replacement", kind: "book", size: 101 * 1024 * 1024 }, admin)).rejects.toMatchObject({ status: 413 });
    await api("POST", "/api/books/uploads", { book_id: "current", title: "Replacement", kind: "book", size: 30 }, admin);
    expect(fixture.db.prepare("SELECT kind,academic_year,semester FROM books WHERE id='current'").get()).toMatchObject({ kind: "syllabus", academic_year: 2026, semester: "1" });
  });
  it("只有管理員能修改分類，不可清空學期或給一般書本設定學期", async () => {
    seed("current", 2026, "1");
    await expect(api("PUT", "/api/books/current", { academic_year: 2025 })).rejects.toMatchObject({ status: 403 });
    await api("PUT", "/api/books/current", { academic_year: 2025, semester: "2", title: "Archived syllabus" }, admin);
    expect(fixture.db.prepare("SELECT academic_year,semester,title FROM books WHERE id='current'").get()).toMatchObject({ academic_year: 2025, semester: "2", title: "Archived syllabus" });
    await expect(api("PUT", "/api/books/current", { semester: null }, admin)).rejects.toMatchObject({ status: 400 });
    fixture.db.exec("UPDATE books SET kind='book' WHERE id='current'");
    await expect(api("PUT", "/api/books/current", { semester: "1" }, admin)).rejects.toMatchObject({ status: 400 });
  });
  it("續傳隔離帳號、學期與替換目標，舊版作業必須核對伺服器資料", () => {
    const file = { name: "syllabus.pdf", size: 1000, lastModified: 10 };
    const meta = { kind: "syllabus" as const, title: "Syllabus", academic_year: 2026, semester: "1" as const };
    const key = uploadResumeKey(file, meta, "admin");
    expect(uploadResumeKey(file, { ...meta, semester: "2" }, "admin")).not.toBe(key);
    expect(uploadResumeKey(file, meta, "member")).not.toBe(key);
    expect(uploadResumeKey(file, { ...meta, book_id: "replace" }, "admin")).not.toBe(key);
    const book = { id: "id", ...meta, subject_id: null };
    const upload = { book_id: "id", created_by: "admin", size_bytes: 1000 };
    expect(matchesLegacyUpload(meta, "admin", upload, 1000, book)).toBe(true);
    expect(matchesLegacyUpload({ ...meta, semester: "2" }, "admin", upload, 1000, book)).toBe(false);
    expect(matchesLegacyUpload(meta, "member", upload, 1000, book)).toBe(false);
    expect(matchesLegacyUpload({ title: "File.pdf", kind: "syllabus", book_id: "id" }, "admin", upload, 1000, book)).toBe(true);
  });
  it("MCP 可查指定學期並取得原始 PDF，受限課綱不會列出", async () => {
    seed("current", 2026, "1", "chem"); seed("last", 2025, "2"); seed("private", 2026, "1"); rule("book", "private");
    const server = buildServer({ env, ctx, user, scopes: ["study:read"], origin: "https://study.test" });
    const client = new Client({ name: "syllabus-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "list_syllabi", arguments: { academic_year: 2026, semester: "1" } });
      expect(result.isError).not.toBe(true);
      const data = JSON.parse(result.content[0].type === "text" ? result.content[0].text : "{}");
      expect(data.syllabi.map((b: { id: string }) => b.id)).toEqual(["current"]);
      const pdf = await client.callTool({ name: "get_book_pdf", arguments: { book_id: "current" } });
      expect(pdf.isError).not.toBe(true);
      expect(pdf.structuredContent).toMatchObject({ academic_year: 2026, semester: "1" });
      const history = await client.callTool({ name: "list_syllabi", arguments: { all_terms: true } });
      expect(JSON.stringify(history.content)).toContain('last');
      expect(JSON.stringify(history.content)).not.toContain('private');
    } finally { await client.close(); await server.close(); }
  });
});
