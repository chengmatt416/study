import { z } from "zod";
import { lessonStepsSchema } from "./lesson-flow";

// Compatible subset of OpenMAIC's Scene / InteractiveContent / QuizContent.
// Other native scene kinds are played through OpenMAIC's standalone HTML export.
export const MAX_COURSE_BYTES = 950_000;
const text = z.string().trim().min(1);
export const courseHtmlSchema = text.max(800_000).refine((s) => /<html[\s>]/i.test(s) && /<\/html\s*>/i.test(s), "請提供完整、自足的 HTML 文件");
export const courseQuestionSchema = z.object({
  id: text.max(100),
  type: z.enum(["single", "multiple", "short_answer"]),
  question: text.max(20_000),
  options: z.array(z.object({ label: text.max(5000), value: text.max(100) })).min(2).max(12).optional(),
  answer: z.array(text.max(5000)).min(1).max(12).optional(),
  analysis: text.max(20_000),
  points: z.number().positive().max(100).default(1),
}).superRefine((q, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (q.type === "short_answer") return;
  if (!q.options || !q.answer) return issue("選擇題必須包含 options 與 answer");
  const keys = q.options.map((o) => o.value);
  if (new Set(keys).size !== keys.length) issue("選項 value 不可重複");
  if (q.answer.some((a) => !keys.includes(a))) issue("答案必須對應選項 value");
  if (new Set(q.answer).size !== q.answer.length) issue("答案不可重複");
  if (q.type === "single" && q.answer.length !== 1) issue("單選題必須只有一個答案");
});
export const teachingStepSchema = z.object({
  id: text.max(100), title: text.max(200),
  body_md: text.min(30).max(12000).describe("一個概念或示範推理步驟，先解釋再要求操作"),
  explanation_md: text.min(60).max(16000).describe("點擊不懂才展開：更小的推理步驟、具體例子、常見誤解及與主概念的連結，不得重複正文"),
});
export const teachingStepsSchema = z.array(teachingStepSchema).min(2).refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, "教學步驟 id 不可重複");
export const masteryQuestionsSchema = z.array(courseQuestionSchema).min(1).superRefine((questions, ctx) => {
  if (new Set(questions.map((q) => q.id)).size !== questions.length) ctx.addIssue({ code: "custom", message: "題號不可重複" });
  questions.forEach((q, i) => {
    if (q.type === "short_answer") ctx.addIssue({ code: "custom", path: [i, "type"], message: "先測與章節檢核須使用可客觀判定的 single / multiple 題，簡答留給最終反思" });
    if (q.analysis.length < 30) ctx.addIssue({ code: "custom", path: [i, "analysis"], message: "解析至少 30 字，說明推理與誤解" });
  });
});
const core = {
  id: text.max(100).optional(),
  title: text.max(200),
  order: z.number().int().nonnegative(),
  learningObjective: text.max(2000).optional(),
  instructions: text.max(5000).optional(),
  reflection: text.max(5000).optional(),
};
const scene = z.discriminatedUnion("type", [
  z.object({ ...core, type: z.literal("interactive"), content: z.object({
    type: z.literal("interactive"), html: courseHtmlSchema,
    widgetType: z.enum(["simulation", "diagram", "code", "game", "visualization3d", "procedural-skill"]).optional(),
    lesson_steps: lessonStepsSchema.optional(),
    pretest: masteryQuestionsSchema.optional(),
    teaching_steps: teachingStepsSchema.optional(),
    checkpoint: masteryQuestionsSchema.optional(),
  }) }),
  z.object({ ...core, type: z.literal("quiz"), content: z.object({ type: z.literal("quiz"), questions: z.array(courseQuestionSchema).min(1) }) }),
]);

