import { slideQuestionMessage, type SlideViolation } from "../../shared/slide-questions";
import { judgeClassroom, judgeContent, judgmentMessage, type Judgment } from "../lib/content-judge";
import { blueprintSelfReviewSchema, checkBlueprintSelfReview, checkClassroomReview, classroomReviewSchema } from "../../shared/generation-review";
import { checkClassroomAgainstBlueprint, validateBlueprint, type CourseBlueprint } from "../../shared/course-blueprint";
import { courseRequirement, MAX_COURSE_REQUIREMENT_CHARS, requirementProblem } from "../../shared/course-requirement";
import { moduleDraftProblems, narrationDraftProblems, narrationOf, outlineDraftProblems, outlineScenes, parseDraft, quizDraftProblems, requestUserText, slideDraftText, slideElements, turnScene, type DraftProblems, type TurnScene } from "../../shared/draft-checks";
import { sourceProblems } from "../lib/alignment";
import { IB_REFERENCE_INSTRUCTIONS, requireAiAccess } from "../lib/ib-resources";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson, str, uid } from "../lib/util";
import { getDoc, revisionBody } from "./documents";
import { saveNoteCourse } from "./courses";
import { coreConfiguration, coreRequest, type OpenMaicCoreEnv } from "../lib/openmaic-core";
import { requireDocumentAccess, requireDocumentWrite } from "../lib/access";
import { loadChapter } from "./chapters";
import { signOpenMaicTicket } from "../../shared/openmaic-transport";

const routes = new Hono<AppEnv>();
routes.use("*", bodyLimit({ maxSize: 2_100_000, onError: (c) => c.json({ error: "MCP 回應過大，請依官方任務拆分內容" }, 413) }));
interface NativeRun { id: string; document_id: string; created_by: string; source_revision_id: string | null; expected_course_version: number; blueprint_json: string | null; blueprint_draft_id?: string | null; completion_review_json?: string | null }
const coreId = (value: unknown) => str(value, "core id", { max: 200 });
routes.get("/status", async (c) => {
  const env: OpenMaicCoreEnv = c.env;
  if (!env.OPENMAIC_CORE_URL || !env.OPENMAIC_MCP_SECRET) return c.json({ configured: false, engine: "OpenMAIC", transport: "study-mcp/v1" });
  return c.json({ configured: true, ...await coreRequest(c.env, c.get("user").id, "GET", "/api/study-mcp/status") });
});
/** The plan a course is generated from: its structure and learning curve, then whether the cited documents are real and for this subject. */
export async function reviewBlueprint(c: Context<AppEnv>, subjectId: string | null, input: unknown, chapterId?: string | null) {
  const report = validateBlueprint(input);
  if (!report.ok || !report.value) return report;
  const problems = await sourceProblems(c.env, c.get("user"), subjectId, report.value.sources, report.value.source_exemptions, report.value.level, chapterId);
  const tooLong = requirementProblem(report.value);
  const errors = tooLong ? [...problems.errors, tooLong] : problems.errors;
  return { ...report, ok: errors.length === 0, errors, warnings: [...report.warnings, ...problems.warnings] };
}
const blueprintFailure = (c: Context<AppEnv>, report: { errors: string[]; warnings: string[] }) =>
  c.json({ error: "課程藍圖未通過檢查，修正後再開始生成", errors: report.errors, warnings: report.warnings }, 422);
async function noteForCourse(c: Context<AppEnv>, slug: unknown) {
  const doc = await getDoc(c.env, str(slug, "note_slug", { max: 200 }));
  if (!await requireDocumentAccess(c.env, c.get("user"), doc.id)) bad("找不到重點整理", 404);
  if (doc.kind !== "note" || doc.status === "archived" || !await requireDocumentWrite(c.env, c.get("user"), doc.id)) bad("無法為此筆記建立課堂", 403);
  return doc;
}
routes.post("/blueprint-check", async (c) => {
  const body = await readJson<{ note_slug?: string; blueprint?: unknown; chapter_id?: string }>(c.req.raw);
  const doc = await noteForCourse(c, body.note_slug);
  if (body.chapter_id) await loadChapter(c, str(body.chapter_id, "chapter_id", { max: 100 }));
  const report = await reviewBlueprint(c, doc.subject_id, body.blueprint, body.chapter_id ?? null);
  return c.json({ ok: report.ok, errors: report.errors, warnings: report.warnings });
});

