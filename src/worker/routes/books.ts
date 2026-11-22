// 電子書：書架、20MB 分段上傳（R2 multipart）、Range 串流、標注、進度、書籤。
import { Hono } from "hono";
import { z } from "zod";
import { ibResourceSchema, type IbResourceMetadata } from "../../shared/ib-resources";
import { syllabusTermSchema, type SyllabusTerm } from "../../shared/syllabus";
import type { BookKind } from "../../shared/access";
import type { AppEnv } from "../lib/types";
import { requireAdmin } from "../lib/auth";
import { bad, now, readJson, str, uid } from "../lib/util";
import { assertStorage } from "../lib/quota";
import { audit } from "../lib/audit";

export const PART_SIZE = 20 * 1024 * 1024; // 每段 20MB（R2 規定：除最後一段外大小須一致，且 ≥ 5MiB）
const MAX_BOOK_BYTES = 2 * 1024 ** 3;
const MAX_BOOKLET_BYTES = 100 * 1024 ** 2;

/** 電子書只有管理員能上傳；資料手冊（kind=booklet）所有成員都能上傳，但只能操作自己建立的上傳作業 */
async function assertCanUpload(c: { env: Env; get: (k: "user") => { id: string; role: string } }, up: { book_id: string; created_by?: string | null }) {
  const user = c.get("user");
  if (user.role === "admin") return;
  const book = await c.env.DB.prepare("SELECT kind FROM books WHERE id = ?").bind(up.book_id).first<{ kind: string }>();
  if (book?.kind !== "booklet" || up.created_by !== user.id) bad("需要管理員權限", 403);
}

const books = new Hono<AppEnv>();

