import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson } from "../lib/util";
import { audit } from "../lib/audit";
import { getDoc, type DocRow } from "./documents";
import { MAX_COURSE_BYTES, validateCourse, type OpenMaicCourse } from "../../shared/openmaic";

export async function saveNoteCourse(env: Env, userId: string, doc: DocRow, course: OpenMaicCourse, expectedVersion: number, generation?: { id: string; version: number; source_revision_id: string | null }, sourceRevisionId?: string | null) {
  const t = now();
  const extra = generation ? ` AND EXISTS (SELECT 1 FROM course_generations WHERE id = ? AND version = ? AND status = 'active')
    AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND current_revision_id IS ? AND status != 'archived')` : "";
  const sourceGuard = sourceRevisionId === undefined ? "" : " AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND current_revision_id IS ? AND status != 'archived')";
  const statement = env.DB.prepare(`
    INSERT INTO note_courses (document_id, course_json, version, updated_by, updated_at)
    SELECT ?, ?, 1, ?, ? WHERE (? = 0 OR EXISTS (SELECT 1 FROM note_courses WHERE document_id = ?))${extra}${sourceGuard}
    ON CONFLICT(document_id) DO UPDATE SET course_json = excluded.course_json,
      version = note_courses.version + 1, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    WHERE note_courses.version = ? RETURNING version
  `).bind(doc.id, JSON.stringify(course), userId, t, expectedVersion, doc.id,
    ...(generation ? [generation.id, generation.version, doc.id, generation.source_revision_id] : []),
    ...(sourceRevisionId === undefined ? [] : [doc.id, sourceRevisionId]), expectedVersion);
  let version: number | undefined;
  if (generation) {
    // changes() refers to the preceding conditional write; both statements commit together.
    const result = await env.DB.batch([
      statement,
      env.DB.prepare("UPDATE course_generations SET status = 'published', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND changes() > 0 RETURNING version")
        .bind(t, generation.id, generation.version),
    ]);
    version = (result[0].results[0] as { version: number } | undefined)?.version;
  } else {
    version = (await statement.first<{ version: number }>())?.version;
  }
  if (version === undefined) bad("課程、來源筆記或生成進度已更新，請重新讀取後再儲存", 409);
  await env.DB.prepare("UPDATE documents SET updated_at = ? WHERE id = ?").bind(t, doc.id).run();
  await audit(env.DB, userId, "course.save", "note", doc.id, { version, format: course.format, generation_id: generation?.id });
  return { ok: true, version, updated_at: t };
}

const courses = new Hono<AppEnv>();
courses.use("/:slug/course", bodyLimit({ maxSize: MAX_COURSE_BYTES + 100_000, onError: (c) => c.json({ error: "課程請求過大" }, 413) }));
courses.get("/:slug/course", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "note" || doc.status === "archived") bad("找不到可使用的重點整理", 404);
  const row = await c.env.DB.prepare("SELECT course_json, version, updated_at FROM note_courses WHERE document_id = ?")
    .bind(doc.id).first<{ course_json: string; version: number; updated_at: number }>();
  return c.json({ course: row ? JSON.parse(row.course_json) : null, version: row?.version ?? 0, updated_at: row?.updated_at ?? null });
});

courses.put("/:slug/course", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "note" || doc.status === "archived") bad("只能為未刪除的重點整理儲存課程", 400);
  const b = await readJson<{ course?: unknown; expected_version?: number }>(c.req.raw);
  if (!Number.isSafeInteger(b.expected_version) || b.expected_version! < 0) bad("expected_version 必須是非負整數");
  const v = validateCourse(b.course);
  if (!v.ok) bad("課程格式不正確；原生 slide / pbl 請匯出為離線 HTML 後匯入", 422, { errors: v.errors });
  if (v.course.format === "openmaic-core") bad("原生課堂必須完成官方生成作業後，透過 publish_openmaic_classroom 連結", 422);
  return c.json(await saveNoteCourse(c.env, c.get("user").id, doc, v.course, b.expected_version!));
});

export default courses;
