import { Hono, type Context } from "hono";
import { z } from "zod";
import { canAccess, type AccessResource } from "../../shared/access";
import type { ContentItem, ContentType } from "../../shared/content";
import { visibleTo } from "../../shared/visibility";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson, uid } from "../lib/util";

const content = new Hono<AppEnv>();
const typeSchema = z.enum(["document", "book", "deck"]);
const folderSchema = z.string().min(1).max(200).nullable();
const folderCreate = z.object({ name: z.string().trim().min(1).max(120), parent_id: folderSchema.optional() }).strict();
const folderPatch = folderCreate.partial().refine((value) => Object.keys(value).length > 0, "至少提供一個欄位");
const organizationPatch = z.object({ folder_id: folderSchema.optional(), archived: z.boolean().optional(), starred: z.boolean().optional() }).strict();
const hasPatch = (value: z.infer<typeof organizationPatch>) => Object.keys(value).length > 0;
const itemReference = z.object({ type: typeSchema, id: z.string().min(1).max(200) }).strict();
const bulkSchema = organizationPatch.extend({ items: z.array(itemReference).min(1).max(100) }).refine(({ items: _items, ...patch }) => hasPatch(patch), "至少提供一個整理欄位");

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) bad("內容整理欄位不正確", 400, { errors: parsed.error.issues.map((issue) => issue.message) });
  return parsed.data;
}
async function ownFolder(c: Context<AppEnv>, id: string) {
  const folder = await c.env.DB.prepare("SELECT id,name,parent_id FROM content_folders WHERE id=? AND user_id=?").bind(id, c.get("user").id).first<{ id: string; name: string; parent_id: string | null }>();
  if (!folder) bad("找不到資料夾", 404);
  return folder;
}
function accessible(c: Context<AppEnv>, type: ContentType, id: string) {
  const resource = c.get("accessResources").find((item) => item.type === type && item.id === id);
  if (!resource || !visibleTo(resource, c.get("user").id) || !canAccess(c.get("accessRules"), resource.feature, type, id)) bad("找不到此內容", 404);
  return resource;
}
async function existingContent(c: Context<AppEnv>, resource: AccessResource) {
  const table = resource.type === "document" ? "documents" : resource.type === "book" ? "books" : "decks";
  const condition = resource.type === "document" ? " AND status!='archived'" : resource.type === "book" ? " AND status='ready'" : "";
  if (!await c.env.DB.prepare(`SELECT 1 FROM ${table} WHERE id=?${condition}`).bind(resource.id).first()) bad("找不到此內容", 404);
}