// ---------- Blueprint drafts: self-reviewed by the chatbot, then reviewed by the learner in the app (unless yolo) ----------
interface DraftRow { id: string; document_id: string; topic_id: string | null; created_by: string; topic: string; blueprint_json: string; self_review_json: string; mode: "review" | "yolo"; status: string; feedback: string | null; replaces_id: string | null; generation_id: string | null; round: number; created_at: number; updated_at: number }
const draftView = (row: DraftRow & { note_title?: string; note_slug?: string; chapter_title?: string | null }, full = false) => ({
  id: row.id, status: row.status, mode: row.mode, topic: row.topic, round: row.round, feedback: row.feedback, generation_id: row.generation_id,
  note_slug: row.note_slug, note_title: row.note_title, chapter_id: row.topic_id, chapter_title: row.chapter_title ?? null, created_at: row.created_at, updated_at: row.updated_at,
  ...(full ? { blueprint: JSON.parse(row.blueprint_json), self_review: JSON.parse(row.self_review_json) } : {}),
  review_url: `/ai?kind=course&draft=${row.id}`,
});
async function ownDraft(c: Context<AppEnv>, id: string) {
  const row = await c.env.DB.prepare("SELECT b.*,d.title AS note_title,d.slug AS note_slug,t.title AS chapter_title FROM course_blueprint_drafts b JOIN documents d ON d.id=b.document_id LEFT JOIN topics t ON t.id=b.topic_id WHERE b.id=? AND b.created_by=?")
    .bind(id, c.get("user").id).first<DraftRow & { note_title: string; note_slug: string; chapter_title: string | null }>();
  if (!row) bad("找不到你的課程藍圖", 404);
  return row;
}
routes.post("/blueprints", async (c) => {
  const body = await readJson<{ note_slug?: string; topic?: string; chapter_id?: string; blueprint?: unknown; self_review?: unknown; mode?: string; replaces_draft_id?: string }>(c.req.raw);
  const doc = await noteForCourse(c, body.note_slug);
  await requireAiAccess(c.env, c.get("user"));
  const mode = body.mode === "yolo" ? "yolo" : "review";
  const chapterId = body.chapter_id ? str(body.chapter_id, "chapter_id", { max: 100 }) : null;
  if (chapterId) await loadChapter(c, chapterId);
  const report = await reviewBlueprint(c, doc.subject_id, body.blueprint, chapterId);
  if (!report.ok || !report.value) return blueprintFailure(c, report);
  const parsed = blueprintSelfReviewSchema.safeParse(body.self_review);
  if (!parsed.success) return c.json({ error: "self_review 格式不符，先詳細自我審查再送出", errors: parsed.error.issues.map((i) => `self_review.${i.path.join(".")}: ${i.message}`) }, 422);
  const self = checkBlueprintSelfReview(parsed.data, report.value);
  if (self.errors.length) return c.json({ error: "自我審查顯示藍圖還不符合課本、大綱或使用者課綱：修改藍圖直到完全符合再送出", errors: self.errors, warnings: [...report.warnings, ...self.warnings] }, 422);
  const previous = body.replaces_draft_id ? await ownDraft(c, str(body.replaces_draft_id, "replaces_draft_id", { max: 100 })) : null;
  if (previous && previous.status === "started") bad("上一版藍圖已開始生成，不能取代", 409);
  const id = uid(), t = now(), status = mode === "yolo" ? "approved" : "pending_review";
  const statements = [c.env.DB.prepare("INSERT INTO course_blueprint_drafts(id,document_id,topic_id,created_by,topic,blueprint_json,self_review_json,mode,status,replaces_id,round,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, doc.id, chapterId, c.get("user").id, str(body.topic ?? doc.title, "topic", { max: 1000 }), JSON.stringify(report.value), JSON.stringify(parsed.data), mode, status, previous?.id ?? null, (previous?.round ?? 0) + 1, t, t)];
  if (previous) statements.push(c.env.DB.prepare("UPDATE course_blueprint_drafts SET status='superseded',updated_at=? WHERE id=?").bind(t, previous.id));
  await c.env.DB.batch(statements);
  return c.json({ draft_id: id, status, mode, warnings: [...report.warnings, ...self.warnings], review_url: `/ai?kind=course&draft=${id}`,
    next_action: mode === "yolo" ? "yolo 模式：藍圖已自動核准。直接 start_openmaic_classroom（blueprint_draft_id），一路完成到發布，不再詢問使用者。"
      : "請使用者到 App「AI 生成 → 互動課程」查看並審核這份藍圖（附上 review_url）。之後用 get_course_blueprint_review 讀取：approved 才能 start_openmaic_classroom；changes_requested 依 feedback 修改後再 submit_course_blueprint（replaces_draft_id）。" }, 201);
});
routes.get("/blueprints", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT b.*,d.title AS note_title,d.slug AS note_slug,t.title AS chapter_title FROM course_blueprint_drafts b JOIN documents d ON d.id=b.document_id LEFT JOIN topics t ON t.id=b.topic_id WHERE b.created_by=? ORDER BY b.updated_at DESC LIMIT 40")
    .bind(c.get("user").id).all<DraftRow & { note_title: string; note_slug: string; chapter_title: string | null }>();
  return c.json({ drafts: results.map((row) => draftView(row)) });
});
routes.get("/blueprints/:id", async (c) => c.json({ draft: draftView(await ownDraft(c, c.req.param("id")), true) }));
routes.post("/blueprints/:id/decision", async (c) => {
  const row = await ownDraft(c, c.req.param("id"));
  const body = await readJson<{ decision?: string; feedback?: string }>(c.req.raw);
  if (row.status !== "pending_review" && row.status !== "changes_requested") bad(row.status === "superseded" ? "這份藍圖已被新版本取代" : "這份藍圖已核准或已開始生成", 409);
  if (body.decision !== "approve" && body.decision !== "changes") bad("decision 必須是 approve 或 changes");
  const feedback = body.decision === "changes" ? str(body.feedback, "feedback", { max: 4000 }).trim() : null;
  if (body.decision === "changes" && !feedback) bad("請寫下要 AI 修改的地方");
  await c.env.DB.prepare("UPDATE course_blueprint_drafts SET status=?,feedback=?,updated_at=? WHERE id=?").bind(body.decision === "approve" ? "approved" : "changes_requested", feedback, now(), row.id).run();
  return c.json({ status: body.decision === "approve" ? "approved" : "changes_requested" });
});
routes.post("/generations", async (c) => {
  const body = await readJson<{ note_slug?: string; topic?: string; blueprint?: unknown; blueprint_draft_id?: string; long_course_part_id?: string }>(c.req.raw);
  const part = body.long_course_part_id ? await c.env.DB.prepare(`SELECT p.*,lc.document_id,lc.created_by AS course_owner,lc.title AS course_title FROM long_course_parts p JOIN long_courses lc ON lc.id=p.course_id WHERE p.id=?`).bind(str(body.long_course_part_id, "long_course_part_id", { max: 100 })).first<{ id: string; document_id: string; course_owner: string; course_title: string; title: string; position: number; source_md: string; blueprint_json: string; generation_id: string | null; generation_attempt: number }>() : null;
  if (body.long_course_part_id && (!part || part.course_owner !== c.get("user").id)) bad("找不到可生成的分冊", 404);
  const doc = await noteForCourse(c, part?.document_id ?? body.note_slug);
  if (part?.generation_id) return c.json({ generation_id: part.generation_id, reused: true, next_action: "用 get_openmaic_core_step 續接既有分冊" });
  if (part) { body.blueprint = JSON.parse(part.blueprint_json); body.topic = `${part.course_title}・第 ${part.position} 冊：${part.title}`; }
  await requireAiAccess(c.env, c.get("user"));
  // A single classroom starts from a blueprint the learner approved in the app (or one the chatbot was told to run in yolo mode).
  const draft = part ? null : body.blueprint_draft_id ? await ownDraft(c, str(body.blueprint_draft_id, "blueprint_draft_id", { max: 100 })) : null;
  if (!part && !draft) bad("先用 submit_course_blueprint 送出藍圖與自我審查，經使用者在 App 核准（或 yolo 模式）後，以 blueprint_draft_id 開始生成", 422);
  if (draft) {
    if (draft.document_id !== doc.id) bad("這份藍圖屬於另一份重點整理", 409);
    if (draft.status === "started" && draft.generation_id) return c.json({ generation_id: draft.generation_id, reused: true, next_action: "這份藍圖已開始生成，用 get_openmaic_core_step 續接" });
    if (draft.status !== "approved") bad(draft.status === "pending_review" ? "藍圖還在等使用者在 App 審核；用 get_course_blueprint_review 查看結果" : draft.status === "changes_requested" ? `使用者要求修改藍圖：${draft.feedback}` : "這份藍圖已被取代，請用最新版本", 409);
    body.blueprint = JSON.parse(draft.blueprint_json); body.topic = draft.topic;
  }
  const report = await reviewBlueprint(c, doc.subject_id, body.blueprint);
  if (!report.ok || !report.value) return blueprintFailure(c, report);
  const blueprint = report.value;
  const source = part?.source_md ?? await revisionBody(c.env, doc.current_revision_id);
  if (source.length > 45_000) bad("官方核心只讀前 50,000 字元；請用 create_long_course / add_long_course_part 分冊，避免遺漏來源", 413);
  if (part) {
    const lease = await c.env.DB.prepare("UPDATE long_course_parts SET start_lease=? WHERE id=? AND generation_id IS NULL AND (start_lease IS NULL OR start_lease<?) RETURNING id").bind(now(), part.id, now() - 120_000).first();
    if (!lease) bad("分冊正在啟動，稍後讀取 get_long_course 查看 generation_id", 409);
  }
  const version = await c.env.DB.prepare("SELECT version FROM note_courses WHERE document_id=?").bind(doc.id).first<{ version: number }>();
  try {
  const topic = str(body.topic ?? doc.title, "topic", { max: 1000 });
  const fullRequirement = courseRequirement(topic, blueprint);
  if (fullRequirement.length > MAX_COURSE_REQUIREMENT_CHARS) bad("課程藍圖與教學需求超過官方單冊 20,000 字元上限，請拆成更小的分冊或精簡藍圖（保留完整來源）", 413);
  const material = await coreRequest<{ materialId: string }>(c.env, c.get("user").id, "POST", "/api/materials", source, { "content-type": "text/markdown", "x-material-filename": encodeURIComponent(`${doc.slug}.md`) });
  const input = { requirement: fullRequirement, materialIds: [material.materialId], interactive: true, outlineReview: "auto", agents: { mode: "auto" } };
  const result = await coreRequest<{ run: { id: string } }>(c.env, c.get("user").id, "POST", part ? "/api/study-mcp/start-part" : "/api/generation-runs", part ? { part_id: part.generation_attempt ? `${part.id}:${part.generation_attempt}` : part.id, input } : input);
  const id = result.run?.id;
  if (!id || typeof id !== "string") bad("OpenMAIC core 未回傳有效 run id", 502);
  const insert = c.env.DB.prepare("INSERT INTO openmaic_core_runs(id,document_id,created_by,source_revision_id,expected_course_version,created_at,blueprint_json,blueprint_draft_id) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id, doc.id, c.get("user").id, doc.current_revision_id, version?.version ?? 0, now(), JSON.stringify(blueprint), draft?.id ?? null);
  if (part) {
    const previous = await c.env.DB.prepare("SELECT document_id,created_by FROM openmaic_core_runs WHERE id=?").bind(id).first<{ document_id: string; created_by: string }>();
    if (previous && (previous.document_id !== doc.id || previous.created_by !== c.get("user").id)) bad("生成作業已連結其他來源", 409);
    await c.env.DB.batch([insert, c.env.DB.prepare("UPDATE long_course_parts SET generation_id=?,start_lease=NULL WHERE id=?").bind(id, part.id)]);
  } else await c.env.DB.batch([insert, c.env.DB.prepare("UPDATE course_blueprint_drafts SET status='started',generation_id=?,updated_at=? WHERE id=?").bind(id, now(), draft!.id)]);
  return c.json({ generation_id: id, engine: "OpenMAIC", transport: "study-mcp/v1", ib_reference_instructions: IB_REFERENCE_INSTRUCTIONS, blueprint_warnings: report.warnings, next_action: "呼叫 get_openmaic_core_step(summary=true)，分段讀完官方任務；自我覆核並附 verification 先 validate_openmaic_core_step，通過後只傳 id/version/validation_receipt 提交已儲存稿（省略 output）。場景標題須與藍圖相同。完成後先 check_openmaic_slides、check_openmaic_modules 與 check_openmaic_alignment，再 submit_classroom_review 詳細覆核，通過後才 publish_openmaic_classroom。" });
  } catch (error) {
    if (part) await c.env.DB.prepare("UPDATE long_course_parts SET start_lease=NULL WHERE id=? AND generation_id IS NULL").bind(part.id).run();
    throw error;
  }
});
routes.get("/generations", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id,document_id,created_at FROM openmaic_core_runs WHERE created_by=? ORDER BY created_at DESC LIMIT 30").bind(c.get("user").id).all<{ id: string; document_id: string }>();
  const allowed = [];
  for (const row of results) if (await requireDocumentAccess(c.env, c.get("user"), row.document_id)) allowed.push(row);
  return c.json({ generations: allowed });
});
routes.get("/generations/:id", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await requireDocumentAccess(c.env, c.get("user"), run.document_id)) bad("找不到你的 OpenMAIC 生成作業", 404);
  await requireAiAccess(c.env, c.get("user"));
  // Avoid overlapping full-core cold starts within one service-binding request.
  const job = await coreRequest(c.env, c.get("user").id, "GET", `/api/generate-classroom/${encodeURIComponent(run!.id)}`);
  const tasks = await coreRequest(c.env, c.get("user").id, "GET", `/api/study-mcp/tasks?run_id=${encodeURIComponent(run!.id)}${c.req.query("summary") === "true" ? "&summary=1" : ""}`);
  return c.json({ generation_id: run!.id, ...job, ...tasks });
});
routes.post("/generations/:id/retry", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await requireDocumentWrite(c.env, c.get("user"), run.document_id)) bad("找不到你的生成作業", 404);
  const body = await readJson<{ command_id?: string }>(c.req.raw);
  const commandId = str(body.command_id, "command_id", { max: 128 });
  return c.json(await coreRequest(c.env, c.get("user").id, "POST", `/api/study-mcp/runs/${encodeURIComponent(run!.id)}/retry`, { commandId }));
});
routes.get("/tasks", async (c) => c.json(await coreRequest(c.env, c.get("user").id, "GET", `/api/study-mcp/tasks${c.req.query("summary") === "true" ? "?summary=1" : ""}`)));
routes.get("/tasks/:id/context", async c => {
  const offset = Number(c.req.query("offset") ?? 0);
  const limit = Number(c.req.query("limit") ?? 24_000);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24_000) bad("分段參數不合法");
  return c.json(await coreRequest(c.env, c.get("user").id, "GET", `/api/study-mcp/tasks/${encodeURIComponent(coreId(c.req.param("id")))}?offset=${offset}&limit=${limit}`));
});
const CHECKED_STAGES = new Set(["scene-outlines-stream", "scene-content:slide", "scene-content:quiz", "scene-content:interactive", "scene-actions"]);
/** Pages of a task request read to find the scene a turn is for. A request longer than this is checked without its title. */
const MAX_REQUEST_PAGES = 6;
interface TaskPage { run_id?: string; source?: string; text?: string; next_offset?: number | null }
/** The scene (title and kind) the official prompt of this task is about, or null when the request cannot be read whole. */
async function sceneOfTask(c: Context<AppEnv>, taskId: string, first: TaskPage): Promise<TurnScene | null> {
  let text = first.text ?? "", next = first.next_offset ?? null;
  for (let page = 1; next !== null && page < MAX_REQUEST_PAGES; page++) {
    // peek: a read made for this check is not the chatbot reading its task.
    const more = await coreRequest<TaskPage>(c.env, c.get("user").id, "GET", `/api/study-mcp/tasks/${encodeURIComponent(taskId)}?offset=${next}&limit=48000&peek=1`);
    text += more.text ?? ""; next = more.next_offset ?? null;
  }
  if (next !== null) return null;
  try { return turnScene(requestUserText(JSON.parse(text))); } catch { return null; }
}
/**
 * STUDY's rules on one drafted model turn, so a problem costs one more turn instead of a finished course part:
 * the outline against its blueprint, slides that ask instead of teach, quizzes the router cannot read, modules nobody
 * can operate and narration that does not guide. A draft that cannot be read for its stage is refused, never waved through.
 */
