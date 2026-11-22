import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { testDatabase } from "./helpers/d1";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { bookPdfUri, createBookPdfGrant, INLINE_PDF_MAX_BYTES, mcpPdfDownloads, PDF_GRANT_TTL_SECONDS, readBookPdfResource } from "../src/worker/mcp/book-pdf";
import { callApiResponse } from "../src/worker/mcp/internal";
import { sha256Hex } from "../src/worker/lib/util";

const origin = "https://study.example.test";
const user = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
const pdf = new TextEncoder().encode("%PDF-1.7\noriginal-pdf-bytes\n%%EOF");

describe("MCP 書架 PDF", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  let head: ReturnType<typeof vi.fn>;
  let get: ReturnType<typeof vi.fn>;
  const meta = { etag: "version-1", httpEtag: '"version-1"', size: pdf.byteLength };
  const grant = (id = "book") => createBookPdfGrant(env, ctx, user, id, origin);
  const app = new Hono().basePath("/api").route("/mcp-files", mcpPdfDownloads);
  const download = (url: string, headers?: HeadersInit, method = "GET") => app.fetch(new Request(url, { method, headers }), env, ctx);
  const rule = (resource: string, id: string) => fixture.db.prepare("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students',?,?,0)").run(resource, id);
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1)");
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('member','member@test.example',1)");
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1)");
    fixture.db.exec("INSERT INTO access_group_members(group_id,email) VALUES ('students','member@test.example')");
    fixture.db.exec("INSERT INTO books(id,title,kind,status,r2_key,page_count,page_offset,has_text_layer,created_at,updated_at) VALUES ('book','化學 \"核心\"','book','ready','books/book.pdf',100,8,1,1,1),('data','Data Booklet','booklet','ready','books/data.pdf',20,0,0,1,1),('upload','Uploading','book','uploading',NULL,0,0,0,1,1)");
    head = vi.fn(async () => meta);
    get = vi.fn(async (_key: string, options?: { range?: Headers; onlyIf?: Headers | { etagMatches: string } }) => {
      const headers = options?.onlyIf;
      if (headers instanceof Headers && headers.get("if-match") && headers.get("if-match") !== meta.httpEtag) return meta;
      const range = options?.range instanceof Headers ? options.range.get("range") : null;
      const start = range ? Number(/^bytes=(\d+)/.exec(range)?.[1] ?? 0) : 0;
      const end = range ? Math.min(pdf.byteLength - 1, Number(/-(\d+)$/.exec(range)?.[1] ?? pdf.byteLength - 1)) : pdf.byteLength - 1;
      return { ...meta, range: range ? { offset: start, length: end - start + 1 } : undefined,
        body: new Blob([pdf.slice(start, end + 1)]).stream() };
    });
    env = { DB: fixture.DB, BUCKET: { head, get } } as Env;
  });
  afterEach(() => fixture.db.close());

  it("回傳原始 PDF 的短效連結，無 cookie 即可下載，不外洩 R2 key 或帳號", async () => {
    const result = await grant();
    expect(result).toMatchObject({ book_id: "book", mime_type: "application/pdf", size_bytes: pdf.byteLength, pages: 100, page_offset: 8, has_text_layer: true });
    expect(result.download_url).toMatch(/^https:\/\/study\.example\.test\/api\/mcp-files\/[A-Za-z0-9_-]{43}\/book\.pdf$/);
    expect(JSON.stringify(result)).not.toContain("books/book.pdf");
    expect(JSON.stringify(result)).not.toContain(user.email);
    const token = result.download_url.split("/").at(-2)!;
    const saved = fixture.db.prepare("SELECT token_hash,expires_at FROM mcp_pdf_grants").get();
    expect(saved?.token_hash).toBe(await sha256Hex(token));
    expect(saved?.token_hash).not.toBe(token);
    expect(Number(saved?.expires_at) - Date.now()).toBeLessThanOrEqual(PDF_GRANT_TTL_SECONDS * 1000);
    const response = await download(result.download_url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("電子書被停用仍可讀資料手冊；禁止發出受限書本的連結或二進位內容", async () => {
    rule("feature", "ebooks");
    await expect(grant()).rejects.toMatchObject({ status: 403 });
    await expect(readBookPdfResource(env, ctx, user, "book")).rejects.toMatchObject({ status: 403 });
    expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    const result = await grant("data");
    expect((await download(result.download_url)).status).toBe(200);
    expect(result.has_text_layer).toBe(false);
  });
  it.each(["book", "ebooks", "ai", "allowlist"])("發出連結後撤銷 %s 仍立即阻擋，不讀取 R2", async (restriction) => {
    const result = await grant(); head.mockClear();
    if (restriction === "allowlist") fixture.db.exec("DELETE FROM allowlist");
    else rule(restriction === "book" ? "book" : "feature", restriction === "book" ? "book" : restriction);
    const response = await download(result.download_url);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it("阻擋過期、偽造及跨網域連結，且不能換成其他書本", async () => {
    const result = await grant(); head.mockClear();
    expect((await download(result.download_url.replace(origin, "https://other.example.test"))).status).toBe(404);
    expect((await download(`${origin}/api/mcp-files/${"x".repeat(43)}/book.pdf`)).status).toBe(404);
    fixture.db.exec("UPDATE mcp_pdf_grants SET expires_at=1");
    expect((await download(result.download_url)).status).toBe(404);
    expect(head).not.toHaveBeenCalled();
  });
  it("檔案更新或書本刪除後，舊連結不會指向新檔案", async () => {
    const result = await grant();
    fixture.db.exec("UPDATE books SET r2_key='books/replacement.pdf' WHERE id='book'");
    expect((await download(result.download_url)).status).toBe(409);
    fixture.db.exec("DELETE FROM books WHERE id='book'");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM mcp_pdf_grants").get()).toMatchObject({ n: 0 });
    expect((await download(result.download_url)).status).toBe(404);
  });
  it("HEAD、Range 與無效範圍正確，HEAD 不載入 PDF 本文", async () => {
    const result = await grant();
    const response = await download(result.download_url, undefined, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(pdf.byteLength));
    expect(await response.text()).toBe("");
    expect(get).not.toHaveBeenCalled();
    const partial = await download(result.download_url, { range: "bytes=0-4" });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 0-4/${pdf.byteLength}`);
    expect(await partial.text()).toBe("%PDF-");
    get.mockClear();
    for (const range of ["bytes=999-", "bytes=10-2", "bytes=0-1,5-6", "bytes=-0", "garbage"]) expect((await download(result.download_url, { range })).status).toBe(416);
    expect(get).not.toHaveBeenCalled();
  });
  it("支援外部用戶端無 cookie 的 CORS 讀取，預檢不存取檔案", async () => {
    const result = await grant(); head.mockClear();
    const preflight = await download(result.download_url, { origin: "https://chatbot.example.test", "access-control-request-method": "GET", "access-control-request-headers": "Range" }, "OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    const response = await download(result.download_url, { origin: "https://chatbot.example.test" });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-expose-headers")).toContain("Content-Range");
  });
  it("大型 PDF 走原始串流連結，MCP 內嵌拒絕超大檔案，避免截斷或耗盡記憶體", async () => {
    head.mockResolvedValue({ ...meta, size: INLINE_PDF_MAX_BYTES + 1 });
    const result = await grant();
    expect(result.size_bytes).toBe(INLINE_PDF_MAX_BYTES + 1);
    expect(get).not.toHaveBeenCalled();
    await expect(readBookPdfResource(env, ctx, user, "book")).rejects.toMatchObject({ status: 413 });
    expect(get).not.toHaveBeenCalled();
  });
  it("未完成上傳與不存在的 PDF 不建立下載授權", async () => {
    await expect(grant("upload")).rejects.toMatchObject({ status: 404 });
    head.mockResolvedValue(null);
    await expect(grant()).rejects.toMatchObject({ status: 404 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM mcp_pdf_grants").get()).toMatchObject({ n: 0 });
  });
  it("If-Match 在 HEAD 後競爭失敗會回 412，不回傳不同版本的檔案", async () => {
    const result = await grant();
    get.mockResolvedValue({ ...meta, httpEtag: '"changed"' });
    expect((await download(result.download_url)).status).toBe(412);
    const res = await callApiResponse(env, ctx, user, "GET", "/api/books/book/file", undefined, { "if-match": meta.httpEtag });
    expect(res.status).toBe(412);
  });
  it("沒有 study:read 時工具與 resource 都不回傳 PDF 或建立下載授權", async () => {
    const server = buildServer({ env, ctx, user, scopes: ["study:write"], origin });
    const client = new Client({ name: "pdf-scope-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect((await client.callTool({ name: "get_book_pdf", arguments: { book_id: "book" } })).isError).toBe(true);
      await expect(client.readResource({ uri: bookPdfUri("book") })).rejects.toThrow();
      expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM mcp_pdf_grants").get()).toMatchObject({ n: 0 });
      expect(head).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    } finally { await client.close(); await server.close(); }
  });
  it("真實 MCP tools/call 與 resources/read 直接取得 PDF，讀取權限不需寫入 scope", async () => {
    const server = buildServer({ env, ctx, user, scopes: ["study:read"], origin });
    const client = new Client({ name: "pdf-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      expect(WRITE_TOOLS.has("get_book_pdf")).toBe(false);
      const list = await client.callTool({ name: "list_books", arguments: {} });
      expect(JSON.stringify(list.content)).toContain(bookPdfUri("book"));
      const linked = await client.callTool({ name: "get_book_pdf", arguments: { book_id: "book" } });
      expect(linked.isError).not.toBe(true);
      expect(linked.content.some((c) => c.type === "resource_link" && c.mimeType === "application/pdf")).toBe(true);
      expect((await download(String(linked.structuredContent?.download_url))).status).toBe(200);
      const embedded = await client.callTool({ name: "get_book_pdf", arguments: { book_id: "book", delivery: "inline" } });
      const resource = embedded.content.find((c) => c.type === "resource");
      expect(resource?.type === "resource" && "blob" in resource.resource && Buffer.from(resource.resource.blob, "base64")).toEqual(Buffer.from(pdf));
      const result = await client.readResource({ uri: bookPdfUri("book") });
      expect(result.contents[0]).toMatchObject({ mimeType: "application/pdf", blob: Buffer.from(pdf).toString("base64") });
      rule("book", "book");
      const denied = await client.callTool({ name: "get_book_pdf", arguments: { book_id: "book", delivery: "inline" } });
      expect(denied.isError).toBe(true);
      await expect(client.readResource({ uri: bookPdfUri("book") })).rejects.toThrow();
    } finally { await client.close(); await server.close(); }
  });
});