content.get("/folders", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(`WITH visible AS (${librarySql}) SELECT f.id,f.name,f.parent_id,f.created_at,f.updated_at,
    (SELECT COUNT(*) FROM visible item WHERE item.folder_id=f.id) AS item_count,
    (SELECT COUNT(*) FROM content_folders child WHERE child.parent_id=f.id AND child.user_id=f.user_id) AS child_count
    FROM content_folders f WHERE f.user_id=? ORDER BY f.name COLLATE NOCASE,f.id`).bind(user.id, user.id, user.role === "admin" ? 1 : 0, user.email.toLowerCase(), user.id).all();
  return c.json({ folders: results });
});
content.post("/folders", async (c) => {
  const body = parse(folderCreate, await readJson(c.req.raw));
  if (body.parent_id) await ownFolder(c, body.parent_id);
  const id = uid(), timestamp = now();
  await c.env.DB.prepare("INSERT INTO content_folders(id,user_id,name,parent_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id, c.get("user").id, body.name, body.parent_id ?? null, timestamp, timestamp).run();
  return c.json({ id, name: body.name, parent_id: body.parent_id ?? null, created_at: timestamp, updated_at: timestamp, item_count: 0, child_count: 0 }, 201);
});
content.put("/folders/:id", async (c) => {
  const folder = await ownFolder(c, c.req.param("id"));
  const body = parse(folderPatch, await readJson(c.req.raw));
  if (body.parent_id) {
    await ownFolder(c, body.parent_id);
    const cycle = await c.env.DB.prepare(`WITH RECURSIVE parents(id,parent_id) AS (
      SELECT id,parent_id FROM content_folders WHERE id=? AND user_id=?
      UNION SELECT f.id,f.parent_id FROM content_folders f JOIN parents p ON f.id=p.parent_id WHERE f.user_id=?
    ) SELECT 1 FROM parents WHERE id=?`).bind(body.parent_id, c.get("user").id, c.get("user").id, folder.id).first();
    if (cycle) bad("資料夾不能移到自己或自己的子資料夾");
  }
  await c.env.DB.prepare("UPDATE content_folders SET name=?,parent_id=?,updated_at=? WHERE id=? AND user_id=?").bind(body.name ?? folder.name, body.parent_id === undefined ? folder.parent_id : body.parent_id, now(), folder.id, c.get("user").id).run();
  return c.json({ ok: true });
});
content.delete("/folders/:id", async (c) => {
  const folder = await ownFolder(c, c.req.param("id"));
  const user = c.get("user");
  // A deleted resource or a later permission change must not strand an otherwise empty folder.
  await c.env.DB.prepare(`DELETE FROM content_organization WHERE user_id=? AND folder_id=? AND NOT EXISTS (
    SELECT 1 FROM (${librarySql}) visible WHERE visible.type=content_organization.content_type AND visible.id=content_organization.content_id
  )`).bind(user.id, folder.id, user.id, user.id, user.role === "admin" ? 1 : 0, user.email.toLowerCase()).run();
  const used = await c.env.DB.prepare("SELECT 1 FROM content_organization WHERE folder_id=? UNION ALL SELECT 1 FROM content_folders WHERE parent_id=? LIMIT 1").bind(folder.id, folder.id).first();
  if (used) bad("請先移出資料夾內的內容與子資料夾", 409);
  await c.env.DB.prepare("DELETE FROM content_folders WHERE id=? AND user_id=?").bind(folder.id, c.get("user").id).run();
  return c.json({ ok: true });
});

// Apply access rules before LIMIT so every page and cursor contains only visible content.
const librarySql = `WITH library AS (
  SELECT id,'document' AS type,kind,title,slug,subject_id,updated_at,visibility,created_by,
    CASE WHEN kind='exam' THEN 'exams' ELSE 'notes' END AS feature,
    (EXISTS(SELECT 1 FROM note_courses nc WHERE nc.document_id=documents.id) OR EXISTS(SELECT 1 FROM long_courses lc JOIN long_course_parts p ON p.course_id=lc.id WHERE lc.document_id=documents.id AND p.published_at IS NOT NULL)) AS has_course FROM documents WHERE status!='archived'
  UNION ALL SELECT id,'book',kind,title,NULL,subject_id,updated_at,'shared',NULL,
    CASE WHEN kind='syllabus' THEN 'syllabi' WHEN kind='booklet' THEN 'booklets' ELSE 'ebooks' END,0 FROM books WHERE status='ready' AND kind<>'chapter'
  UNION ALL SELECT id,'deck','deck',title,NULL,subject_id,updated_at,visibility,created_by,'decks',0 FROM decks
)
SELECT l.id,l.type,l.kind,l.title,l.slug,l.subject_id,l.updated_at,l.has_course,l.visibility,l.created_by,o.folder_id,o.archived_at,COALESCE(o.starred,0) AS starred
FROM library l LEFT JOIN content_organization o ON o.content_type=l.type AND o.content_id=l.id AND o.user_id=?
WHERE (l.visibility='shared' OR l.created_by=?)
AND (?=1 OR NOT EXISTS (
  SELECT 1 FROM access_group_members m JOIN access_rules r ON r.group_id=m.group_id
  WHERE m.email=? AND r.allowed=0 AND ((r.resource_type=l.type AND r.resource_id=l.id)
  OR (r.resource_type='feature' AND r.resource_id=l.feature AND NOT EXISTS (
    SELECT 1 FROM access_rules specific WHERE specific.group_id=r.group_id AND specific.resource_type=l.type AND specific.resource_id=l.id
  )))
))`;
const querySchema = z.object({
  view: z.enum(["active", "archived", "all", "starred"]).default("active"),
  kind: z.enum(["note", "exam", "book", "booklet", "syllabus", "deck"]).optional(),
  folder_id: z.string().min(1).max(200).optional(), q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["recent", "title"]).default("recent"), cursor: z.string().max(2000).optional(),
});
const cursorSchema = z.object({ sort: z.enum(["recent", "title"]), key: z.union([z.string(), z.number()]), type: typeSchema, id: z.string().min(1).max(200) });
content.get("/", async (c) => {
  const query = parse(querySchema, c.req.query());
  if (query.folder_id && query.folder_id !== "root") await ownFolder(c, query.folder_id);
  const user = c.get("user");
  const values: (string | number | null)[] = [user.id, user.id, user.role === "admin" ? 1 : 0, user.email.toLowerCase()];
  let sql = librarySql;
  if (query.view === "active" || query.view === "starred") sql += " AND o.archived_at IS NULL";
  if (query.view === "archived") sql += " AND o.archived_at IS NOT NULL";
  if (query.view === "starred") sql += " AND o.starred=1";
  if (query.kind) { sql += " AND l.kind=?"; values.push(query.kind); }
  if (query.folder_id === "root") sql += " AND o.folder_id IS NULL";
  else if (query.folder_id) { sql += " AND o.folder_id=?"; values.push(query.folder_id); }
  if (query.q) { sql += " AND l.title LIKE ? ESCAPE '\\'"; values.push(`%${query.q.replace(/[\\%_]/g, "\\$&")}%`); }
  const key = query.sort === "title" ? "l.title COLLATE NOCASE" : "l.updated_at";
  if (query.cursor) {
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(atob(query.cursor), (character) => character.charCodeAt(0)))); } catch { bad("分頁游標不正確"); }
    const cursor = parse(cursorSchema, decoded);
    if (cursor.sort !== query.sort || typeof cursor.key !== (query.sort === "title" ? "string" : "number")) bad("分頁游標與排序不符");
    sql += ` AND (${key}${query.sort === "title" ? ">" : "<"}? OR (${key}=? AND (l.type>? OR (l.type=? AND l.id>?))))`;
    values.push(cursor.key, cursor.key, cursor.type, cursor.type, cursor.id);
  }
  sql += ` ORDER BY ${key} ${query.sort === "title" ? "ASC" : "DESC"},l.type,l.id LIMIT ?`;
  values.push(query.limit + 1);
  const { results } = await c.env.DB.prepare(sql).bind(...values).all<Omit<ContentItem, "url" | "starred" | "has_course" | "can_delete"> & { starred: number; has_course: number; visibility: string; created_by: string | null }>();
  const more = results.length > query.limit;
  const items = results.slice(0, query.limit).map(({ visibility, created_by, ...row }) => ({ ...row, starred: !!row.starred, has_course: !!row.has_course,
    can_delete: canDelete(user, row.type, visibility, created_by),
    url: row.type === "document" ? `/${row.kind === "exam" ? "exams" : "notes"}/${encodeURIComponent(row.slug ?? row.id)}` : row.type === "book" ? `/books/${encodeURIComponent(row.id)}` : `/decks/${encodeURIComponent(row.id)}`,
  }));
  const last = items.at(-1);
  const next_cursor = more && last ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ sort: query.sort, key: query.sort === "title" ? last.title : last.updated_at, type: last.type, id: last.id })))) : null;
  return c.json({ items, next_cursor });
});