async function draftProblems(c: Context<AppEnv>, taskId: string, output: unknown): Promise<DraftProblems> {
  const none = { errors: [], warnings: [] };
  const text = (output as { text?: unknown } | null | undefined)?.text;
  if (typeof text !== "string" || !text.trim()) return none;
  const task = await coreRequest<TaskPage>(c.env, c.get("user").id, "GET", `/api/study-mcp/tasks/${encodeURIComponent(taskId)}?offset=0&limit=48000&peek=1`);
  const stage = (task.source ?? "").replace(/:epoch-\d+$/, "");
  if (!CHECKED_STAGES.has(stage)) return none;
  const run = task.run_id ? await c.env.DB.prepare("SELECT blueprint_json FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(task.run_id, c.get("user").id).first<{ blueprint_json: string | null }>() : null;
  // Runs from before blueprints keep the checks they were started under.
  const blueprint = run?.blueprint_json ? JSON.parse(run.blueprint_json) as CourseBlueprint : null;
  const draft = parseDraft(text);
  const unreadable = (what: string): DraftProblems => blueprint ? { errors: [`這個回合要輸出${what}，但草稿讀不出來：只輸出合法的 JSON，不加說明文字`], warnings: [] } : none;
  if (stage === "scene-outlines-stream") {
    const scenes = outlineScenes(draft);
    if (!scenes) return unreadable("大綱（含 outlines 陣列的 JSON 物件，每個場景有 title 與 type）");
    const structure = blueprint ? outlineDraftProblems(blueprint, scenes) : none;
    // A planned slide whose outline is an exercise is caught here, one turn before the slide itself is written.
    const planned = scenes.flatMap((scene, i) => scene.type === "slide" ? [{ id: `outline-${i}`, kind: "slide" as const, title: scene.title ?? "", text: JSON.stringify(Object.fromEntries(Object.entries(scene).filter(([key]) => !["id", "type", "order"].includes(key)))), dialogue: [] }] : []);
    const judged = await judgeContent(c.env, planned);
    return { errors: [...structure.errors, ...judged.problems.map((p) => `投影片「${p.title}」${p.problem}：投影片只講解，題目改放先測、檢核或互動模組`)], warnings: [...structure.warnings, ...(judged.note ? [judged.note] : [])] };
  }
  if (stage === "scene-content:slide") {
    const elements = slideElements(draft);
    if (!elements) return unreadable("投影片（含 elements 陣列的 JSON 物件）");
    const judged = await judgeContent(c.env, [{ id: "draft", kind: "slide", title: "", text: slideDraftText(elements), dialogue: [] }]);
    return { errors: judged.problems.map((p) => `${p.problem}。改成附完整解答的例題或陳述句，題目放到先測、檢核或互動模組`), warnings: judged.note ? [judged.note] : [] };
  }
  if (!blueprint) return none;
  const scene = await sceneOfTask(c, taskId, task);
  if (stage === "scene-content:quiz") {
    if (!Array.isArray(draft)) return unreadable("測驗題目（JSON 陣列）");
    return quizDraftProblems(scene?.title ?? "", draft);
  }
  if (stage === "scene-content:interactive") return moduleDraftProblems(scene?.title ?? "", text);
  const narration = narrationOf(draft);
  if (!narration || !scene) return none;
  // Fixed rules only: the model judge reads the same narration once, with the whole classroom, before publishing.
  return narrationDraftProblems(scene, narration);
}
routes.post("/tasks/:id/validate", async c => {
  const body = await readJson<{ output?: unknown; expected_version?: unknown }>(c.req.raw);
  const taskId = coreId(c.req.param("id")), problems = await draftProblems(c, taskId, body.output);
  if (problems.errors.length) return c.json({ ok: false, task_id: taskId, expected_version: body.expected_version, errors: problems.errors, warnings: problems.warnings, next_action: "Correct the draft, then validate again. This task has not advanced and any earlier validated draft is unchanged." });
  const result = await coreRequest(c.env, c.get("user").id, "POST", `/api/study-mcp/tasks/${encodeURIComponent(taskId)}/validate`, body);
  return c.json(problems.warnings.length ? { ...result, warnings: problems.warnings } : result);
});
routes.post("/tasks/:id", async (c) => {
  const body = await readJson<{ output?: unknown }>(c.req.raw);
  const problems = await draftProblems(c, coreId(c.req.param("id")), body.output);
  if (problems.errors.length) return c.json({ error: "這份草稿不符合課程規則，修正後重新驗證", errors: problems.errors }, 422);
  return c.json(await coreRequest(c.env, c.get("user").id, "POST", `/api/study-mcp/tasks/${encodeURIComponent(coreId(c.req.param("id")))}`, body));
});
async function stageScenes(c: Context<AppEnv>, classroomId: string) {
  const stage = await coreRequest<{ scenes?: Parameters<typeof judgeClassroom>[1] & Parameters<typeof checkClassroomAgainstBlueprint>[1] }>(c.env, c.get("user").id, "GET", `/api/stages/${encodeURIComponent(classroomId)}`);
  return stage.scenes ?? [];
}
/** Slide findings of a judgment, in the shape the slide check has always returned. */
const slideFindings = (judgment: Judgment): SlideViolation[] => judgment.problems.filter((p) => p.rule.endsWith("_on_slide")).map((p) => ({ scene_id: p.scene_id, title: p.title, reasons: [p.problem], excerpt: "" }));
const moduleFindings = (judgment: Judgment) => judgment.problems.filter((p) => !p.rule.endsWith("_on_slide"));
/** Null for a run that started before blueprints existed. */
async function alignmentOf(c: Context<AppEnv>, run: NativeRun, classroomId: string, scenes?: Awaited<ReturnType<typeof stageScenes>>) {
  if (!run.blueprint_json) return null;
  return checkClassroomAgainstBlueprint(JSON.parse(run.blueprint_json) as CourseBlueprint, scenes ?? await stageScenes(c, classroomId));
}
routes.get("/generations/:id/slide-check", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await requireDocumentAccess(c.env, c.get("user"), run.document_id)) bad("找不到你的 OpenMAIC 生成作業", 404);
  const job = await coreRequest<{ status: string; result?: { classroomId?: string } }>(c.env, c.get("user").id, "GET", `/api/generate-classroom/${encodeURIComponent(run!.id)}`);
  if (job.status !== "succeeded" || !job.result?.classroomId) bad("課堂尚未完成官方生成與編譯，完成後才能檢查投影片", 422);
  const judgment = await judgeClassroom(c.env, await stageScenes(c, job.result!.classroomId));
  const violations = slideFindings(judgment);
  return c.json({ ok: violations.length === 0, violations, judge: judgment.judge, judge_note: judgment.note, message: violations.length ? slideQuestionMessage(violations) : "投影片沒有放題目，也沒有要學生自己算。" });
});
routes.get("/generations/:id/alignment-check", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await requireDocumentAccess(c.env, c.get("user"), run.document_id)) bad("找不到你的 OpenMAIC 生成作業", 404);
  const job = await coreRequest<{ status: string; result?: { classroomId?: string } }>(c.env, c.get("user").id, "GET", `/api/generate-classroom/${encodeURIComponent(run!.id)}`);
  if (job.status !== "succeeded" || !job.result?.classroomId) bad("課堂尚未完成官方生成與編譯，完成後才能檢查對齊", 422);
  const report = await alignmentOf(c, run!, job.result!.classroomId);
  if (!report) return c.json({ ok: true, errors: [], warnings: [], message: "這次生成沒有課程藍圖（舊流程），略過對齊檢查。" });
  return c.json({ ...report, message: report.ok ? "課堂與藍圖的章節一致。" + (report.warnings.length ? "有 " + report.warnings.length + " 項建議。" : "") : "課堂與藍圖不一致，修正後才能發布：\n" + report.errors.map((error) => "- " + error).join("\n") });
});
routes.get("/generations/:id/module-check", async (c) => {
  const { classroomId } = await finishedClassroom(c, false);
  const judgment = await judgeClassroom(c.env, await stageScenes(c, classroomId));
  const problems = moduleFindings(judgment);
  return c.json({ ok: problems.length === 0, problems, judge: judgment.judge, judge_note: judgment.note, message: problems.length ? "以下場景不符合模組與檢核規則，修正後才能發布：\n" + judgmentMessage({ ...judgment, problems }) : "互動模組都由對話導覽操作，檢核都是測驗。" });
});
routes.post("/generations/:id/completion-review", async (c) => {
  const { run, classroomId } = await finishedClassroom(c, true);
  if (!run.blueprint_json) bad("這次生成沒有課程藍圖（舊流程），不需覆核", 422);
  const parsed = classroomReviewSchema.safeParse((await readJson<{ review?: unknown }>(c.req.raw)).review);
  if (!parsed.success) return c.json({ ok: false, errors: parsed.error.issues.map((i) => `review.${i.path.join(".")}: ${i.message}`) }, 422);
  const scenes = await stageScenes(c, classroomId);
  const report = checkClassroomReview(parsed.data, JSON.parse(run.blueprint_json) as CourseBlueprint, scenes as { title?: string; type?: string }[]);
  const judgment = await judgeClassroom(c.env, scenes);
  report.errors.push(...judgment.problems.filter((p) => p.blocking).map((p) => `「${p.title}」${p.problem}`));
  if (report.errors.length) return c.json({ ok: false, ...report, next_action: "用 update_openmaic_scene 修正場景（或修正覆核內容），再重新 submit_classroom_review" }, 422);
  await c.env.DB.prepare("UPDATE openmaic_core_runs SET completion_review_json=? WHERE id=?").bind(JSON.stringify({ ...parsed.data, reviewed_at: now() }), run.id).run();
  return c.json({ ok: true, warnings: report.warnings, next_action: "覆核通過，可以 publish_openmaic_classroom，發布後把 summary 告訴使用者。" });
});
routes.post("/generations/:id/publish", async (c) => {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await requireDocumentWrite(c.env, c.get("user"), run.document_id)) bad("找不到可發布的生成作業", 404);
  const doc = await getDoc(c.env, run!.document_id);
  const part = await c.env.DB.prepare("SELECT p.id,lc.created_by FROM long_course_parts p JOIN long_courses lc ON lc.id=p.course_id WHERE p.generation_id=?").bind(run!.id).first<{ id: string; created_by: string }>();
  // A long-course part teaches from its own stored source, so a later edit of the note does not make it stale.
  if (!part && doc.current_revision_id !== run!.source_revision_id) bad("來源筆記已修訂，請根據最新內容重新生成", 409);
  const job = await coreRequest<{ status: string; result?: { classroomId?: string } }>(c.env, c.get("user").id, "GET", `/api/generate-classroom/${encodeURIComponent(run!.id)}`);
  if (job.status !== "succeeded" || !job.result?.classroomId) bad("請先完成官方 core 的全部模型任務、場景編譯與檢查", 422);
  const scenes = await stageScenes(c, job.result.classroomId);
  const judgment = await judgeClassroom(c.env, scenes);
  const violations = slideFindings(judgment);
  if (violations.length) return c.json({ error: slideQuestionMessage(violations), violations, judge: judgment.judge }, 422);
  const alignment = await alignmentOf(c, run!, job.result.classroomId, scenes);
  if (alignment && !alignment.ok) return c.json({ error: "課堂與課程藍圖不一致，修正後才能發布", errors: alignment.errors, alignment }, 422);
  const moduleProblems = moduleFindings(judgment);
  if (moduleProblems.length) return c.json({ error: "互動模組或課間檢核不符合規則，修正後才能發布：\n" + judgmentMessage({ ...judgment, problems: moduleProblems }), problems: moduleProblems, judge: judgment.judge }, 422);
  // A classroom built from a reviewed blueprint is published only after the chatbot's chapter-by-chapter review passed.
  if (run!.blueprint_draft_id && !run!.completion_review_json) return c.json({ error: "還沒完成課程覆核：先 submit_classroom_review 逐章說明每個主題如何講解、每個目標在哪裡檢核，通過後才能發布" }, 422);
  if (part) {
    if (part.created_by !== c.get("user").id) bad("只有建立者能發布分冊", 403);
    const published = await c.env.DB.prepare("UPDATE long_course_parts SET classroom_id=?,published_at=COALESCE(published_at,?) WHERE id=? AND generation_id=? RETURNING id").bind(job.result.classroomId, now(), part.id, run!.id).first();
    if (!published) bad("這次生成已不屬於該分冊，請讀取 get_long_course 查看目前的 generation_id", 409);
    return c.json({ part_id: part.id, classroom_id: job.result.classroomId, alignment_warnings: alignment?.warnings ?? [], url: `/notes/${encodeURIComponent(doc.slug)}?view=course` });
  }
  const saved = await saveNoteCourse(c.env, c.get("user").id, doc, { schema: "study-openmaic/v1", format: "openmaic-core", title: doc.title, classroom_id: job.result.classroomId, core_version: "1.3.0" }, run!.expected_course_version, undefined, run!.source_revision_id);
  return c.json({ ...saved, alignment_warnings: alignment?.warnings ?? [], classroom_id: job.result.classroomId, url: `/notes/${encodeURIComponent(doc.slug)}?view=course` });
});
/** The finished classroom of a generation, for reading or correcting single scenes. */
async function finishedClassroom(c: Context<AppEnv>, write: boolean) {
  const run = await c.env.DB.prepare("SELECT * FROM openmaic_core_runs WHERE id=? AND created_by=?").bind(c.req.param("id"), c.get("user").id).first<NativeRun>();
  if (!run || !await (write ? requireDocumentWrite : requireDocumentAccess)(c.env, c.get("user"), run.document_id)) bad("找不到你的 OpenMAIC 生成作業", 404);
  const job = await coreRequest<{ status: string; result?: { classroomId?: string } }>(c.env, c.get("user").id, "GET", `/api/generate-classroom/${encodeURIComponent(run!.id)}`);
  if (job.status !== "succeeded" || !job.result?.classroomId) bad("課堂尚未完成官方生成與編譯；生成途中請修正當前模型回合", 422);
  return { run: run!, classroomId: job.result!.classroomId! };
}
interface ClassroomDocument { scenes: (Record<string, unknown> & { id: string; title?: string; type?: string })[] }
routes.get("/generations/:id/scenes", async (c) => {
  const { classroomId } = await finishedClassroom(c, false);
  const ids = c.req.query("ids");
  if (ids) return c.json(await coreRequest(c.env, c.get("user").id, "GET", `/api/stages/${encodeURIComponent(classroomId)}/scenes?ids=${encodeURIComponent(ids)}`));
  const stage = await coreRequest<ClassroomDocument>(c.env, c.get("user").id, "GET", `/api/stages/${encodeURIComponent(classroomId)}`);
  return c.json({ scenes: stage.scenes.map(({ id, title, type }) => ({ id, title, type })) });
});
// Fixes what a publish check found in one scene, without regenerating the classroom.
routes.patch("/generations/:id/scenes/:scene", async (c) => {
  const { run, classroomId } = await finishedClassroom(c, true);
  const body = await readJson<{ title?: unknown; content?: unknown; actions?: unknown }>(c.req.raw);
  if (body.title === undefined && body.content === undefined && body.actions === undefined) bad("至少提供 title、content 或 actions 其中一項");
  if (body.content !== undefined && (!body.content || typeof body.content !== "object" || Array.isArray(body.content))) bad("content 必須是物件");
  if (body.actions !== undefined && !Array.isArray(body.actions)) bad("actions 必須是陣列");
  const stage = await coreRequest<ClassroomDocument>(c.env, c.get("user").id, "GET", `/api/stages/${encodeURIComponent(classroomId)}`);
  const sceneId = c.req.param("scene");
  if (!stage.scenes.some(scene => scene.id === sceneId)) bad("找不到這個場景", 404);
  const scenes = stage.scenes.map(scene => scene.id !== sceneId ? scene : { ...scene, ...(body.title !== undefined ? { title: str(body.title, "title", { max: 200 }) } : {}), ...(body.content !== undefined ? { content: body.content } : {}), ...(body.actions !== undefined ? { actions: body.actions } : {}) });
  await coreRequest(c.env, c.get("user").id, "PUT", `/api/stages/${encodeURIComponent(classroomId)}`, { ...stage, scenes });
  // The chapter-by-chapter review described the classroom as it was; an edited classroom has to be reviewed again before publishing.
  const reviewed = !!run.completion_review_json;
  if (reviewed) await c.env.DB.prepare("UPDATE openmaic_core_runs SET completion_review_json=NULL WHERE id=?").bind(run.id).run();
  const alignment = await alignmentOf(c, run, classroomId, scenes as Awaited<ReturnType<typeof stageScenes>>);
  const judgment = await judgeClassroom(c.env, scenes as Awaited<ReturnType<typeof stageScenes>>);
  return c.json({ updated: true, scene_id: sceneId, slide_violations: slideFindings(judgment), module_problems: moduleFindings(judgment), judge: judgment.judge, alignment,
    ...(reviewed ? { review_required: true, next_action: "場景已修改，先前的課程覆核失效：修正完成後重新 submit_classroom_review，通過才能發布" } : {}) });
});
async function classroomOfNote(c: Context<AppEnv>, slug: unknown): Promise<string> {
  const doc = await getDoc(c.env, str(slug, "note_slug", { max: 200 }));
  if (!await requireDocumentAccess(c.env, c.get("user"), doc.id)) bad("找不到課程", 404);
  const row = await c.env.DB.prepare("SELECT course_json FROM note_courses WHERE document_id=?").bind(doc.id).first<{ course_json: string }>();
  const course = row ? JSON.parse(row.course_json) as { format?: string; classroom_id?: string } : null;
  if (course?.format !== "openmaic-core" || !course.classroom_id) bad("此課程尚未使用官方核心生成", 422);
  return course.classroom_id;
}
// The first request after a quiet period starts the Core and its database, which is most of the wait. Doing that read
// while the learner is still looking at the course page makes opening the classroom much faster.
routes.post("/warm", async (c) => {
  const body = await readJson<{ note_slug?: string }>(c.req.raw);
  const classroom = await classroomOfNote(c, body.note_slug);
  const work = coreRequest(c.env, c.get("user").id, "GET", `/api/stages/${encodeURIComponent(classroom)}`).catch(() => undefined);
  try { c.executionCtx.waitUntil(work); } catch { void work; }
  return c.json({ ok: true }, 202);
});
routes.post("/launch", async (c) => {
  const body = await readJson<{ note_slug?: string }>(c.req.raw);
  const classroomId = await classroomOfNote(c, body.note_slug);
  const course = { classroom_id: classroomId };
  const config = coreConfiguration(c.env);
  const ticket = await signOpenMaicTicket({ sub: `study:${c.get("user").id}`, aud: "study-openmaic", scope: "classroom", classroom_id: course.classroom_id, session_hash: c.get("sessionHash"), exp: now() + 60_000 }, config.secret);
  return c.json({ action: "/api/study-mcp/session", ticket, classroom_id: course.classroom_id });
});
export default routes;
