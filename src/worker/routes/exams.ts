// 模擬試題：答案 JSON（含核准流程）、作答、伺服器批改、錯題、統計。
import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { requireAdmin } from "../lib/auth";
import { bad, now, readJson, uid } from "../lib/util";
import { audit } from "../lib/audit";
import { citableSources, sourceProblems } from "../lib/alignment";
import { validateExamAlignment, type ExamAlignment } from "../../shared/course-blueprint";
import { checkExamReview, examReviewSchema } from "../../shared/exam-review";
import { requireDocumentAccess, requireDocumentWrite } from "../lib/access";
import { checkedResponses, instantChecks, instantFeedback, type InstantCheckRow } from "../lib/exam-instant";
import { boundedJson } from "../lib/live-ai/service";
import type { ExamMode, InstantFeedback } from "../../shared/exam-instant";
import { getDoc, revisionBody } from "./documents";
import {
  analyzeExamMarkdown,
  crossCheck,
  extractQuestionMarkdown,
  gradeExam,
  gradeQuestion,
  questionPoints,
  stripSolutions,
  toPublic,
  validateAnswers,
  type AnswersFile,
  type GradeResult,
  type QuestionResult,
  type Response as QResponse,
} from "../../shared/exam";

const exams = new Hono<AppEnv>();
/** 作答 JSON 上限（含手寫作答筆跡）；D1 單一字串上限約 2MB */
const MAX_RESPONSES = 1_500_000;

async function approvedAnswers(env: Env, answersRevisionId: string | null): Promise<AnswersFile | null> {
  if (!answersRevisionId) return null;
  const r = await env.DB.prepare("SELECT answers_json FROM answer_revisions WHERE id = ?").bind(answersRevisionId).first<{ answers_json: string }>();
  return r ? (JSON.parse(r.answers_json) as AnswersFile) : null;
}

/** 驗證（後台/編輯器即時檢查用） */
exams.post("/validate", async (c) => {
  const b = await readJson<{ body_md: string; answers: unknown }>(c.req.raw);
  const v = validateAnswers(b.answers);
  if (!v.ok) return c.json({ ok: false, errors: v.errors });
  const errors = crossCheck(b.body_md ?? "", v.value);
  return c.json({ ok: errors.length === 0, errors });
});

/**
 * 試卷與大綱、mark scheme、課本與正常難度曲線對齊：逐題列出大綱編號、指令詞、分數與難度。
 * 科目有可引用的 IB 文件、電子書或本學期課綱時必須附上；沒有任何文件的科目可省略。
 */
async function reviewAlignment(c: import("hono").Context<AppEnv>, subjectId: string | null, answers: unknown, alignment: unknown) {
  const parsed = validateAnswers(answers);
  if (!parsed.ok) return { ok: false, required: false, errors: parsed.errors, warnings: [] as string[], value: undefined };
  const required = (await citableSources(c.env, c.get("user"), subjectId)).length > 0;
  if (alignment === undefined || alignment === null) {
    return required
      ? { ok: false, required, errors: ["此科目有可引用的 IB 文件、電子書或課綱，試卷必須附 alignment（見 get_format_guide kind=exam）：逐題列出大綱編號、指令詞、分數與難度，並引用實際讀過的文件與頁碼"], warnings: [] as string[], value: undefined }
      : { ok: true, required, errors: [] as string[], warnings: ["沒有附 alignment：這份試卷沒有記錄對應的大綱與給分依據"], value: undefined };
  }
  const report = validateExamAlignment(alignment, parsed.value.questions.map((q) => ({ id: q.id, points: questionPoints(q) })));
  if (!report.ok || !report.value) return { ok: false, required, errors: report.errors, warnings: report.warnings, value: undefined };
  const problems = await sourceProblems(c.env, c.get("user"), subjectId, report.value.sources, report.value.source_exemptions, report.value.level);
  return { ok: problems.errors.length === 0, required, errors: problems.errors, warnings: [...report.warnings, ...problems.warnings], value: problems.errors.length ? undefined : report.value };
}
exams.post("/alignment-check", async (c) => {
  const b = await readJson<{ subject_id?: string | null; answers?: unknown; alignment?: unknown }>(c.req.raw);
  const { ok, required, errors, warnings } = await reviewAlignment(c, typeof b.subject_id === "string" ? b.subject_id : null, b.answers, b.alignment);
  return c.json({ ok, required, errors, warnings });
});
exams.put("/:slug/alignment", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "exam" || !await requireDocumentWrite(c.env, c.get("user"), doc.id)) bad("找不到可修改的試卷", 404);
  const b = await readJson<{ alignment?: unknown }>(c.req.raw);
  // The newest answer file that is not rejected, approved or still waiting: the alignment is checked against the marks the learner will be graded on.
  const answersRow = await c.env.DB.prepare("SELECT answers_json FROM answer_revisions WHERE document_id=? AND status!='rejected' ORDER BY created_at DESC LIMIT 1").bind(doc.id).first<{ answers_json: string }>();
  if (!answersRow) bad("這份試卷還沒有答案 JSON，請先 set_exam_answers", 422);
  const answers = JSON.parse(answersRow!.answers_json);
  const report = await reviewAlignment(c, doc.subject_id, answers, b.alignment ?? null);
  if (!report.ok || !report.value) return c.json({ error: "alignment 未通過檢查", errors: report.errors }, 422);
  await c.env.DB.prepare("INSERT INTO document_alignments(document_id,alignment_json,created_by,created_at) VALUES (?,?,?,?) ON CONFLICT(document_id) DO UPDATE SET alignment_json=excluded.alignment_json,created_by=excluded.created_by,created_at=excluded.created_at").bind(doc.id, JSON.stringify(report.value), c.get("user").id, now()).run();
  return c.json({ saved: true, warnings: report.warnings });
});
exams.get("/:slug/alignment", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (!await requireDocumentAccess(c.env, c.get("user"), doc.id)) bad("找不到試卷", 404);
  const row = await c.env.DB.prepare("SELECT alignment_json FROM document_alignments WHERE document_id=?").bind(doc.id).first<{ alignment_json: string }>();
  return c.json({ alignment: row ? JSON.parse(row.alignment_json) : null });
});

