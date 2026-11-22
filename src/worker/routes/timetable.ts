// 個人每週課表：依使用者與學年度／學期保存，網頁與 MCP 共用同一組 API。
import { Hono } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson, uid } from "../lib/util";
import { currentSyllabusTerm, syllabusTermSchema, type SyllabusTerm } from "../../shared/syllabus";
import { MAX_TIMETABLE_ENTRIES, timetableDraftSchema, timetablePatchSchema } from "../../shared/timetable";

const timetable = new Hono<AppEnv>();

interface Row { id: string; academic_year: number; semester: SyllabusTerm["semester"]; day: number; start_time: string; end_time: string; title: string; room: string | null; subject_id: string | null; updated_at: number }
const view = (r: Row) => ({ id: r.id, academic_year: r.academic_year, semester: r.semester, day: r.day, start: r.start_time, end: r.end_time, title: r.title, room: r.room ?? undefined, subject_id: r.subject_id, updated_at: r.updated_at });

function invalid(error: z.ZodError): never {
  bad(`課表資料不正確：${error.issues.map((i) => `${i.path.join(".") || "資料"} ${i.message}`).join("；")}`, 400);
}

function parseTerm(raw: { academic_year?: unknown; semester?: unknown }): SyllabusTerm {
  const fallback = currentSyllabusTerm();
  const parsed = syllabusTermSchema.safeParse({
    academic_year: raw.academic_year === undefined || raw.academic_year === "" ? fallback.academic_year : Number(raw.academic_year),
    semester: raw.semester === undefined || raw.semester === "" ? fallback.semester : raw.semester,
  });
  if (!parsed.success) bad("學年度或學期不正確");
  return parsed.data;
}

async function assertSubject(env: Env, subjectId: string | null) {
  if (subjectId && !(await env.DB.prepare("SELECT 1 FROM subjects WHERE id=?").bind(subjectId).first())) bad("找不到指定的科目");
}

const load = (env: Env, userId: string, id: string) =>
  env.DB.prepare("SELECT * FROM timetable_entries WHERE id=? AND user_id=?").bind(id, userId).first<Row>();

timetable.get("/", async (c) => {
  const term = parseTerm({ academic_year: c.req.query("academic_year"), semester: c.req.query("semester") });
  const { results } = await c.env.DB.prepare("SELECT * FROM timetable_entries WHERE user_id=? AND academic_year=? AND semester=? ORDER BY day,start_time,end_time,title")
    .bind(c.get("user").id, term.academic_year, term.semester).all<Row>();
  return c.json({ term, entries: results.map(view) });
});

timetable.post("/", async (c) => {
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const term = parseTerm(body);
  const parsed = timetableDraftSchema.safeParse(body);
  if (!parsed.success) invalid(parsed.error);
  const entry = parsed.data;
  const userId = c.get("user").id;
  await assertSubject(c.env, entry.subject_id);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM timetable_entries WHERE user_id=? AND academic_year=? AND semester=?").bind(userId, term.academic_year, term.semester).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_TIMETABLE_ENTRIES) bad(`每個學期最多 ${MAX_TIMETABLE_ENTRIES} 堂課`, 409);
  const id = uid(), at = now();
  await c.env.DB.prepare("INSERT INTO timetable_entries(id,user_id,academic_year,semester,day,start_time,end_time,title,room,subject_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, userId, term.academic_year, term.semester, entry.day, entry.start, entry.end, entry.title, entry.room ?? null, entry.subject_id, at, at).run();
  return c.json({ entry: view((await load(c.env, userId, id))!) });
});

timetable.put("/:id", async (c) => {
  const userId = c.get("user").id;
  const row = await load(c.env, userId, c.req.param("id"));
  if (!row) bad("找不到這堂課", 404);
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  const patch = timetablePatchSchema.safeParse(body);
  if (!patch.success) invalid(patch.error);
  // 只覆蓋有提供的欄位；room／subject_id 傳 null 或空字串代表清除。
  const p = patch.data;
  const merged = timetableDraftSchema.safeParse({
    day: p.day ?? row.day, start: p.start ?? row.start_time, end: p.end ?? row.end_time, title: p.title ?? row.title,
    room: "room" in body ? p.room : row.room,
    subject_id: "subject_id" in body ? p.subject_id : row.subject_id,
  });
  if (!merged.success) invalid(merged.error);
  const entry = merged.data;
  await assertSubject(c.env, entry.subject_id);
  await c.env.DB.prepare("UPDATE timetable_entries SET day=?,start_time=?,end_time=?,title=?,room=?,subject_id=?,updated_at=? WHERE id=? AND user_id=?")
    .bind(entry.day, entry.start, entry.end, entry.title, entry.room ?? null, entry.subject_id, now(), row.id, userId).run();
  return c.json({ entry: view((await load(c.env, userId, row.id))!) });
});

timetable.delete("/:id", async (c) => {
  const userId = c.get("user").id;
  if (!(await load(c.env, userId, c.req.param("id")))) bad("找不到這堂課", 404);
  await c.env.DB.prepare("DELETE FROM timetable_entries WHERE id=? AND user_id=?").bind(c.req.param("id"), userId).run();
  return c.json({ ok: true });
});

export default timetable;