books.get("/", async (c) => {
  const parsed = z.object({
    kind: z.enum(["book", "booklet", "syllabus"]).default("book"),
    academic_year: z.coerce.number().int().min(1900).max(2200).optional(),
    semester: z.enum(["1", "2", "summer"]).optional(), subject: z.string().optional(),
    collection:z.enum(["ib"]).optional(), ib_document_type:ibResourceSchema.shape.ib_document_type.optional(), ib_level:z.enum(["both","SL","HL"]).optional(),
  }).safeParse(c.req.query());
  if (!parsed.success) bad("書架篩選條件不正確");
  const { academic_year, semester, subject, collection, ib_document_type, ib_level } = parsed.data;
  const kind = collection === 'ib' ? 'syllabus' : parsed.data.kind;
  if (collection !== 'ib' && (ib_document_type || ib_level)) bad('IB 文件篩選需要 collection=ib');
  if (collection === 'ib' && (academic_year !== undefined || semester !== undefined)) bad('IB 文件依版本分類，不使用學年度／學期篩選');
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.title, b.kind, b.subject_id, b.size_bytes, b.page_count, b.page_offset, b.has_text_layer, b.status, b.academic_year, b.semester,
            b.ib_document_type,b.ib_level,b.ib_first_assessment_year,b.ib_version, b.cover_key IS NOT NULL AS has_cover, b.updated_at, p.page AS last_page
       FROM books b LEFT JOIN reading_progress p ON p.book_id = b.id AND p.user_id = ?
      WHERE b.kind = ? AND (b.status = 'ready' OR ? = 'admin')
        AND NOT EXISTS (SELECT 1 FROM content_organization o WHERE o.user_id=? AND o.content_type='book' AND o.content_id=b.id AND o.archived_at IS NOT NULL)
        AND ${collection === 'ib' ? 'b.ib_document_type IS NOT NULL' : 'b.ib_document_type IS NULL'}
        AND (? IS NULL OR b.ib_document_type=?) AND (? IS NULL OR b.ib_level=? OR (? IN ('SL','HL') AND b.ib_level='both'))
        AND (? IS NULL OR b.academic_year=?) AND (? IS NULL OR b.semester=?) AND (? IS NULL OR b.subject_id=?)
      ORDER BY b.subject_id, b.title`,
  )
    .bind(c.get("user").id, kind, c.get("user").role, c.get("user").id, ib_document_type ?? null, ib_document_type ?? null, ib_level ?? null, ib_level ?? null, ib_level ?? null, academic_year ?? null, academic_year ?? null, semester ?? null, semester ?? null, subject || null, subject || null)
    .all();
  return c.json({ books: results });
});

books.get("/:id", async (c) => {
  const book = await c.env.DB.prepare("SELECT * FROM books WHERE id = ?").bind(c.req.param("id")).first();
  if (!book) bad("找不到此書", 404);
  const progress = await c.env.DB.prepare("SELECT page,updated_at,COALESCE(changed_at,updated_at) AS changed_at FROM reading_progress WHERE user_id = ? AND book_id = ?")
    .bind(c.get("user").id, c.req.param("id"))
    .first<{ page: number; updated_at: number; changed_at: number }>();
  // A chapter's PDF names its chapter, so the reader can link back to it.
  const chapter = (book as { kind?: string }).kind === "chapter"
    ? await c.env.DB.prepare("SELECT t.id, t.title FROM chapter_materials m JOIN topics t ON t.id = m.topic_id WHERE m.book_id = ?").bind(c.req.param("id")).first<{ id: string; title: string }>()
    : null;
  return c.json({ book: { ...book, chapter: chapter ?? null }, owner_id: c.get("user").id, lastPage: progress?.page ?? null, progress_updated_at: progress?.updated_at ?? null, progress_changed_at: progress?.changed_at ?? null });
});

/** PDF 串流：支援 Range（pdf.js 分段載入）。物件不公開，一律經 session 驗證。 */
books.get("/:id/file", async (c) => {
  const book = await c.env.DB.prepare("SELECT r2_key, status FROM books WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ r2_key: string; status: string }>();
  if (!book || book.status !== "ready") bad("找不到此書", 404);
  return serveBookFile(c.env, c.req.raw, book.r2_key);
});

/** The PDF bytes (or the requested range) of a book the caller is already allowed to read. */
export async function serveBookFile(env: Env, request: Request, r2Key: string): Promise<Response> {
  const range = request.headers.get("range");
  const obj = await env.BUCKET.get(r2Key, { range: range ? request.headers : undefined, onlyIf: request.headers });
  if (!obj) bad("檔案不存在", 404);
  const headers = new Headers({
    "content-type": "application/pdf",
    "accept-ranges": "bytes",
    etag: obj.httpEtag,
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
  });
  if (!("body" in obj) || !obj.body) {
    const ifMatch = request.headers.get("if-match");
    const matches = ifMatch?.split(",").some((tag) => tag.trim() === "*" || tag.trim() === obj.httpEtag);
    return new Response(null, { status: ifMatch && !matches ? 412 : 304, headers });
  }
  if (range && obj.range && "offset" in obj.range) {
    const offset = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

books.get("/:id/cover", async (c) => {
  const book = await c.env.DB.prepare("SELECT cover_key FROM books WHERE id = ?").bind(c.req.param("id")).first<{ cover_key: string | null }>();
  if (!book?.cover_key) return c.body(null, 404);
  const obj = await c.env.BUCKET.get(book.cover_key);
  if (!obj) return c.body(null, 404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/webp", "cache-control": "private, max-age=604800" } });
});

// ---------- 管理：分段上傳 ----------
books.post("/uploads", async (c) => {
  const body = await readJson<{ owner_id?: string; title: string; subject_id?: string; size: number; filename?: string; page_count?: number; has_text_layer?: boolean; book_id?: string; kind?: BookKind; academic_year?: number; semester?: SyllabusTerm["semester"]; ib_document_type?:IbResourceMetadata["ib_document_type"]; ib_level?:IbResourceMetadata["ib_level"]; ib_first_assessment_year?:number|null; ib_version?:string }>(c.req.raw);
  if (body.owner_id !== undefined && body.owner_id !== c.get("user").id) bad("上傳作業屬於另一個帳號，請重新選擇檔案", 409);
  if (body.ib_document_type !== undefined && c.get("user").role !== "admin") bad("只有管理員可以上傳 IB 科目文件",403);
  const parsedKind = z.enum(["book", "booklet", "syllabus"]).safeParse(body.kind ?? "book");
  if (!parsedKind.success) bad("檔案類型不正確");
  let kind = parsedKind.data;
  if (body.book_id) {
    if (c.get("user").role !== "admin") bad("只有管理員可以替換檔案", 403);
    const existing = await c.env.DB.prepare("SELECT kind FROM books WHERE id=?").bind(body.book_id).first<{ kind: BookKind }>();
    if (!existing) bad("找不到要替換的書", 404);
    if (existing.kind === "chapter") bad("章節的 PDF 請從章節重新上傳", 400);
    kind = existing.kind as typeof kind;
  }
  if (kind !== "booklet" && c.get("user").role !== "admin") bad("只有管理員可以上傳電子書與學期課綱", 403);
  let ib: IbResourceMetadata | undefined;
  if (!body.book_id && body.ib_document_type !== undefined) {
    if (kind !== 'syllabus') bad('IB 文件必須使用課綱文件類型');
    const parsed = ibResourceSchema.safeParse(body);
    if (!parsed.success) bad('請指定 IB 文件類型與有效的級別／版本資料');
    ib = parsed.data;
  } else if (!body.book_id && (body.ib_level !== undefined || body.ib_first_assessment_year !== undefined || body.ib_version !== undefined)) bad('請指定 IB 文件類型');
  let term: SyllabusTerm | undefined;
  if (kind === "syllabus" && !ib && !body.book_id) {
    const parsed = syllabusTermSchema.safeParse(body);
    if (!parsed.success) bad("請指定有效的西元學年度與學期");
    term = parsed.data;
  }
  const title = str(body.title, "title", { max: 200 });
  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size <= 0) bad("size 不正確");
  if (size > (kind === "book" ? MAX_BOOK_BYTES : MAX_BOOKLET_BYTES)) bad(kind === "book" ? "單一檔案上限 2GB" : "資料手冊與課綱上限 100MB", 413);
  await assertStorage(c.env, size);
  const t = now();
  // 若指定 book_id 則為「替換檔案」，保留標注與進度
  let bookId = body.book_id;
  if (!bookId) {
    bookId = uid();
    await c.env.DB.prepare(
      "INSERT INTO books (id, subject_id, title, kind, size_bytes, page_count, has_text_layer, academic_year, semester, ib_document_type,ib_level,ib_first_assessment_year,ib_version, status, uploaded_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'uploading', ?,?,?)",
    )
      .bind(bookId, ib ? null : (body.subject_id || null), title, kind, 0, body.page_count ?? null, body.has_text_layer == null ? null : body.has_text_layer ? 1 : 0, term?.academic_year ?? null, term?.semester ?? null, ib?.ib_document_type ?? null, ib?.ib_level ?? null, ib?.ib_first_assessment_year ?? null, ib?.ib_version ?? null, c.get("user").id, t, t)
      .run();
  }
  const key = `books/${bookId}/${t}.pdf`;
  const mpu = await c.env.BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { title, filename: (body.filename ?? "").slice(0, 200) },
  });
  const partCount = Math.ceil(size / PART_SIZE);
  await c.env.DB.prepare(
    "INSERT INTO uploads (id, book_id, r2_key, size_bytes, part_size, part_count, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
  )
    .bind(mpu.uploadId, bookId, key, size, PART_SIZE, partCount, c.get("user").id, t)
    .run();
  return c.json({ uploadId: mpu.uploadId, bookId, partSize: PART_SIZE, partCount });
});

async function getUpload(c: { env: Env }, uploadId: string) {
  const up = await c.env.DB.prepare("SELECT * FROM uploads WHERE id = ?").bind(uploadId).first<{
    id: string; book_id: string; r2_key: string; size_bytes: number; part_size: number; part_count: number; completed_at: number | null; created_by: string | null;
  }>();
  if (!up) bad("找不到上傳作業", 404);
  if (up.completed_at) bad("此上傳已完成", 409);
  return up;
}

/** 續傳：回傳已完成的段落 */
books.get("/uploads/:uploadId", async (c) => {
  const up = await getUpload(c, c.req.param("uploadId"));
  await assertCanUpload(c, up);
  const { results } = await c.env.DB.prepare("SELECT part_number FROM upload_parts WHERE upload_id = ?").bind(up.id).all<{ part_number: number }>();
  return c.json({ ...up, doneParts: results.map((r) => r.part_number) });
});

books.put("/uploads/:uploadId/parts/:n", async (c) => {
  const up = await getUpload(c, c.req.param("uploadId"));
  await assertCanUpload(c, up);
  const n = Number(c.req.param("n"));
  if (!Number.isInteger(n) || n < 1 || n > up.part_count) bad("段落編號錯誤");
  const expected = n < up.part_count ? up.part_size : up.size_bytes - up.part_size * (up.part_count - 1);
  const len = Number(c.req.header("content-length"));
  if (len && len !== expected) bad(`第 ${n} 段大小應為 ${expected} bytes，收到 ${len}`);
  if (!c.req.raw.body) bad("沒有內容");
  const mpu = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.id);
  // 直接串流請求本體到 R2（不在 Worker 記憶體中緩衝 20MB）
  const body = len ? c.req.raw.body : await c.req.arrayBuffer();
  const part = await mpu.uploadPart(n, body as ReadableStream);
  await c.env.DB.prepare("INSERT OR REPLACE INTO upload_parts (upload_id, part_number, etag, size_bytes) VALUES (?,?,?,?)")
    .bind(up.id, n, part.etag, expected)
    .run();
  return c.json({ partNumber: n, etag: part.etag });
});

books.post("/uploads/:uploadId/complete", async (c) => {
  const up = await getUpload(c, c.req.param("uploadId"));
  await assertCanUpload(c, up);
  const { results } = await c.env.DB.prepare("SELECT part_number, etag FROM upload_parts WHERE upload_id = ? ORDER BY part_number")
    .bind(up.id)
    .all<{ part_number: number; etag: string }>();
  if (results.length !== up.part_count) bad(`尚有 ${up.part_count - results.length} 段未上傳`, 409);
  const mpu = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.id);
  const obj = await mpu.complete(results.map((r) => ({ partNumber: r.part_number, etag: r.etag })));
  const head = await c.env.BUCKET.head(up.r2_key);
  const first = await c.env.BUCKET.get(up.r2_key, { range: { offset: 0, length: 5 } });
  const magic = first ? await first.text() : "";
  if (magic !== "%PDF-") {
    await c.env.BUCKET.delete(up.r2_key);
    bad("檔案不是 PDF", 422);
  }
  const old = await c.env.DB.prepare("SELECT r2_key FROM books WHERE id = ?").bind(up.book_id).first<{ r2_key: string | null }>();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE books SET r2_key = ?, size_bytes = ?, status = 'ready', updated_at = ? WHERE id = ?").bind(up.r2_key, head?.size ?? obj.size, t, up.book_id),
    c.env.DB.prepare("UPDATE uploads SET completed_at = ? WHERE id = ?").bind(t, up.id),
    c.env.DB.prepare("DELETE FROM upload_parts WHERE upload_id = ?").bind(up.id),
  ]);
  if (old?.r2_key && old.r2_key !== up.r2_key) c.executionCtx.waitUntil(c.env.BUCKET.delete(old.r2_key));
  await audit(c.env.DB, c.get("user").id, "book.upload", "book", up.book_id, { size: head?.size });
  return c.json({ bookId: up.book_id, size: head?.size ?? obj.size });
});

books.delete("/uploads/:uploadId", async (c) => {
  const up = await getUpload(c, c.req.param("uploadId"));
  await assertCanUpload(c, up);
  await c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.id).abort().catch(() => undefined);
  await c.env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(up.id).run();
  await c.env.DB.prepare("DELETE FROM books WHERE id = ? AND status = 'uploading'").bind(up.book_id).run();
  return c.json({ ok: true });
});

books.put("/:id", requireAdmin, async (c) => {
  const body = await readJson<{ title?: string; subject_id?: string | null; page_offset?: number; page_count?: number; has_text_layer?: boolean; academic_year?: number; semester?: SyllabusTerm["semester"]; ib_document_type?:IbResourceMetadata["ib_document_type"]; ib_level?:IbResourceMetadata["ib_level"]; ib_first_assessment_year?:number|null; ib_version?:string }>(c.req.raw);
  const id = c.req.param("id");
  const book = await c.env.DB.prepare("SELECT kind,academic_year,semester,subject_id,ib_document_type,ib_level,ib_first_assessment_year,ib_version FROM books WHERE id=?").bind(id).first<{ kind: BookKind; academic_year: number | null; semester: string | null } & Partial<IbResourceMetadata>>();
  if (!book) bad("找不到此書", 404);
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (body.title !== undefined) (fields.push("title = ?"), vals.push(str(body.title, "title", { max: 200 })));
  if (body.subject_id !== undefined && !book.ib_document_type) (fields.push("subject_id = ?"), vals.push(body.subject_id || null));
  if (body.page_offset !== undefined) (fields.push("page_offset = ?"), vals.push(Math.trunc(Number(body.page_offset)) || 0));
  if (body.page_count !== undefined) (fields.push("page_count = ?"), vals.push(Math.trunc(Number(body.page_count)) || null));
  if (body.has_text_layer !== undefined) (fields.push("has_text_layer = ?"), vals.push(body.has_text_layer ? 1 : 0));
  if (book.ib_document_type) {
    if (body.academic_year !== undefined || body.semester !== undefined) bad('IB 文件不使用學年度／學期，請編輯適用版本');
    const parsed = ibResourceSchema.safeParse({...book,...body});
    if (!parsed.success) bad('IB 文件的類型／級別／版本資料須有效');
    for (const key of ['ib_document_type','ib_level','ib_first_assessment_year','ib_version'] as const) {
      if (body[key] !== undefined) { fields.push(key+' = ?'); vals.push(parsed.data[key]); }
    }
  } else if (body.ib_document_type !== undefined || body.ib_level !== undefined || body.ib_first_assessment_year !== undefined || body.ib_version !== undefined) bad('一般書本／學期課綱不能改為 IB 文件，請從 IB 文件入口上傳');
  if (body.academic_year !== undefined || body.semester !== undefined) {
    if (book.kind !== "syllabus") bad("僅學期課綱可以設定學年度與學期");
    const parsed = syllabusTermSchema.safeParse({ academic_year: body.academic_year === undefined ? book.academic_year : body.academic_year, semester: body.semester === undefined ? book.semester : body.semester });
    if (!parsed.success) bad("學年度或學期不正確");
    fields.push("academic_year = ?", "semester = ?"); vals.push(parsed.data.academic_year, parsed.data.semester);
  }
  if (!fields.length) bad("沒有可更新的欄位");
  fields.push("updated_at = ?");
  vals.push(now(), id);
  await c.env.DB.prepare(`UPDATE books SET ${fields.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

books.put("/:id/cover", async (c) => {
  if (c.get("user").role !== "admin") {
    const b = await c.env.DB.prepare("SELECT kind, uploaded_by FROM books WHERE id = ?").bind(c.req.param("id")).first<{ kind: string; uploaded_by: string }>();
    if (b?.kind !== "booklet" || b.uploaded_by !== c.get("user").id) bad("需要管理員權限", 403);
  }
  const type = c.req.header("content-type") ?? "";
  if (!/^image\/(webp|png|jpeg)$/.test(type)) bad("封面需為 webp/png/jpeg");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > 2 * 1024 * 1024) bad("封面過大", 413);
  const key = `books/${c.req.param("id")}/cover-${now()}.${type.split("/")[1]}`;
  await c.env.BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  const old = await c.env.DB.prepare("SELECT cover_key FROM books WHERE id = ?").bind(c.req.param("id")).first<{ cover_key: string | null }>();
  await c.env.DB.prepare("UPDATE books SET cover_key = ? WHERE id = ?").bind(key, c.req.param("id")).run();
  if (old?.cover_key) c.executionCtx.waitUntil(c.env.BUCKET.delete(old.cover_key));
  return c.json({ ok: true });
});

books.delete("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const book = await c.env.DB.prepare("SELECT kind, r2_key, cover_key FROM books WHERE id = ?").bind(id).first<{ kind: string; r2_key: string | null; cover_key: string | null }>();
  if (book?.kind === "chapter") bad("章節的 PDF 請從章節刪除教材", 400);
  if (!book) bad("找不到此書", 404);
  const pending = await c.env.DB.prepare("SELECT id,r2_key FROM uploads WHERE book_id=? AND completed_at IS NULL").bind(id).all<{id:string;r2_key:string}>();
  for(const upload of pending.results) await c.env.BUCKET.resumeMultipartUpload(upload.r2_key,upload.id).abort().catch(()=>undefined);
  const keys = [book.r2_key, book.cover_key].filter(Boolean) as string[];
  if (keys.length) await c.env.BUCKET.delete(keys);
  await c.env.DB.prepare("DELETE FROM books WHERE id = ?").bind(id).run();
  await audit(c.env.DB, c.get("user").id, "book.delete", "book", id);
  return c.json({ ok: true });
});

// ---------- 標注 ----------
const ANN_TYPES = ["highlight", "underline", "strike", "ink", "rect", "note"];

books.get("/:id/annotations", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.page, a.type, a.data_json, a.color, a.visibility, a.user_id, a.updated_at, u.name AS author
       FROM annotations a JOIN users u ON u.id = a.user_id
      WHERE a.book_id = ? AND a.deleted_at IS NULL AND (a.user_id = ? OR a.visibility = 'shared')`,
  )
    .bind(c.req.param("id"), c.get("user").id)
    .all();
  return c.json({ owner_id: c.get("user").id, annotations: results });
});

books.post("/:id/annotations", async (c) => {
  const b = await readJson<{ id?: string; page: number; type: string; data: unknown; color?: string; visibility?: string }>(c.req.raw);
  if (!ANN_TYPES.includes(b.type)) bad("標注類型錯誤");
  const data = JSON.stringify(b.data ?? {});
  if (data.length > 200_000) bad("標注資料過大", 413);
  const id = b.id && /^[\w-]{8,64}$/.test(b.id) ? b.id : uid();
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO annotations (id, book_id, user_id, page, type, data_json, color, visibility, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, color = excluded.color, visibility = excluded.visibility, updated_at = excluded.updated_at, deleted_at = NULL
     WHERE annotations.user_id = excluded.user_id`,
  )
    .bind(id, c.req.param("id"), c.get("user").id, Math.trunc(b.page), b.type, data, b.color ?? null, b.visibility === "shared" ? "shared" : "private", t, t)
    .run();
  return c.json({ id });
});