// ---------- AI 對齊覆核 ----------
// A chatbot-made exam waits for the chatbot's own review against the IB documents; the review is recorded and shown on the exam.
exams.get("/:slug/review", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (!await requireDocumentAccess(c.env, c.get("user"), doc.id)) bad("找不到試卷", 404);
  const row = await c.env.DB.prepare("SELECT status,review_json,decision,rounds,updated_at FROM exam_reviews WHERE document_id=?").bind(doc.id).first<{ status: string; review_json: string | null; decision: string | null; rounds: number; updated_at: number }>();
  return c.json({ review: row ? { status: row.status, decision: row.decision, rounds: row.rounds, updated_at: row.updated_at, report: row.review_json ? JSON.parse(row.review_json) : null } : null });
});
exams.put("/:slug/review", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "exam" || !await requireDocumentWrite(c.env, c.get("user"), doc.id)) bad("找不到可修改的試卷", 404);
  const b = await readJson<{ pending?: boolean; review?: unknown }>(c.req.raw);
  if (b.pending) {
    await c.env.DB.prepare("INSERT INTO exam_reviews(document_id,status,rounds,created_by,updated_at) VALUES (?,'pending',0,?,?) ON CONFLICT(document_id) DO UPDATE SET status='pending',updated_at=excluded.updated_at").bind(doc.id, c.get("user").id, now()).run();
    return c.json({ status: "pending" });
  }
  const parsed = examReviewSchema.safeParse(b.review);
  if (!parsed.success) return c.json({ ok: false, error: "覆核格式不符 exam-review/v1", errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), next_action: "依 errors 修正覆核內容後重新 submit_exam_review" }, 422);
  const answersRow = await c.env.DB.prepare("SELECT answers_json FROM answer_revisions WHERE document_id=? AND status!='rejected' ORDER BY created_at DESC LIMIT 1").bind(doc.id).first<{ answers_json: string }>();
  if (!answersRow) bad("這份試卷還沒有答案 JSON，請先 set_exam_answers", 422);
  const answers = validateAnswers(JSON.parse(answersRow!.answers_json));
  if (!answers.ok) bad("答案 JSON 無效，請先修正答案", 422);
  const alignmentRow = await c.env.DB.prepare("SELECT alignment_json FROM document_alignments WHERE document_id=?").bind(doc.id).first<{ alignment_json: string }>();
  const report = checkExamReview(parsed.data, answers.value.questions.map((q) => q.id), alignmentRow ? JSON.parse(alignmentRow.alignment_json) as ExamAlignment : null);
  if (!report.ok) return c.json({ ...report, ok: false, error: "覆核內容不完整或與試卷不符" }, 422);
  await c.env.DB.prepare(`INSERT INTO exam_reviews(document_id,status,review_json,decision,rounds,created_by,updated_at) VALUES (?,?,?,?,1,?,?)
    ON CONFLICT(document_id) DO UPDATE SET status=excluded.status,review_json=excluded.review_json,decision=excluded.decision,rounds=exam_reviews.rounds+1,updated_at=excluded.updated_at`)
    .bind(doc.id, report.status, JSON.stringify(parsed.data), parsed.data.verdict === "pass" ? null : parsed.data.decision ?? null, c.get("user").id, now()).run();
  return c.json(report);
});

