import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../lib/types";
import { requireDocumentAccess, requireDocumentWrite } from "../lib/access";
import { bad, now, readJson, sha256Hex, str, uid } from "../lib/util";
import { getDoc } from "./documents";
import { reviewBlueprint } from "./openmaic-core";
import { LONG_COURSE_MAX_PARTS, LONG_COURSE_SOURCE_CHARS } from "../../shared/long-course";
import { coreConfiguration, coreRequest } from "../lib/openmaic-core";
import { signOpenMaicTicket } from "../../shared/openmaic-transport";

export interface LongCourse { id: string; document_id: string; created_by: string; title: string }
export interface LongCoursePart { id: string; course_id: string; title: string; position: number; source_md: string; source_hash: string; blueprint_json: string; generation_id: string | null; classroom_id: string | null; published_at: number | null }
const routes = new Hono<AppEnv>();
routes.use("*", bodyLimit({ maxSize: 350_000, onError: c => c.json({ error: "請按章節分冊上傳，每冊來源最多 45,000 字元" }, 413) }));
export async function accessibleLongCourse(c: Context<AppEnv>, id: string, write = false) {
  const course = await c.env.DB.prepare("SELECT * FROM long_courses WHERE id=?").bind(id).first<LongCourse>();
  if (!course || !await requireDocumentAccess(c.env, c.get("user"), course.document_id)) bad("找不到總課程", 404);
  if (write && (course.created_by !== c.get("user").id || !await requireDocumentWrite(c.env, c.get("user"), course.document_id))) bad("只有建立者能管理總課程", 403);
  return course;
}
/** The status of a Core call that may find nothing left to do, so retrying a lost response stays safe. */
const missing = (error: unknown) => error instanceof HTTPException && error.status === 404;
/** Deletes a classroom in the Core. A retry after a lost response finds it already gone, which is the same result. */
const deleteClassroom = (c: Context<AppEnv>, classroomId: string) => coreRequest(c.env, c.get("user").id, "DELETE", `/api/stages/${encodeURIComponent(classroomId)}`).catch((error: unknown) => { if (!missing(error)) throw error; });
/** Ends a run and frees its place in the learner's active-run limit. `keepClassroom` is a published classroom that must survive. Returns the classroom it deleted. */
async function abandonRun(c: Context<AppEnv>, runId: string, keepClassroom: string | null): Promise<string | null> {
  const userId = c.get("user").id, run = encodeURIComponent(runId);
  const found = await coreRequest<{ run?: { stageId?: string | null; state?: string } }>(c.env, userId, "GET", `/api/generation-runs/${run}`).catch((error: unknown) => { if (missing(error)) return null; throw error; });
  const stageId = found?.run?.stageId, state = found?.run?.state;
  if (stageId && stageId !== keepClassroom) await deleteClassroom(c, stageId);
  else if (found?.run && !stageId && state !== "ended" && state !== "completed") await coreRequest(c.env, userId, "DELETE", `/api/generation-runs/${run}`);
  // Leftover tasks only clutter the task list, so a failure here does not undo the reset.
  await coreRequest(c.env, userId, "DELETE", `/api/study-mcp/runs/${run}/tasks`).catch((error: unknown) => console.error("Could not clear an abandoned run's tasks", error instanceof Error ? error.message : "Unknown error"));
  return stageId && stageId !== keepClassroom ? stageId : null;
}
const ownedPart = async (c: Context<AppEnv>, courseId: string) => {
  const part = await c.env.DB.prepare("SELECT id,title,position,source_md,blueprint_json,generation_id,classroom_id,start_lease FROM long_course_parts WHERE id=? AND course_id=?").bind(c.req.param("part"), courseId).first<Pick<LongCoursePart, "id" | "title" | "position" | "source_md" | "blueprint_json" | "generation_id" | "classroom_id"> & { start_lease: number | null }>();
  if (!part) bad("找不到分冊", 404);
  return part!;
};
const starting = (part: { start_lease: number | null }) => part.start_lease !== null && part.start_lease >= now() - 120_000;
const page = (v: string | undefined, fallback: number, max: number) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) bad("分頁參數不合法");
  return n;
};
routes.get("/", async c => {
  const slug = c.req.query("note_slug");
  const offset = page(c.req.query("offset"), 0, 1_000_000);
  const limit = Math.max(1, page(c.req.query("limit"), 20, 50));
  let documentId: string | null = null;
  if (slug) {
    const doc = await getDoc(c.env, slug);
    if (!await requireDocumentAccess(c.env, c.get("user"), doc.id)) bad("找不到筆記", 404);
    documentId = doc.id;
  }
  const { results } = await c.env.DB.prepare(`SELECT lc.*,d.slug AS note_slug,
    (SELECT COUNT(*) FROM long_course_parts p WHERE p.course_id=lc.id) AS total_parts,
    (SELECT COUNT(*) FROM long_course_parts p WHERE p.course_id=lc.id AND p.published_at IS NOT NULL) AS published_parts
    FROM long_courses lc JOIN documents d ON d.id=lc.document_id
    WHERE ${documentId ? "lc.document_id=?" : "lc.created_by=?"} ORDER BY lc.created_at DESC,lc.id LIMIT ? OFFSET ?`)
    .bind(documentId ?? c.get("user").id, limit + 1, offset).all<LongCourse>();
  const allowed = [];
  for (const row of results.slice(0, limit)) if (await requireDocumentAccess(c.env, c.get("user"), row.document_id)) allowed.push(row);
  return c.json({ courses: allowed, next_offset: results.length > limit ? offset + limit : null });
});
routes.post("/", async c => {
  const b = await readJson<{ note_slug?: string; title?: string }>(c.req.raw);
  const doc = await getDoc(c.env, str(b.note_slug, "note_slug", { max: 200 }));
  if (doc.kind !== "note" || !await requireDocumentAccess(c.env, c.get("user"), doc.id) || !await requireDocumentWrite(c.env, c.get("user"), doc.id)) bad("無法為此筆記建立總課程", 403);
  const id = uid();
  const title = str(b.title, "title", { max: 200 });
  await c.env.DB.prepare("INSERT INTO long_courses(id,document_id,created_by,title,created_at) VALUES (?,?,?,?,?)").bind(id, doc.id, c.get("user").id, title, now()).run();
  return c.json({ id, title, max_source_chars_per_part: LONG_COURSE_SOURCE_CHARS, max_parts: LONG_COURSE_MAX_PARTS }, 201);
});
routes.get("/:id", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"));
  const owner = course.created_by === c.get("user").id;
  const offset = page(c.req.query("offset"), 0, LONG_COURSE_MAX_PARTS);
  const limit = Math.max(1, page(c.req.query("limit"), 30, 100));
  const visibility = owner ? "" : " AND published_at IS NOT NULL";
  const counts = await c.env.DB.prepare(`SELECT COUNT(*) AS total_parts,COUNT(published_at) AS published_parts,COALESCE(SUM(source_chars),0) AS source_chars FROM long_course_parts WHERE course_id=?${visibility}`).bind(course.id).first();
  const { results } = await c.env.DB.prepare(`SELECT id,part_key,position,title,source_hash,source_chars,generation_id,generation_attempt,classroom_id,published_at FROM long_course_parts WHERE course_id=?${visibility} ORDER BY position LIMIT ? OFFSET ?`).bind(course.id, limit + 1, offset).all();
  return c.json({ course, ...counts, parts: results.slice(0, limit), next_offset: results.length > limit ? offset + limit : null });
});
routes.post("/:id/parts", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const b = await readJson<{ part_key?: string; title?: string; source_md?: string; blueprint?: unknown }>(c.req.raw);
  const key = str(b.part_key, "part_key", { max: 80 });
  const title = str(b.title, "title", { max: 200 });
  const source = str(b.source_md, "source_md", { max: LONG_COURSE_SOURCE_CHARS });
  if (!source.trim()) bad("來源不可為空白");
  const doc = await getDoc(c.env, course.document_id);
  const report = await reviewBlueprint(c, doc.subject_id, b.blueprint);
  if (!report.ok || !report.value) bad("分冊藍圖未通過檢查", 422, { errors: report.errors, warnings: report.warnings });
  const json = JSON.stringify(report.value);
  const hash = await sha256Hex(JSON.stringify({ title, source, blueprint: report.value }));
  const existing = await c.env.DB.prepare("SELECT id,source_hash,position FROM long_course_parts WHERE course_id=? AND part_key=?").bind(course.id, key).first<{ id: string; source_hash: string; position: number }>();
  if (existing) {
    if (existing.source_hash !== hash) bad("part_key 已存在但內容不同，請使用新 key", 409);
    return c.json({ ...existing, reused: true });
  }
  const id = uid();
  // Position is allocated inside one statement so simultaneous appends cannot choose the same index.
  const inserted = await c.env.DB.prepare(`INSERT INTO long_course_parts(id,course_id,part_key,position,title,source_md,source_hash,blueprint_json,created_at,source_chars)
    SELECT ?,?,?,COALESCE(MAX(position),0)+1,?,?,?,?,?,? FROM long_course_parts WHERE course_id=? HAVING COUNT(*)<? ON CONFLICT(course_id,part_key) DO NOTHING RETURNING id,position`)
    .bind(id, course.id, key, title, source, hash, json, now(), Array.from(source).length, course.id, LONG_COURSE_MAX_PARTS).first<{ id: string; position: number }>();
  if (!inserted) {
    const raced = await c.env.DB.prepare("SELECT id,source_hash,position FROM long_course_parts WHERE course_id=? AND part_key=?").bind(course.id, key).first<{ id: string; source_hash: string; position: number }>();
    if (raced) {
      if (raced.source_hash !== hash) bad("part_key 已存在但內容不同，請使用新 key", 409);
      return c.json({ ...raced, reused: true });
    }
    bad("總課程已達 10,000 冊上限，請建立另一個總課程", 413);
  }
  return c.json({ ...inserted, source_hash: hash, warnings: report.warnings }, 201);
});
routes.get("/:id/parts/:part", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const part = await c.env.DB.prepare("SELECT * FROM long_course_parts WHERE id=? AND course_id=?").bind(c.req.param("part"), course.id).first<LongCoursePart>();
  if (!part) bad("找不到分冊", 404);
  const offset = page(c.req.query("offset"), 0, LONG_COURSE_SOURCE_CHARS);
  const limit = Math.max(1, page(c.req.query("limit"), 12_000, 24_000));
  const source = Array.from(part.source_md);
  if (offset > source.length) bad("offset 超過來源長度");
  return c.json({ id: part.id, title: part.title, generation_id: part.generation_id, blueprint: JSON.parse(part.blueprint_json), source_hash: part.source_hash, source_md: source.slice(offset, offset + limit).join(""), offset, offset_unit: "unicode_codepoints", total_chars: source.length, next_offset: offset + limit < source.length ? offset + limit : null });
});
// An unstarted part can still change. A started one is reset first, so a classroom never disagrees with the source it was made from.
routes.patch("/:id/parts/:part", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const part = await ownedPart(c, course.id);
  if (part.generation_id || starting(part)) bad("這一冊已開始生成：先 reset_long_course_part 放棄這次生成，才能修改", 409);
  const b = await readJson<{ title?: string; source_md?: string; blueprint?: unknown }>(c.req.raw);
  const title = b.title === undefined ? part.title : str(b.title, "title", { max: 200 });
  const source = b.source_md === undefined ? part.source_md : str(b.source_md, "source_md", { max: LONG_COURSE_SOURCE_CHARS });
  if (!source.trim()) bad("來源不可為空白");
  const doc = await getDoc(c.env, course.document_id);
  const report = await reviewBlueprint(c, doc.subject_id, b.blueprint === undefined ? JSON.parse(part.blueprint_json) : b.blueprint);
  if (!report.ok || !report.value) bad("分冊藍圖未通過檢查", 422, { errors: report.errors, warnings: report.warnings });
  const hash = await sha256Hex(JSON.stringify({ title, source, blueprint: report.value }));
  const updated = await c.env.DB.prepare("UPDATE long_course_parts SET title=?,source_md=?,source_hash=?,blueprint_json=?,source_chars=? WHERE id=? AND generation_id IS NULL RETURNING id,position").bind(title, source, hash, JSON.stringify(report.value), Array.from(source).length, part.id).first<{ id: string; position: number }>();
  if (!updated) bad("這一冊已開始生成：先 reset_long_course_part 放棄這次生成，才能修改", 409);
  return c.json({ ...updated, source_hash: hash, warnings: report.warnings });
});
routes.post("/:id/parts/:part/move", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const part = await ownedPart(c, course.id);
  const { position } = await readJson<{ position?: unknown }>(c.req.raw);
  if (!Number.isSafeInteger(position) || (position as number) < 1) bad("position 必須是從 1 起算的整數");
  const total = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM long_course_parts WHERE course_id=?").bind(course.id).first<{ n: number }>();
  const from = part.position, to = Math.min(position as number, total!.n);
  if (from === to) return c.json({ id: part.id, position: to, moved: false });
  const low = Math.min(from, to), high = Math.max(from, to), shift = to < from ? 1 : -1;
  // Negated first: UNIQUE(course_id,position) is checked row by row, so shifting in place could collide halfway.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE long_course_parts SET position=-position WHERE course_id=? AND position BETWEEN ? AND ?").bind(course.id, low, high),
    c.env.DB.prepare("UPDATE long_course_parts SET position=-position+? WHERE course_id=? AND position<0 AND id<>?").bind(shift, course.id, part.id),
    c.env.DB.prepare("UPDATE long_course_parts SET position=? WHERE id=?").bind(to, part.id),
  ]);
  return c.json({ id: part.id, position: to, moved: true });
});
// Gives up the current run so the part can be edited and generated again. A published classroom stays open to learners until the new one is published.
routes.post("/:id/parts/:part/reset", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const part = await ownedPart(c, course.id);
  if (starting(part)) bad("分冊正在啟動，稍後再試", 409);
  if (!part.generation_id) return c.json({ id: part.id, reset: false });
  await abandonRun(c, part.generation_id, part.classroom_id);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE long_course_parts SET generation_id=NULL,start_lease=NULL,generation_attempt=generation_attempt+1 WHERE id=? AND generation_id=?").bind(part.id, part.generation_id),
    c.env.DB.prepare("DELETE FROM openmaic_core_runs WHERE id=?").bind(part.generation_id),
  ]);
  return c.json({ id: part.id, reset: true, next_action: "可用 update_long_course_part 修改，再 start_long_course_part 重新生成" });
});
routes.delete("/:id/parts/:part", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const part = await ownedPart(c, course.id);
  if (starting(part)) bad("分冊正在啟動，稍後再試", 409);
  const gone = part.generation_id ? await abandonRun(c, part.generation_id, null) : null;
  if (part.classroom_id && part.classroom_id !== gone) await deleteClassroom(c, part.classroom_id);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM long_course_parts WHERE id=?").bind(part.id),
    ...(part.generation_id ? [c.env.DB.prepare("DELETE FROM openmaic_core_runs WHERE id=?").bind(part.generation_id)] : []),
    c.env.DB.prepare("UPDATE long_course_parts SET position=-position WHERE course_id=? AND position>?").bind(course.id, part.position),
    c.env.DB.prepare("UPDATE long_course_parts SET position=-position-1 WHERE course_id=? AND position<0").bind(course.id),
  ]);
  return c.json({ deleted: true, id: part.id });
});
// Bounded by the Core calls one request can make: a larger course is emptied part by part first.
const MAX_STARTED_PARTS_PER_DELETE = 10;
routes.delete("/:id", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"), true);
  const { results } = await c.env.DB.prepare("SELECT id,generation_id,classroom_id FROM long_course_parts WHERE course_id=? AND (generation_id IS NOT NULL OR classroom_id IS NOT NULL) LIMIT ?").bind(course.id, MAX_STARTED_PARTS_PER_DELETE + 1).all<{ id: string; generation_id: string | null; classroom_id: string | null }>();
  if (results.length > MAX_STARTED_PARTS_PER_DELETE) bad(`這門課有超過 ${MAX_STARTED_PARTS_PER_DELETE} 冊已開始生成：先用 delete_long_course_part 逐冊刪除`, 409);
  for (const part of results) {
    const gone = part.generation_id ? await abandonRun(c, part.generation_id, null) : null;
    if (part.classroom_id && part.classroom_id !== gone) await deleteClassroom(c, part.classroom_id);
  }
  const runs = results.flatMap(part => part.generation_id ? [part.generation_id] : []);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM long_courses WHERE id=?").bind(course.id),
    ...runs.map(run => c.env.DB.prepare("DELETE FROM openmaic_core_runs WHERE id=?").bind(run)),
  ]);
  return c.json({ deleted: true, id: course.id });
});
routes.post("/:id/parts/:part/launch", async c => {
  const course = await accessibleLongCourse(c, c.req.param("id"));
  const part = await c.env.DB.prepare("SELECT classroom_id FROM long_course_parts WHERE id=? AND course_id=? AND published_at IS NOT NULL").bind(c.req.param("part"), course.id).first<{ classroom_id: string }>();
  if (!part?.classroom_id) bad("分冊尚未發布", 404);
  const { secret } = coreConfiguration(c.env);
  const ticket = await signOpenMaicTicket({ sub: `study:${c.get("user").id}`, aud: "study-openmaic", scope: "classroom", classroom_id: part.classroom_id, session_hash: c.get("sessionHash"), exp: now() + 60_000 }, secret);
  return c.json({ action: "/api/study-mcp/session", ticket, classroom_id: part.classroom_id });
});
export default routes;