export const courseSchema = z.discriminatedUnion("format", [
  z.object({ schema: z.literal("study-openmaic/v1"), format: z.literal("openmaic-core"), title: text.max(200), classroom_id: text.regex(/^[A-Za-z0-9_-]+$/).max(200), core_version: text.max(50) }),
  z.object({
    schema: z.literal("study-openmaic/v1"), format: z.literal("openmaic-scenes"),
    title: text.max(200), description: z.string().max(5000).optional(),
    objectives: z.array(text.max(2000)).min(1), scenes: z.array(scene).min(1),
    learning_design: z.literal("mastery/v1").optional(),
  }),
  z.object({ schema: z.literal("study-openmaic/v1"), format: z.literal("openmaic-html"), title: text.max(200), html: courseHtmlSchema }),
]);
export type OpenMaicCourse = z.infer<typeof courseSchema>;
export type CourseScene = z.infer<typeof scene>;
export type QuizQuestion = z.infer<typeof courseQuestionSchema>;
export interface NoteCourse { course: OpenMaicCourse | null; version: number; updated_at: number | null }

/** Accept our envelope, a native manifest.json (interactive/quiz only), or an offline HTML export. */
export function validateCourse(input: unknown): { ok: true; course: OpenMaicCourse } | { ok: false; errors: string[] } {
  let value = input;
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > MAX_COURSE_BYTES) return { ok: false, errors: ["課程超出 950 KB 上限"] };
    try { value = JSON.parse(value); } catch { return { ok: false, errors: ["課程不是合法 JSON；HTML 請以 openmaic-html 格式包裝"] }; }
  }
  if (value && typeof value === "object" && "formatVersion" in value) {
    const manifest = value as Record<string, unknown>;
    if (manifest.formatVersion !== 1) return { ok: false, errors: ["不支援此 OpenMAIC manifest 版本"] };
    const stage = manifest.stage as Record<string, unknown> | undefined;
    value = {
      schema: "study-openmaic/v1", format: "openmaic-scenes", title: stage?.name,
      description: stage?.description, objectives: [String(stage?.description || stage?.name || "理解課程核心觀念")], scenes: manifest.scenes,
    };
  }
  let size: number;
  try { size = new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return { ok: false, errors: ["課程必須是可序列化的 JSON"] }; }
  if (size > MAX_COURSE_BYTES) return { ok: false, errors: ["課程超出 950 KB 上限"] };
  const result = courseSchema.safeParse(value);
  if (!result.success) return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const course = result.data;
  if (course.format === "openmaic-scenes") {
    const errors: string[] = [];
    if (new Set(course.scenes.map((s) => s.order)).size !== course.scenes.length) errors.push("場景 order 不可重複");
    const ids = course.scenes.flatMap((s) => s.id ? [s.id] : []);
    if (new Set(ids).size !== ids.length) errors.push("場景 id 不可重複");
    for (const s of course.scenes) {
      if (s.type === "quiz" && new Set(s.content.questions.map((q) => q.id)).size !== s.content.questions.length) errors.push(`${s.title}: 題號不可重複`);
    }
    if (course.learning_design === "mastery/v1") {
      const chapters = course.scenes.filter((s) => s.type === "interactive");
      if (!chapters.length) errors.push("精熟課程至少需要一個教學章節");
      for (const chapter of chapters) {
        if (!chapter.content.pretest || !chapter.content.teaching_steps || !chapter.content.checkpoint || !chapter.content.lesson_steps) errors.push(`${chapter.title}: 必須包含先測、逐步教學、不懂解說、互動與章節檢核`);
        if (chapter.content.pretest?.some((q) => chapter.content.checkpoint?.some((c) => c.id === q.id || c.question.trim() === q.question.trim()))) errors.push(`${chapter.title}: 先測與檢核須使用不同題目，避免只記住答案`);
      }
    }
    if (errors.length) return { ok: false, errors };
    course.scenes.sort((a, b) => a.order - b.order);
  }
  return { ok: true, course };
}

// The first policy cannot be relaxed by a later CSP in generated/imported HTML.
// No same-origin sandbox permission is granted by the host iframe.
export function sandboxCourseHtml(html: string): string {
  const policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src about: blob: data:; worker-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">${html}`;
}

/** Short answers use reference feedback; no model call or misleading automatic grade. */
export function gradeCourseQuestion(q: QuizQuestion, selected: string[]): boolean | null {
  if (q.type === "short_answer") return null;
  return !!q.answer && selected.length === q.answer.length && new Set(selected).size === selected.length && q.answer.every((a) => selected.includes(a));
}