/** 作答用試卷：題目（無解析）+ 公開規格（無答案） */
exams.get("/:slug/paper", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "exam") bad("不是試卷", 400);
  const attemptId = c.req.query("attempt");
  const attempt = attemptId ? await ownAttempt(c.env, attemptId, c.get("user").id) : null;
  if (attempt && attempt.document_id !== doc.id) bad("找不到作答紀錄", 404);
  const revision = attempt?.revision_id ?? doc.current_revision_id;
  const md = await revisionBody(c.env, revision);
  const answers = await approvedAnswers(c.env, attempt?.answers_revision_id ?? doc.answers_revision_id);
  const structure = analyzeExamMarkdown(md);
  const seed = attempt?.id ?? doc.id;
  const booklet = doc.booklet_id
    ? await c.env.DB.prepare("SELECT id, title, page_count FROM books WHERE id = ? AND status = 'ready'").bind(doc.booklet_id).first<{ id: string; title: string; page_count: number | null }>()
    : null;
  return c.json({
    document: { id: doc.id, slug: doc.slug, title: doc.title, revision_id: revision, deleted: doc.status === "archived" },
    booklet,
    body: stripSolutions(md),
    frontmatter: structure.frontmatter,
    questions: answers ? answers.questions.map((q) => toPublic(q, seed, structure.choices)) : null,
    ready: !!answers,
  });
});

/** 答案版本列表（成員可看，因為成員皆可編輯） */
exams.get("/:slug/answers", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const { results } = await c.env.DB.prepare(
    `SELECT ar.id, ar.status, ar.message, ar.created_at, ar.reviewed_at, ar.answers_json, u.name AS author_name, r.name AS reviewer_name
       FROM answer_revisions ar LEFT JOIN users u ON u.id = ar.author_id LEFT JOIN users r ON r.id = ar.reviewed_by
      WHERE ar.document_id = ? ORDER BY ar.created_at DESC LIMIT 50`,
  )
    .bind(doc.id)
    .all();
  return c.json({ answers: results, activeId: doc.answers_revision_id });
});

/** 上傳答案 JSON：管理員直接生效；成員送出後需管理員核准（因為直接影響分數）。 */
exams.post("/:slug/answers", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.kind !== "exam") bad("不是試卷");
  const b = await readJson<{ answers: unknown; message?: string }>(c.req.raw);
  const v = validateAnswers(typeof b.answers === "string" ? safeParse(b.answers) : b.answers);
  if (!v.ok) return c.json({ error: "答案 JSON 格式錯誤", errors: v.errors }, 422);
  const md = await revisionBody(c.env, doc.current_revision_id);
  const errors = crossCheck(md, v.value);
  if (errors.length) return c.json({ error: "答案與題目不一致", errors }, 422);
  const isAdmin = c.get("user").role === "admin" || (doc.visibility === "private" && doc.created_by === c.get("user").id);
  const id = uid();
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO answer_revisions (id, document_id, answers_json, status, author_id, reviewed_by, message, created_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)",
  )
    .bind(id, doc.id, JSON.stringify(v.value), isAdmin ? "approved" : "pending", c.get("user").id, isAdmin ? c.get("user").id : null, (b.message ?? "").slice(0, 300) || null, t, isAdmin ? t : null)
    .run();
  if (isAdmin) await c.env.DB.prepare("UPDATE documents SET answers_revision_id = ?, updated_at = ? WHERE id = ?").bind(id, t, doc.id).run();
  await audit(c.env.DB, c.get("user").id, "exam.answers", "exam", doc.id, { id, status: isAdmin ? "approved" : "pending" });
  return c.json({ id, status: isAdmin ? "approved" : "pending" });
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

exams.post("/:slug/answers/:aid/:decision", requireAdmin, async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const decision = c.req.param("decision");
  if (decision !== "approve" && decision !== "reject") bad("decision 必須是 approve 或 reject");
  const t = now();
  const res = await c.env.DB.prepare(
    "UPDATE answer_revisions SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND document_id = ? AND status = 'pending'",
  )
    .bind(decision === "approve" ? "approved" : "rejected", c.get("user").id, t, c.req.param("aid"), doc.id)
    .run();
  if (!res.meta.changes) bad("找不到待審答案", 404);
  if (decision === "approve") await c.env.DB.prepare("UPDATE documents SET answers_revision_id = ? WHERE id = ?").bind(c.req.param("aid"), doc.id).run();
  await audit(c.env.DB, c.get("user").id, `exam.answers.${decision}`, "exam", doc.id, { id: c.req.param("aid") });
  return c.json({ ok: true });
});

