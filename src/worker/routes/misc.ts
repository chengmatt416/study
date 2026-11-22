// 科目、考試範圍、圖片資產、搜尋、個人資料。
import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { requireAdmin } from "../lib/auth";
import { bad, now, readJson, slugifyAscii, str, uid } from "../lib/util";
import { assertStorage } from "../lib/quota";
import { myMistakes } from "./exams";
import { submitReviews } from "./decks";
import { userAccess } from "../lib/access";
import { assessmentScopePatchSchema } from "../../shared/assessment";
import { practiceScaleSchema, type PracticeScale } from "../../shared/practice";

const misc = new Hono<AppEnv>();

misc.get("/me", async (c) => c.json({ user: { ...c.get("user"), access: await userAccess(c.env, c.get("user")) } }));

misc.get("/me/mistakes", async (c) => c.json({ mistakes: await myMistakes(c.env, c.get("user").id) }));

misc.get("/me/stats", async (c) => {
  const userId = c.get("user").id;
  const since = now() - 90 * 86400000;
  const { results: daily } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', reviewed_at / 1000, 'unixepoch', '+8 hours') AS day, COUNT(*) AS n,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again
       FROM review_log WHERE user_id = ? AND reviewed_at > ? GROUP BY day ORDER BY day`,
  )
    .bind(userId, since)
    .all();
  const { results: exams } = await c.env.DB.prepare(
    `SELECT ea.id AS attempt_id, d.title, d.slug, ea.score, ea.max_score, ea.submitted_at FROM exam_attempts ea JOIN documents d ON d.id = ea.document_id
      WHERE ea.user_id = ? AND ea.submitted_at IS NOT NULL ORDER BY ea.submitted_at DESC LIMIT 30`,
  )
    .bind(userId)
    .all();
  return c.json({ daily, exams });
});

misc.post("/reviews", async (c) => {
  const { items, owner_id } = await readJson<{ items: Parameters<typeof submitReviews>[2]; owner_id?: string }>(c.req.raw);
  if (owner_id !== undefined && owner_id !== c.get("user").id) bad("複習紀錄屬於另一個帳號，請登入原作答帳號後同步", 409);
  const updated = await submitReviews(c.env, c.get("user").id, items);
  return c.json({ updated });
});

// ---------- 科目 ----------
misc.get("/subjects", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM subjects ORDER BY sort, name").all();
  return c.json({ subjects: results });
});

misc.post("/subjects", requireAdmin, async (c) => {
  const b = await readJson<{ name: string; slug?: string; color?: string; sort?: number; practice_scale?: PracticeScale }>(c.req.raw);
  const scale = practiceScaleSchema.default("general").safeParse(b.practice_scale);
  if (!scale.success) bad("複習分級不正確");
  const id = uid();
  await c.env.DB.prepare("INSERT INTO subjects (id, slug, name, color, sort, practice_scale) VALUES (?,?,?,?,?,?)")
    .bind(id, slugifyAscii(b.slug || b.name), str(b.name, "name", { max: 100 }), b.color ?? null, b.sort ?? 99, scale.data)
    .run();
  return c.json({ id });
});

misc.put("/subjects/:id", requireAdmin, async (c) => {
  const b = await readJson<{ name?: string; color?: string; sort?: number; practice_scale?: PracticeScale }>(c.req.raw);
  const scale = practiceScaleSchema.optional().safeParse(b.practice_scale);
  if (!scale.success) bad("複習分級不正確");
  await c.env.DB.prepare("UPDATE subjects SET name = COALESCE(?, name), color = COALESCE(?, color), sort = COALESCE(?, sort), practice_scale = COALESCE(?, practice_scale) WHERE id = ?")
    .bind(b.name ?? null, b.color ?? null, b.sort ?? null, scale.data ?? null, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

misc.delete("/subjects/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM subjects WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- 考試（範圍、日期） ----------
misc.get("/assessments", async (c) => {
  const { results: list } = await c.env.DB.prepare("SELECT * FROM assessments ORDER BY start_date DESC").all<{ id: string }>();
  const { results: scope } = await c.env.DB.prepare(
    "SELECT s.*, sub.name AS subject_name, sub.color FROM assessment_scope s JOIN subjects sub ON sub.id = s.subject_id ORDER BY sub.sort",
  ).all<{ assessment_id: string }>();
  return c.json({ assessments: list.map((a) => ({ ...a, scope: scope.filter((s) => s.assessment_id === a.id) })) });
});

misc.post("/assessments", requireAdmin, async (c) => {
  const b = await readJson<{ id?: string; title: string; start_date?: string; end_date?: string; scope?: { subject_id: string; has_exam?: boolean; coverage_md?: string; exam_date?: string }[] }>(c.req.raw);
  const id = b.id ?? uid();
  const stmts = [
    c.env.DB.prepare(
      "INSERT INTO assessments (id, title, start_date, end_date, created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, start_date = excluded.start_date, end_date = excluded.end_date",
    ).bind(id, str(b.title, "title", { max: 200 }), b.start_date ?? null, b.end_date ?? null, now()),
    c.env.DB.prepare("DELETE FROM assessment_scope WHERE assessment_id = ?").bind(id),
    ...(b.scope ?? []).map((s) =>
      c.env.DB.prepare("INSERT INTO assessment_scope (id, assessment_id, subject_id, has_exam, coverage_md, exam_date) VALUES (?,?,?,?,?,?)").bind(
        uid(), id, s.subject_id, s.has_exam === false ? 0 : 1, (s.coverage_md ?? "").slice(0, 20000), s.exam_date ?? null,
      ),
    ),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ id });
});

misc.put("/assessments/:id/scope/:subjectId", requireAdmin, async (c) => {
  const parsed = assessmentScopePatchSchema.safeParse(await readJson<unknown>(c.req.raw));
  if (!parsed.success) bad(parsed.error.issues.map((issue) => issue.message).join("；"));
  const patch = parsed.data;
  const id = c.req.param("id"), subjectId = c.req.param("subjectId");
  if (!await c.env.DB.prepare("SELECT id FROM assessments WHERE id = ?").bind(id).first()) bad("找不到段考", 404);
  if (!await c.env.DB.prepare("SELECT id FROM subjects WHERE id = ?").bind(subjectId).first()) bad("找不到科目", 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE assessment_scope SET coverage_md = CASE WHEN ? THEN ? ELSE coverage_md END, has_exam = CASE WHEN ? THEN ? ELSE has_exam END, exam_date = CASE WHEN ? THEN ? ELSE exam_date END WHERE assessment_id = ? AND subject_id = ?")
      .bind(patch.coverage_md !== undefined ? 1 : 0, patch.coverage_md ?? null, patch.has_exam !== undefined ? 1 : 0, patch.has_exam ? 1 : 0, patch.exam_date !== undefined ? 1 : 0, patch.exam_date ?? null, id, subjectId),
    c.env.DB.prepare("INSERT INTO assessment_scope (id,assessment_id,subject_id,coverage_md,has_exam,exam_date) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM assessment_scope WHERE assessment_id = ? AND subject_id = ?)")
      .bind(uid(), id, subjectId, patch.coverage_md ?? "", patch.has_exam === false ? 0 : 1, patch.exam_date ?? null, id, subjectId),
  ]);
  const scope = await c.env.DB.prepare("SELECT * FROM assessment_scope WHERE assessment_id = ? AND subject_id = ?").bind(id, subjectId).first();
  return c.json({ assessment_id: id, scope });
});

misc.delete("/assessments/:id", requireAdmin, async (c) => {
  await c.env.DB.prepare("DELETE FROM assessments WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- 圖片資產（筆記/試題/字卡內嵌圖片） ----------
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

misc.post("/assets", async (c) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0];
  if (!IMAGE_TYPES.includes(type)) bad("只接受 png / jpeg / webp / gif / svg 圖片");
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > 10 * 1024 * 1024) bad("圖片上限 10MB", 413);
  await assertStorage(c.env, buf.byteLength);
  const id = uid();
  const ext = type === "image/svg+xml" ? "svg" : type.split("/")[1];
  const key = `assets/${new Date().toISOString().slice(0, 7)}/${id}.${ext}`;
  await c.env.BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare("INSERT INTO assets (id, r2_key, mime, size_bytes, uploaded_by, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, key, type, buf.byteLength, c.get("user").id, now())
    .run();
  return c.json({ id, url: `/api/assets/${id}` });
});

misc.get("/assets/:id", async (c) => {
  const a = await c.env.DB.prepare("SELECT r2_key, mime FROM assets WHERE id = ?").bind(c.req.param("id")).first<{ r2_key: string; mime: string }>();
  if (!a) return c.body(null, 404);
  const obj = await c.env.BUCKET.get(a.r2_key);
  if (!obj) return c.body(null, 404);
  const headers: Record<string, string> = { "content-type": a.mime, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" };
  // SVG 可能含腳本：強制以 sandbox CSP 提供
  if (a.mime === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new Response(obj.body, { headers });
});

// ---------- 搜尋（筆記、試題、字卡、書名） ----------
misc.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 1) return c.json({ results: [] });
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const { results: docs } = await c.env.DB.prepare(
    `SELECT d.kind, d.slug, d.title, substr(r.body_md, max(1, instr(lower(r.body_md), lower(?)) - 40), 120) AS snippet
       FROM documents d JOIN revisions r ON r.id = d.current_revision_id
      WHERE d.status != 'archived' AND (d.title LIKE ? ESCAPE '\\' OR r.body_md LIKE ? ESCAPE '\\') LIMIT 30`,
  )
    .bind(q, like, like)
    .all();
  const { results: cards } = await c.env.DB.prepare(
    `SELECT k.id, k.deck_id, k.front, k.back, d.title AS deck_title FROM cards k JOIN decks d ON d.id = k.deck_id
      WHERE k.deleted_at IS NULL AND (k.front LIKE ? ESCAPE '\\' OR k.back LIKE ? ESCAPE '\\') LIMIT 30`,
  )
    .bind(like, like)
    .all();
  const { results: books } = await c.env.DB.prepare("SELECT id, title FROM books WHERE status = 'ready' AND kind <> 'chapter' AND title LIKE ? ESCAPE '\\' LIMIT 10").bind(like).all();
  return c.json({ documents: docs, cards, books });
});

export default misc;