export function buildCoursePrompt(topic: string, slug?: string): string {
  return `請用完整官方 OpenMAIC core 為「${topic}」生成繁體中文互動課堂，生成、編譯與課堂執行都必須由官方 core 負責。模型推理由目前 chatbot 經 MCP 多步提供，不設定模型 API key。\n` +
    `先 get_openmaic_guide、get_openmaic_core_status、study_overview。${slug ? `使用 note_slug=${JSON.stringify(slug)}。` : "未指定來源筆記：先用 list_documents（kind=note）列出使用者既有的重點整理，請使用者確認要用哪一份。不要為藍圖、課堂或來源另建重點整理；只有使用者明確要求建立重點整理時才可 create_note。"}\n` +
    `先檢查來源規模：超過 45,000 字元、12 章或預計 100 場景時，用 create_long_course、add_long_course_part、start_long_course_part 依來源順序分冊，每冊保留完整原文與獨立藍圖；不要默默截斷教材。一般課程用 start_openmaic_classroom 啟動官方工作流程。反覆 get_openmaic_core_step（summary=true），再用 get_openmaic_core_task_context 按 next_offset 分段讀完官方 prompt、tools 與 responseFormat。先在心中規劃、草擬並自行查核來源、公式、答案、schema、教學順序、互動、手機及鍵盤，準備 output（text；需要工具時附 tool_calls；新任務必附 verification：request_sha256、五類 checks 的具體證據及空 remaining_issues），再以獨立審查者角度重新計算與核對初稿，將完整 output 交給 validate_openmaic_core_step；依 errors 修正直到 ok=true，再只傳 task_id、expected_version、validation_receipt 提交，省略 output，避免重傳大量教材。修改初稿後須重新驗證。不要提交內部思考過程，不虛報未執行的測試。所有工具與程式編譯由官方 core 執行。沒有任務時依回傳間隔再讀取，不要捏造完成；遇錯誤依官方回饋修正，直到 status=succeeded，再 publish_openmaic_classroom。中斷可 list_openmaic_classrooms 找回進度。\n` +
    `課程先測決定起點：每章先測 5 到 6 題，涵蓋基礎、核心、難題三個難度，題目 id 用 __d1／__d2／__d3 標示（在 __m_ 之前），難題要考試等級、能區分程度。所有公式、觀念與推理邏輯都先講解、再實作（先測與互動模組除外）：檢核、補強、精簡的題目只能考已講解過的內容，一次只引入一個新東西。每章先講解、再操作、再覆核（檢核：章名）；覆核沒通過進〔補強〕並以全新題目復測，先測（含難題）全對跳過正課改看〔精簡〕（重點回顧＋考試陷阱提醒＋難題練習與解析）。完整規則見 get_openmaic_guide。科學章節用元件庫內建的虛擬器材（sk-lab，不要自己畫 SVG）加紀錄與檢核，不用一堆滑桿；講到要學生動手的句子先用 widget_highlight／spotlight／laser 指出目標；數學章節直接做題。課程最後一個場景「課後：字卡與模考」邀請學生回 App 做字卡複習（對應英文術語），再進行模考。完整規則見 get_module_kit。不懂能展開細分推理、圖解與例子。使用真正的官方場景、白板、教師與同學、可操作模擬與遷移任務；精修動畫、轉場、字體與留白，支援手機、鍵盤與減少動態；先 get_mobile_design_guide，投影片、互動模組與測驗都以手機為先設計（單欄可重排、375×480 一屏、短題幹、小圖片），交付前用 375×667 檢查。互動有重設與實際學習產出，不能以裝飾或 module 堆疊代替教學。保留原生文件、動作與課堂工具，不轉成自製播放器子集。\n` +
    `題目位置（強制）：投影片只講解，不可放任何要學生作答的題目；題目只放「先測：章名」、「檢核：章名」測驗場景或互動模組的 <sk-*> 題型，發布前呼叫 check_openmaic_slides，投影片有題目就無法發布。\n` +
    `舊版 start_course_generation / submit_course_generation_step / publish_course_generation 只供歷史相容資料維護，新課程不可使用這個替代流程。`;

}