/** 批次新增/刪除（一般橡皮擦：刪除原筆跡、建立剩餘片段；復原/重做） */
books.post("/:id/annotations/batch", async (c) => {
  const b = await readJson<{ owner_id?: string; operation_id?: string; create?: { id: string; page: number; type: string; data: unknown; color?: string; visibility?: string }[]; delete?: string[] }>(c.req.raw);
  if (b.owner_id !== undefined && b.owner_id !== c.get("user").id) bad("標註屬於另一個帳號，請登入原作答帳號後同步", 409);
  const creates = b.create ?? [];
  const deletes = b.delete ?? [];
  if (!Array.isArray(creates) || !Array.isArray(deletes)) bad("標註作業必須提供新增／刪除清單");
  if (creates.length + deletes.length > 300) bad("一次最多 300 筆");
  const userId = c.get("user").id;
  const bookId = c.req.param("id");
  if (b.operation_id !== undefined && (typeof b.operation_id !== "string" || !/^[\w-]{8,80}$/.test(b.operation_id))) bad("標註作業 id 格式錯誤");
  const operation = b.operation_id;
  const hash = operation ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ create: creates, delete: deletes }))))).map(value => value.toString(16).padStart(2, "0")).join("") : null;
  const receipt = async () => c.env.DB.prepare("SELECT payload_hash FROM annotation_operations WHERE user_id=? AND book_id=? AND operation_id=?").bind(userId, bookId, operation!).first<{ payload_hash: string }>();
  if (operation) {
    const previous = await receipt();
    if (previous) {
      if (previous.payload_hash !== hash) bad("這筆標註作業已使用不同內容儲存，請重新載入後再試", 409);
      return c.json({ created: creates.length, deleted: deletes.length, replayed: true });
    }
  }
  const guard = operation ? "NOT EXISTS (SELECT 1 FROM annotation_operations WHERE user_id=? AND book_id=? AND operation_id=?)" : "1";
  const guardValues = operation ? [userId, bookId, operation] : [];
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  for (const id of deletes) {
    if (typeof id !== "string") continue;
    stmts.push(c.env.DB.prepare(`UPDATE annotations SET deleted_at = ? WHERE id = ? AND user_id = ? AND book_id = ? AND ${guard}`).bind(t, id, userId, bookId, ...guardValues));
  }
  for (const a of creates) {
    if (!ANN_TYPES.includes(a.type)) bad("標注類型錯誤");
    if (!/^[\w-]{8,64}$/.test(a.id)) bad("標注 id 格式錯誤");
    const data = JSON.stringify(a.data ?? {});
    if (data.length > 200_000) bad("標注資料過大", 413);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO annotations (id, book_id, user_id, page, type, data_json, color, visibility, created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}
         ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, color = excluded.color, visibility = excluded.visibility, updated_at = excluded.updated_at, deleted_at = NULL
         WHERE annotations.user_id = excluded.user_id AND annotations.book_id = excluded.book_id`,
      ).bind(a.id, bookId, userId, Math.trunc(a.page), a.type, data, a.color ?? null, a.visibility === "shared" ? "shared" : "private", t, t, ...guardValues),
    );
  }
  if (operation) stmts.push(c.env.DB.prepare("INSERT OR IGNORE INTO annotation_operations(user_id,book_id,operation_id,payload_hash,created_at) VALUES (?,?,?,?,?)").bind(userId, bookId, operation, hash, t));
  if (stmts.length) await c.env.DB.batch(stmts);
  if (operation && (await receipt())?.payload_hash !== hash) bad("這筆標註作業已使用不同內容儲存，請重新載入後再試", 409);
  return c.json({ created: creates.length, deleted: deletes.length });
});

books.delete("/:id/annotations/:annId", async (c) => {
  await c.env.DB.prepare("UPDATE annotations SET deleted_at = ? WHERE id = ? AND user_id = ? AND book_id = ?")
    .bind(now(), c.req.param("annId"), c.get("user").id, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// ---------- 閱讀進度與書籤 ----------
books.put("/:id/progress", async (c) => {
  const { page, owner_id, changed_at } = await readJson<{ page: number; owner_id?: string; changed_at?: number }>(c.req.raw);
  if (owner_id !== undefined && owner_id !== c.get("user").id) bad("閱讀進度屬於另一個帳號，請重新開啟這本書", 409);
  if (!Number.isFinite(page) || page < 1) bad("閱讀頁碼不正確");
  const updatedAt = now();
  if (changed_at !== undefined && (!Number.isSafeInteger(changed_at) || changed_at < 1 || changed_at > updatedAt + 300_000)) bad("裝置時間不正確，請調整後再同步閱讀進度");
  const changedAt = changed_at ?? updatedAt;
  await c.env.DB.prepare(
    "INSERT INTO reading_progress (user_id, book_id, page, updated_at,changed_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id, book_id) DO UPDATE SET page = excluded.page, updated_at = excluded.updated_at,changed_at=excluded.changed_at WHERE COALESCE(reading_progress.changed_at,reading_progress.updated_at)<=excluded.changed_at",
  )
    .bind(c.get("user").id, c.req.param("id"), Math.trunc(page), updatedAt, changedAt)
    .run();
  const progress = await c.env.DB.prepare("SELECT page,updated_at,COALESCE(changed_at,updated_at) AS changed_at FROM reading_progress WHERE user_id=? AND book_id=?").bind(c.get("user").id, c.req.param("id")).first<{ page: number; updated_at: number; changed_at: number }>();
  return c.json({ ok: true, page: progress!.page, progress_updated_at: progress!.updated_at, progress_changed_at: progress!.changed_at });
});

books.get("/:id/bookmarks", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, page, label, created_at FROM bookmarks WHERE book_id = ? AND user_id = ? ORDER BY page")
    .bind(c.req.param("id"), c.get("user").id)
    .all();
  return c.json({ bookmarks: results });
});

books.post("/:id/bookmarks", async (c) => {
  const b = await readJson<{ page: number; label?: string; owner_id?: string }>(c.req.raw);
  if (b.owner_id !== undefined && b.owner_id !== c.get("user").id) bad("書籤屬於另一個帳號，請重新開啟這本書", 409);
  const id = uid();
  await c.env.DB.prepare("INSERT INTO bookmarks (id, book_id, user_id, page, label, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, c.req.param("id"), c.get("user").id, Math.trunc(b.page), (b.label ?? "").slice(0, 100) || null, now())
    .run();
  return c.json({ id });
});

books.delete("/:id/bookmarks/:bid", async (c) => {
  await c.env.DB.prepare("DELETE FROM bookmarks WHERE id = ? AND user_id = ? AND book_id = ?").bind(c.req.param("bid"), c.get("user").id, c.req.param("id")).run();
  return c.json({ ok: true });
});

export default books;
