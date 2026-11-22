import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./helpers/d1";
import { callApi } from "../src/worker/mcp/internal";
import type { ContentFolder, ContentItem } from "../src/shared/content";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";

const user = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const admin = { ...user, id: "admin", email: "admin@test.example", role: "admin" as const };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
describe("personal content organization", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const list = (query = "", who = user) => api<{ items: ContentItem[]; next_cursor: string | null }>("GET", `/api/content${query}`, undefined, who);
  const folder = (name = "Physics", parent_id?: string) => api<ContentFolder>("POST", "/api/content/folders", { name, parent_id });
  beforeEach(() => {
    fixture = testDatabase();
    for (const who of [user, other, admin]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,?,1)").run(who.email, who.role);
    }
    fixture.db.exec(`INSERT INTO documents(id,slug,title,kind,status,visibility,created_by,created_at,updated_at) VALUES
      ('note','note','Alpha lesson','note','published','shared','owner',1,5),
      ('exam','exam','Beta exam','exam','published','shared','owner',1,5),
      ('private','private','Secret lesson','note','published','private','owner',1,6),
      ('trash','trash','Trashed lesson','note','archived','shared','owner',1,7);
      INSERT INTO books(id,title,status,r2_key,created_at,updated_at) VALUES ('book','Gamma book','ready','book.pdf',1,4),('upload','Not ready','uploading','upload.pdf',1,8);
      INSERT INTO decks(id,title,created_by,created_at,updated_at) VALUES ('deck','Delta cards','owner',1,3);
      INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1);
      INSERT INTO access_group_members(group_id,email) VALUES ('students','owner@test.example');`);
    env = { DB: fixture.DB } as unknown as Env;
  });
  afterEach(() => fixture.db.close());

  it("lists and searches metadata across every content type without trash, unfinished uploads or private leaks", async () => {
    expect((await list()).items.map((item) => item.id)).toEqual(["private", "exam", "note", "book", "deck"]);
    for (const who of [other, admin]) expect((await list("", who)).items.map((item) => item.id)).not.toContain("private");
    expect((await list("?q=lesson&kind=note")).items.map((item) => item.id)).toEqual(["private", "note"]);
    expect((await list()).items.find((item) => item.id === "note")).toMatchObject({ url: "/notes/note", starred: false, archived_at: null, folder_id: null });
    expect(JSON.stringify(await list())).not.toContain("body_md");
  });
  it("paginates in stable recent and title order including ties and unicode without omissions", async () => {
    fixture.db.exec("INSERT INTO decks(id,title,created_by,created_at,updated_at) VALUES ('unicode','中文教材','owner',1,3),('case','alpha lesson','owner',1,5)");
    for (const sort of ["recent", "title"]) {
      const all = (await list(`?sort=${sort}`)).items.map((item) => item.id);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await list(`?sort=${sort}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.next_cursor;
      } while (cursor);
      expect(ids).toEqual(all);
      expect(new Set(ids).size).toBe(all.length);
    }
    await expect(list("?cursor=invalid")).rejects.toMatchObject({ status: 400 });
    await expect(list("?limit=101")).rejects.toMatchObject({ status: 400 });
  });
  it("archives only for the current user across ordinary lists and restores unchanged content", async () => {
    for (const type of ["document", "book", "deck"] as const) {
      const id = type === "document" ? "note" : type;
      expect(await api("PUT", `/api/content/${type}/${id}`, { archived: true })).toMatchObject({ ok: true });
    }
    expect((await list()).items.map((item) => item.id)).toEqual(["private", "exam"]);
    expect((await list("?view=archived")).items.map((item) => item.id)).toEqual(["note", "book", "deck"]);
    expect((await list("", other)).items.map((item) => item.id)).toContain("note");
    expect(JSON.stringify(await api("GET", "/api/documents"))).not.toContain("Alpha lesson");
    expect(await api("GET", "/api/books")).toMatchObject({ books: [] });
    expect(await api("GET", "/api/decks")).toMatchObject({ decks: [] });
    expect(fixture.db.prepare("SELECT status,deleted_at FROM documents WHERE id='note'").get()).toMatchObject({ status: "published", deleted_at: null });
    await api("PUT", "/api/content/document/note", { archived: false });
    expect(JSON.stringify(await api("GET", "/api/documents"))).toContain("Alpha lesson");
  });
  it("supports personal organization even when shared editing is disabled", async () => {
    fixture.db.exec("INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','feature','shared_write',0)");
    const created = await folder();
    expect(await api("PUT", "/api/content/document/note", { folder_id: created.id, starred: true })).toMatchObject({ ok: true });
    expect((await list("?view=starred")).items).toMatchObject([{ id: "note", folder_id: created.id, starred: true }]);
    await expect(api("PUT", "/api/documents/note", { title: "Cannot edit shared" })).rejects.toMatchObject({ status: 403 });
  });
  it("protects private folders and prevents cycles or deleting nonempty folders", async () => {
    const parent = await folder(), child = await folder("Nested", parent.id);
    await expect(api("PUT", `/api/content/folders/${parent.id}`, { parent_id: child.id })).rejects.toMatchObject({ status: 400 });
    await expect(api("PUT", `/api/content/folders/${parent.id}`, { parent_id: parent.id })).rejects.toMatchObject({ status: 400 });
    await expect(api("DELETE", `/api/content/folders/${parent.id}`)).rejects.toMatchObject({ status: 409 });
    await expect(api("PUT", `/api/content/folders/${parent.id}`, { name: "Hijack" }, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("PUT", "/api/content/document/note", { folder_id: parent.id }, other)).rejects.toMatchObject({ status: 404 });
    expect(await api("GET", "/api/content/folders", undefined, other)).toMatchObject({ folders: [] });
    await api("PUT", "/api/content/document/note", { folder_id: child.id });
    await expect(api("DELETE", `/api/content/folders/${child.id}`)).rejects.toMatchObject({ status: 409 });
    await api("PUT", "/api/content/document/note", { folder_id: null });
    await api("PUT", `/api/content/folders/${child.id}`, { name: "Moved", parent_id: null });
    expect(await api("DELETE", `/api/content/folders/${parent.id}`)).toMatchObject({ ok: true });
  });
  it("validates the entire bulk before writing and refuses hidden, deleted, missing or invalid content", async () => {
    for (const id of ["private", "trash", "missing"]) {
      await expect(api("POST", "/api/content/bulk", { items: [{ type: "document", id: "note" }, { type: "document", id }], archived: true }, other)).rejects.toMatchObject({ status: 404 });
      expect(fixture.db.prepare("SELECT 1 FROM content_organization WHERE user_id='other'").get()).toBeUndefined();
    }
    await expect(api("PUT", "/api/content/document/note", {})).rejects.toMatchObject({ status: 400 });
    await expect(api("PUT", "/api/content/document/note", { archived: "true" })).rejects.toMatchObject({ status: 400 });
    await expect(api("POST", "/api/content/bulk", { items: Array.from({ length: 101 }, () => ({ type: "book", id: "book" })), archived: true })).rejects.toMatchObject({ status: 400 });
  });
  it("honors group feature denial and per-resource exceptions before pagination", async () => {
    fixture.db.exec(`INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES
      ('students','feature','notes',0),('students','document','note',1),('students','book','book',0)`);
    expect((await list()).items.map((item) => item.id)).toEqual(["exam", "note", "deck"]);
    await expect(api("PUT", "/api/content/document/private", { starred: true })).rejects.toMatchObject({ status: 404 });
    const first = await list("?limit=1");
    expect(first.items[0].id).toBe("exam");
    expect((await list(`?limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`)).items[0].id).toBe("note");
  });
  it("cleans organization when the actual resource is permanently deleted", async () => {
    const target = await folder();
    await api("POST", "/api/content/bulk", { items: [{ type: "document", id: "note" }, { type: "book", id: "book" }, { type: "deck", id: "deck" }], folder_id: target.id, archived: true });
    fixture.db.exec("DELETE FROM documents WHERE id='note'; DELETE FROM books WHERE id='book'; DELETE FROM decks WHERE id='deck'");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM content_organization").get()).toMatchObject({ n: 0 });
    expect(await api("DELETE", `/api/content/folders/${target.id}`)).toMatchObject({ ok: true });
  });
  it("does not strand folders after content is trashed or its permission is revoked", async () => {
    const target = await folder();
    await api("POST", "/api/content/bulk", { items: [{ type: "document", id: "note" }, { type: "document", id: "exam" }], folder_id: target.id });
    fixture.db.exec("UPDATE documents SET status='archived' WHERE id='note'; UPDATE documents SET visibility='private',created_by='other' WHERE id='exam'");
    expect((await list(`?folder_id=${target.id}`)).items).toEqual([]);
    expect(await api("GET", "/api/content/folders")).toMatchObject({ folders: [{ id: target.id, item_count: 0 }] });
    expect(await api("DELETE", `/api/content/folders/${target.id}`)).toMatchObject({ ok: true });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE id IN ('note','exam')").get()).toMatchObject({ n: 2 });
  });
  it("exposes content management through MCP and enforces write scopes", async () => {
    for (const scopes of [["study:read"], ["study:read", "study:write"]]) {
      const server = buildServer({ env, ctx, user, scopes, origin: "https://study.test" });
      const client = new Client({ name: "content-test", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);
      try {
        const tools = (await client.listTools()).tools.map((tool) => tool.name);
        for (const name of ["create_content_folder", "update_content_folder", "delete_content_folder", "organize_content"]) {
          expect(tools).toContain(name); expect(WRITE_TOOLS.has(name)).toBe(true);
        }
        expect((await client.callTool({ name: "list_content", arguments: { limit: 1 } })).isError).not.toBe(true);
        const created = await client.callTool({ name: "create_content_folder", arguments: { name: "From MCP" } });
        expect(created.isError === true).toBe(!scopes.includes("study:write"));
      } finally { await client.close(); await server.close(); }
    }
  });
});