// ---------- 作答 ----------
exams.post("/:slug/attempts", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  if (doc.status === "archived") bad("此試卷已被刪除", 409);
  if (!doc.answers_revision_id || !doc.current_revision_id) bad("此試卷尚未設定答案", 409);
  const userId = c.get("user").id;
  const mode: ExamMode = c.req.query("mode") === "instant" ? "instant" : "exam";
  const resumeId = c.req.query("attempt");
  const open = resumeId ? await ownAttempt(c.env, resumeId, userId) : await c.env.DB.prepare(
    "SELECT * FROM exam_attempts WHERE document_id = ? AND user_id = ? AND mode = ? AND submitted_at IS NULL ORDER BY started_at DESC LIMIT 1",
  ).bind(doc.id, userId, mode).first<Awaited<ReturnType<typeof ownAttempt>>>();
  if (resumeId && open && (open.document_id !== doc.id || open.submitted_at || open.mode !== mode)) bad("找不到進行中的作答", 404);
  if (open && (resumeId || c.req.query("fresh") !== "1")) {
    const checks = open.mode === "instant" ? await instantChecks(c.env, open.id) : [];
    return c.json({
      id: open.id, mode: open.mode, started_at: open.started_at, paused_at: open.paused_at, paused_ms: open.paused_ms,
      current_question_id: open.current_question_id, responses: checkedResponses(JSON.parse(open.responses_json), checks),
      feedback: Object.fromEntries(checks.map(row => [row.question_id, JSON.parse(row.feedback_json) as InstantFeedback])),
    });
  }
  const id = uid();
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO exam_attempts (id, document_id, revision_id, answers_revision_id, user_id, started_at, mode) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(id, doc.id, doc.current_revision_id, doc.answers_revision_id, userId, t, mode)
    .run();
  return c.json({ id, mode, started_at: t, paused_at: null, paused_ms: 0, current_question_id: null, responses: {}, feedback: {} });
});

async function ownAttempt(env: Env, id: string, userId: string) {
  const a = await env.DB.prepare("SELECT * FROM exam_attempts WHERE id = ? AND user_id = ?").bind(id, userId).first<{
    id: string; document_id: string; revision_id: string; answers_revision_id: string; started_at: number; submitted_at: number | null;
    responses_json: string; result_json: string | null; self_scores_json: string | null; score: number | null; max_score: number | null; duration_sec: number | null;
    paused_at: number | null; paused_ms: number; comments_json: string | null; mode: ExamMode; current_question_id: string | null;
  }>();
  if (!a) bad("找不到作答紀錄", 404);
  return a;
}

const questionPosition = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 120 ? value : null;

exams.post("/attempts/:id/check/:question", async (c) => {
  const user = c.get("user");
  const a = await ownAttempt(c.env, c.req.param("id"), user.id);
  if (a.mode !== "instant" || a.submitted_at || a.paused_at) bad("請在進行中的 Instant 模式檢查答案", 409);
  if (!await requireDocumentAccess(c.env, user, a.document_id)) bad("找不到試卷", 404);
  const qid = c.req.param("question");
  const body = await boundedJson(c.req.raw, 2_600_000);
  const check = await c.env.DB.prepare("SELECT response_json, feedback_json FROM exam_instant_checks WHERE attempt_id=? AND question_id=?")
    .bind(a.id, qid).first<{ response_json: string; feedback_json: string | null }>();
  const previous = check?.feedback_json ? JSON.parse(check.feedback_json) as InstantFeedback : undefined;
  const review = body.review === true;
  if (review && !previous) bad("請先檢查答案", 409);
  if (previous && (!review || previous.review)) return c.json({ response: JSON.parse(check!.response_json), feedback: previous });

  const answers = await approvedAnswers(c.env, a.answers_revision_id);
  const q = answers?.questions.find(question => question.id === qid);
  if (!q) bad("找不到此題", 404);
  const responseJson = previous ? check!.response_json : JSON.stringify(body.response ?? null);
  if (responseJson.length > MAX_RESPONSES) bad("作答內容過大", 413);

  const operation = uid();
  const t = now();
  const claim = await c.env.DB.prepare(`INSERT INTO exam_instant_checks (attempt_id,question_id,response_json,operation_id,operation_expires_at)
    SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM exam_attempts WHERE id=? AND paused_at IS NULL AND submitted_at IS NULL)
    ON CONFLICT(attempt_id,question_id) DO UPDATE SET response_json=excluded.response_json,operation_id=excluded.operation_id,operation_expires_at=excluded.operation_expires_at
    WHERE COALESCE(exam_instant_checks.operation_expires_at,0)<=? AND exam_instant_checks.feedback_json IS ?`)
    .bind(a.id, qid, responseJson, operation, t + 90_000, a.id, t, check?.feedback_json ?? null).run();
  if (!claim.meta.changes) bad("這題正在批改或已更新，請稍後重試", 409);
  try {
    const response: QResponse = JSON.parse(responseJson);
    const feedback = await instantFeedback(c.env, user.id, a.id, q, () => revisionBody(c.env, a.revision_id), response, c.req.raw.signal, previous);
    const saved = await c.env.DB.prepare(`UPDATE exam_instant_checks SET feedback_json=?,operation_id=NULL,operation_expires_at=NULL
      WHERE attempt_id=? AND question_id=? AND operation_id=? AND EXISTS (SELECT 1 FROM exam_attempts WHERE id=? AND paused_at IS NULL AND submitted_at IS NULL)`)
      .bind(JSON.stringify(feedback), a.id, qid, operation, a.id).run();
    if (!saved.meta.changes) bad("作答狀態已變更，請重新開啟試卷", 409);
    return c.json({ response, feedback });
  } catch (error) {
    await c.env.DB.prepare("UPDATE exam_instant_checks SET operation_id=NULL,operation_expires_at=NULL WHERE attempt_id=? AND question_id=? AND operation_id=?")
      .bind(a.id, qid, operation).run();
    throw error;
  }
});