/** Mirrors the delete routes: documents go to the trash by their creator or an admin; decks are deleted by an admin or the owner of a private deck; books only by an admin. */
function canDelete(user: { id: string; role: string }, type: ContentType, visibility: string, createdBy: string | null): boolean {
  if (user.role === "admin") return true;
  if (type === "document") return createdBy === user.id;
  if (type === "deck") return visibility === "private" && createdBy === user.id;
  return false;
}

async function organize(c: Context<AppEnv>, items: z.infer<typeof itemReference>[], patch: z.infer<typeof organizationPatch>) {
  if (patch.folder_id) await ownFolder(c, patch.folder_id);
  const unique = new Map(items.map((item) => [`${item.type}:${item.id}`, item]));
  for (const item of unique.values()) await existingContent(c, accessible(c, item.type, item.id));
  const timestamp = now(), userId = c.get("user").id;
  await c.env.DB.batch([...unique.values()].map((item) => c.env.DB.prepare(`INSERT INTO content_organization(user_id,content_type,content_id,folder_id,archived_at,starred,updated_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,content_type,content_id) DO UPDATE SET
    folder_id=CASE WHEN ? THEN excluded.folder_id ELSE content_organization.folder_id END,
    archived_at=CASE WHEN ? THEN CASE WHEN excluded.archived_at IS NULL THEN NULL ELSE COALESCE(content_organization.archived_at,excluded.archived_at) END ELSE content_organization.archived_at END,
    starred=CASE WHEN ? THEN excluded.starred ELSE content_organization.starred END,updated_at=excluded.updated_at`)
    .bind(userId, item.type, item.id, patch.folder_id ?? null, patch.archived ? timestamp : null, patch.starred ? 1 : 0, timestamp, patch.folder_id !== undefined ? 1 : 0, patch.archived !== undefined ? 1 : 0, patch.starred !== undefined ? 1 : 0)));
  return { ok: true, updated: unique.size };
}
content.post("/bulk", async (c) => {
  const { items, ...patch } = parse(bulkSchema, await readJson(c.req.raw));
  return c.json(await organize(c, items, patch));
});
content.put("/:type/:id", async (c) => {
  const type = parse(typeSchema, c.req.param("type"));
  const patch = parse(organizationPatch.refine(hasPatch, "至少提供一個整理欄位"), await readJson(c.req.raw));
  return c.json(await organize(c, [{ type, id: c.req.param("id") }], patch));
});
export default content;