/** 暫存作答（每 10 秒或離開頁面時） */
exams.put("/attempts/:id", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  if (a.submitted_at) bad("已交卷", 409);
  const { responses, current_question_id } = await readJson<{ responses: Record<string, QResponse>; current_question_id?: unknown }>(c.req.raw);
  const json = JSON.stringify(responses ?? {});
  if (json.length > MAX_RESPONSES) bad("作答內容過大（手寫作答太多頁？）", 413);
  await c.env.DB.prepare("UPDATE exam_attempts SET responses_json = ?, current_question_id = COALESCE(?,current_question_id) WHERE id = ? AND submitted_at IS NULL AND paused_at IS NULL")
    .bind(json, questionPosition(current_question_id), a.id).run();
  return c.json({ ok: true });
});

/** 暫停：停止計時（已用時間不再增加）。重複暫停無效果。 */
exams.post("/attempts/:id/pause", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  if (a.submitted_at) bad("已交卷", 409);
  const b = await c.req.json<{ responses?: Record<string, QResponse>; current_question_id?: unknown }>().catch(() => null);
  const t = a.paused_at ?? now();
  const json = b?.responses ? JSON.stringify(b.responses) : a.responses_json;
  if (json.length > MAX_RESPONSES) bad("作答內容過大（手寫作答太多頁？）", 413);
  await c.env.DB.prepare("UPDATE exam_attempts SET paused_at = ?, responses_json = ?, current_question_id = COALESCE(?,current_question_id) WHERE id = ? AND submitted_at IS NULL")
    .bind(t, json, questionPosition(b?.current_question_id), a.id).run();
  return c.json({ paused_at: t, paused_ms: a.paused_ms });
});

/** 繼續：把暫停的時間累加到 paused_ms（不計入作答時間）。 */
exams.post("/attempts/:id/resume", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  if (a.submitted_at) bad("已交卷", 409);
  const paused = a.paused_ms + (a.paused_at ? Math.max(0, now() - a.paused_at) : 0);
  await c.env.DB.prepare("UPDATE exam_attempts SET paused_at = NULL, paused_ms = ? WHERE id = ?").bind(paused, a.id).run();
  return c.json({ paused_at: null, paused_ms: paused });
});

function uncheckedResult(q: QuestionResult): QuestionResult {
  return { ...q, score: 0, correct: false, ...(q.parts ? { parts: q.parts.map(uncheckedResult) } : {}) };
}

async function buildResult(env: Env, a: Awaited<ReturnType<typeof ownAttempt>>, checks: InstantCheckRow[] = []) {
  const answers = await approvedAnswers(env, a.answers_revision_id);
  if (!answers) bad("答案遺失", 500);
  let result: GradeResult;
  if (a.mode === "instant") {
    const grades = new Map(checks.map(row => [row.question_id, (JSON.parse(row.feedback_json) as InstantFeedback).result]));
    const questions = answers.questions.map(q => grades.get(q.id) ?? uncheckedResult(gradeQuestion(q, undefined)));
    const max = questions.reduce((sum, q) => sum + q.max, 0);
    result = {
      questions, pendingSelfGrade: 0, score: Math.min(max, Number(questions.reduce((sum, q) => sum + q.score, 0).toFixed(2))), max,
    };
  } else {
    result = gradeExam(answers, JSON.parse(a.responses_json), JSON.parse(a.self_scores_json ?? "{}"), JSON.parse(a.comments_json ?? "{}"));
  }
  const fullMd = await revisionBody(env, a.revision_id);
  const choices = analyzeExamMarkdown(fullMd).choices;
  const questions = answers.questions.map((q) => toPublic(q, a.id, choices));
  return { result, body: fullMd, questions };
}

exams.post("/attempts/:id/submit", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  if (a.submitted_at) bad("已交卷", 409);
  const b = await readJson<{ responses: Record<string, QResponse> }>(c.req.raw);
  const checks = a.mode === "instant" ? await instantChecks(c.env, a.id) : [];
  const responses = b.responses ?? JSON.parse(a.responses_json) as Record<string, QResponse>;
  a.responses_json = JSON.stringify(a.mode === "instant"
    ? checkedResponses(Object.fromEntries(Object.entries(responses).filter(([key]) => key === "__flags" || key === "__highlights")), checks)
    : responses);
  if (a.responses_json.length > MAX_RESPONSES) bad("作答內容過大（手寫作答太多頁？）", 413);
  const { result, body, questions } = await buildResult(c.env, a, checks);
  const t = now();
  const saved = await c.env.DB.prepare(`UPDATE exam_attempts SET responses_json = ?, result_json = ?, score = ?, max_score = ?, submitted_at = ?, duration_sec = ?
     WHERE id = ? AND submitted_at IS NULL AND (mode = 'exam' OR (
       paused_at IS NULL
       AND (SELECT count(*) FROM exam_instant_checks WHERE attempt_id = exam_attempts.id AND feedback_json IS NOT NULL) = ?
       AND NOT EXISTS (SELECT 1 FROM exam_instant_checks WHERE attempt_id = exam_attempts.id AND operation_expires_at > ?)
     ))`)
    .bind(a.responses_json, JSON.stringify(result), result.score, result.max, t, Math.max(0, Math.round((t - a.started_at - a.paused_ms - (a.paused_at ? t - a.paused_at : 0)) / 1000)), a.id, checks.length, t)
    .run();
  if (!saved.meta.changes) bad("作答狀態已變更，請稍後再交卷", 409);
  return c.json({ attemptId: a.id, result, body, questions, responses: JSON.parse(a.responses_json) });
});

/** 交卷後查看結果（含解析與完整題目） */
exams.get("/attempts/:id", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  const doc = await c.env.DB.prepare("SELECT slug, title FROM documents WHERE id = ?").bind(a.document_id).first<{ slug: string; title: string }>();
  const checks = a.mode === "instant" ? await instantChecks(c.env, a.id) : [];
  if (!a.submitted_at)
    return c.json({
      attempt: { id: a.id, mode: a.mode, started_at: a.started_at, submitted: false, paused_at: a.paused_at, paused_ms: a.paused_ms },
      document: doc,
      responses: checkedResponses(JSON.parse(a.responses_json), checks),
    });
  const { result, body, questions } = await buildResult(c.env, a, checks);
  return c.json({
    attempt: { id: a.id, mode: a.mode, started_at: a.started_at, submitted_at: a.submitted_at, duration_sec: a.duration_sec, submitted: true },
    document: doc,
    result,
    body,
    questions,
    responses: JSON.parse(a.responses_json),
    selfScores: JSON.parse(a.self_scores_json ?? "{}"),
    ...(a.mode === "instant" ? { feedback: Object.fromEntries(checks.map(row => [row.question_id, JSON.parse(row.feedback_json) as InstantFeedback])) } : {}),
  });
});

/** 非選題自評 */
exams.post("/attempts/:id/self-grade", async (c) => {
  const a = await ownAttempt(c.env, c.req.param("id"), c.get("user").id);
  if (!a.submitted_at) bad("尚未交卷", 409);
  if (a.mode === "instant") bad("Instant 模式的分數在逐題檢查時已記錄", 409);
  const { scores, comments } = await readJson<{ scores?: Record<string, number>; comments?: Record<string, string> }>(c.req.raw);
  const merged = { ...JSON.parse(a.self_scores_json ?? "{}"), ...(scores ?? {}) };
  a.self_scores_json = JSON.stringify(merged);
  const cm: Record<string, string> = { ...JSON.parse(a.comments_json ?? "{}") };
  for (const [k, v] of Object.entries(comments ?? {})) {
    if (typeof v === "string" && v.trim()) cm[k] = v.slice(0, 4000);
    else delete cm[k];
  }
  a.comments_json = JSON.stringify(cm);
  const { result } = await buildResult(c.env, a);
  await c.env.DB.prepare("UPDATE exam_attempts SET self_scores_json = ?, comments_json = ?, result_json = ?, score = ? WHERE id = ?")
    .bind(a.self_scores_json, a.comments_json, JSON.stringify(result), result.score, a.id)
    .run();
  return c.json({ result });
});

/** 我的所有作答（進行中 / 暫停中 / 已交卷） */
exams.get("/attempts", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ea.id, d.slug, d.title, ea.mode, ea.started_at, ea.submitted_at, ea.paused_at, ea.paused_ms, ea.score, ea.max_score, ea.duration_sec
       FROM exam_attempts ea JOIN documents d ON d.id = ea.document_id
      WHERE ea.user_id = ? ORDER BY COALESCE(ea.submitted_at, ea.started_at) DESC LIMIT ?`,
  )
    .bind(c.get("user").id, Math.min(50, Number(c.req.query("limit")) || 20))
    .all();
  return c.json({ attempts: results });
});

/** 回報錯題複習結果（ChatGPT 帶使用者複習後呼叫） */
exams.post("/mistakes/review", async (c) => {
  const b = await readJson<{ slug: string; question: string; outcome: "understood" | "still_confused"; note?: string }>(c.req.raw);
  if (b.outcome !== "understood" && b.outcome !== "still_confused") bad("outcome 必須是 understood 或 still_confused");
  const doc = await getDoc(c.env, b.slug);
  await c.env.DB.prepare("INSERT INTO mistake_reviews (id, user_id, document_id, question_id, outcome, note, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(uid(), c.get("user").id, doc.id, String(b.question).slice(0, 80), b.outcome, (b.note ?? "").slice(0, 500) || null, now())
    .run();
  return c.json({ ok: true });
});

/** 錯題複習用：題目原文（不含解析）+ 我的作答 + 正解與解析 */
exams.get("/mistakes/detail", async (c) => {
  const limit = Math.min(20, Number(c.req.query("limit")) || 5);
  const onlyOpen = c.req.query("include_mastered") !== "1";
  const slug = c.req.query("slug");
  const list = (await myMistakes(c.env, c.get("user").id)).filter((m) => (!slug || m.slug === slug) && (!onlyOpen || !m.mastered));
  const out = [];
  const cache = new Map<string, { md: Record<string, string>; responses: Record<string, QResponse>; result: { questions: { id: string; expected?: unknown; explanation?: string; modelAnswer?: string; comment?: string; correct: unknown; score: number; max: number }[] } }>();
  for (const m of list.slice(0, limit)) {
    let a = cache.get(m.attempt_id);
    if (!a) {
      const row = await c.env.DB.prepare("SELECT revision_id, responses_json, result_json FROM exam_attempts WHERE id = ?").bind(m.attempt_id).first<{ revision_id: string; responses_json: string; result_json: string }>();
      if (!row) continue;
      a = { md: extractQuestionMarkdown(stripSolutions(await revisionBody(c.env, row.revision_id))), responses: JSON.parse(row.responses_json), result: JSON.parse(row.result_json) };
      cache.set(m.attempt_id, a);
    }
    const r = a.result.questions.find((q) => q.id === m.question);
    out.push({
      exam: m.title,
      slug: m.slug,
      attempt_id: m.attempt_id,
      question: m.question,
      score: m.score,
      max: m.max,
      question_md: a.md[m.question] ?? "",
      my_response: summarizeResponse(a.responses[m.question]),
      correct_answer: r?.expected ?? r?.modelAnswer ?? null,
      explanation: r?.explanation ?? null,
      comment: r?.comment ?? null,
      previous_review: m.review ?? null,
    });
  }
  return c.json({ total_open: list.length, mistakes: out });
});

/** 作答內容轉成 AI 可讀的形式（手寫筆跡無法轉成文字，只標示） */
export function summarizeResponse(v: QResponse): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("mode" in o || "ink" in o) {
      const ink = typeof o.ink === "string";
      return { ...(o.text ? { text: o.text } : {}), ...(ink ? { handwritten: "（手寫作答：筆跡無法轉成文字，請使用者在網頁上查看或口述）" } : {}) };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, summarizeResponse(x as QResponse)]));
  }
  return v ?? null;
}

exams.get("/:slug/attempts", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const { results } = await c.env.DB.prepare(
    "SELECT id, mode, started_at, submitted_at, score, max_score, duration_sec, paused_at FROM exam_attempts WHERE document_id = ? AND user_id = ? ORDER BY started_at DESC",
  )
    .bind(doc.id, c.get("user").id)
    .all();
  return c.json({ attempts: results });
});

/** 每題答對率（找出題目或答案可能有誤） */
exams.get("/:slug/stats", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const { results } = await c.env.DB.prepare(
    "SELECT result_json, user_id FROM exam_attempts WHERE document_id = ? AND mode = 'exam' AND submitted_at IS NOT NULL",
  )
    .bind(doc.id)
    .all<{ result_json: string; user_id: string }>();
  const per = new Map<string, { attempts: number; full: number; scoreSum: number; max: number }>();
  for (const r of results) {
    for (const q of (JSON.parse(r.result_json) as { questions: { id: string; score: number; max: number; correct: unknown }[] }).questions) {
      const s = per.get(q.id) ?? { attempts: 0, full: 0, scoreSum: 0, max: q.max };
      s.attempts++;
      if (q.correct === true) s.full++;
      s.scoreSum += q.score;
      per.set(q.id, s);
    }
  }
  return c.json({
    attempts: results.length,
    users: new Set(results.map((r) => r.user_id)).size,
    questions: [...per.entries()].map(([id, s]) => ({ id, ...s, correctRate: s.attempts ? s.full / s.attempts : 0 })),
  });
});

/** 管理員：以目前生效答案重新批改所有已交卷作答 */
exams.post("/:slug/regrade", requireAdmin, async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const answers = await approvedAnswers(c.env, doc.answers_revision_id);
  if (!answers) bad("尚未設定答案", 409);
  const { results } = await c.env.DB.prepare(
    "SELECT id, responses_json, self_scores_json, comments_json FROM exam_attempts WHERE document_id = ? AND mode = 'exam' AND submitted_at IS NOT NULL",
  )
    .bind(doc.id)
    .all<{ id: string; responses_json: string; self_scores_json: string | null; comments_json: string | null }>();
  const stmts = results.map((a) => {
    const r = gradeExam(answers, JSON.parse(a.responses_json), JSON.parse(a.self_scores_json ?? "{}"), JSON.parse(a.comments_json ?? "{}"));
    return c.env.DB.prepare("UPDATE exam_attempts SET result_json = ?, score = ?, max_score = ?, answers_revision_id = ? WHERE id = ?").bind(
      JSON.stringify(r), r.score, r.max, doc.answers_revision_id, a.id,
    );
  });
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  await audit(c.env.DB, c.get("user").id, "exam.regrade", "exam", doc.id, { count: results.length });
  return c.json({ regraded: results.length });
});

export default exams;

/** 我的錯題（最近 200 筆作答中答錯/部分對的題目） */
export async function myMistakes(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT ea.id AS attempt_id, ea.result_json, ea.submitted_at, d.slug, d.title
       FROM exam_attempts ea JOIN documents d ON d.id = ea.document_id
      WHERE ea.user_id = ? AND ea.submitted_at IS NOT NULL ORDER BY ea.submitted_at DESC LIMIT 200`,
  )
    .bind(userId)
    .all<{ attempt_id: string; result_json: string; submitted_at: number; slug: string; title: string }>();
  const { results: reviews } = await env.DB.prepare(
    `SELECT d.slug, mr.question_id, mr.outcome, mr.note, mr.created_at FROM mistake_reviews mr JOIN documents d ON d.id = mr.document_id WHERE mr.user_id = ? ORDER BY mr.created_at DESC`,
  )
    .bind(userId)
    .all<{ slug: string; question_id: string; outcome: string; note: string | null; created_at: number }>();
  const lastReview = new Map<string, { outcome: string; note: string | null; at: number }>();
  for (const r of reviews) if (!lastReview.has(`${r.slug}#${r.question_id}`)) lastReview.set(`${r.slug}#${r.question_id}`, { outcome: r.outcome, note: r.note, at: r.created_at });
  const latest = new Map<string, { slug: string; title: string; attempt_id: string; submitted_at: number; question: string; score: number; max: number; review?: { outcome: string; note: string | null; at: number }; mastered?: boolean }>();
  for (const r of results) {
    for (const q of (JSON.parse(r.result_json) as { questions: { id: string; score: number; max: number; correct: unknown }[] }).questions) {
      const key = `${r.slug}#${q.id}`;
      if (latest.has(key)) continue; // 只看最近一次
      const review = lastReview.get(key);
      // 交卷之後複習並表示「懂了」→ 視為已掌握（再考錯會重新出現）
      latest.set(key, { slug: r.slug, title: r.title, attempt_id: r.attempt_id, submitted_at: r.submitted_at, question: q.id, score: q.score, max: q.max, review, mastered: review?.outcome === "understood" && review.at > r.submitted_at });
    }
  }
  return [...latest.values()].filter((m) => m.score < m.max);
}
