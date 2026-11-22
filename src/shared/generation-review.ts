// Two self-reviews a chatbot submits while it builds a course:
// 1. Before its blueprint is shown to the learner: a detailed check against the textbook, the syllabus and any outline the
//    user asked for. A failed check is not stored; the chatbot fixes the blueprint until the check passes.
// 2. After the classroom is generated: chapter by chapter, which scenes explain every topic and assess every objective, and
//    that the classroom follows the slide / module / quiz rules. Publishing needs a passing review.
import { z } from "zod";
import { parseTitle } from "./course-map";
import type { CourseBlueprint } from "./course-blueprint";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const BLUEPRINT_SELF_REVIEW_SCHEMA = "blueprint-self-review/v1";
export const REFERENCE_KINDS = ["textbook", "ib_syllabus", "ib_guide", "school_syllabus", "chapter_material", "user_outline"] as const;
export const blueprintSelfReviewSchema = z.object({
  schema: z.literal(BLUEPRINT_SELF_REVIEW_SCHEMA),
  user_outline: z.string().trim().max(6000).optional().describe("使用者要求的課綱或大綱原文；使用者有給時必填"),
  references: z.array(z.object({ kind: z.enum(REFERENCE_KINDS), title: text(1, 200), where: text(1, 200).describe("對照的頁碼、章節或段落") })).min(1).max(20),
  requirements: z.array(z.object({
    requirement: text(3, 400).describe("課本／大綱／使用者課綱中要求教到的一項內容（盡量用原文或大綱編號）"),
    from: z.enum(REFERENCE_KINDS),
    chapter_keys: z.array(text(1, 60)).describe("涵蓋這項的藍圖章節 key；沒有涵蓋給空陣列並列入 gaps"),
    evidence: text(10, 600).describe("藍圖哪個目標／新概念教到它，深度是否足夠"),
  })).min(1).max(200),
  chapter_checks: z.array(z.object({
    chapter_key: text(1, 60),
    matches_sources: z.boolean().describe("內容、術語與深度符合課本與大綱"),
    order_ok: z.boolean().describe("排序與先備關係符合課本與使用者課綱"),
    level_ok: z.boolean().describe("沒有超出或低於 SL／HL 範圍"),
    note: text(6, 600),
  })).min(1).max(20),
  gaps: z.array(text(3, 400)).max(100).describe("藍圖缺少、多出或與來源不符之處；通過時為空陣列"),
  verdict: z.enum(["pass", "fail"]),
});
export type BlueprintSelfReview = z.infer<typeof blueprintSelfReviewSchema>;

/** Errors mean the self-review is not acceptable yet; the chatbot must fix the blueprint (or the review) and resubmit. */
export function checkBlueprintSelfReview(review: BlueprintSelfReview, blueprint: CourseBlueprint): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const keys = new Set(blueprint.chapters.map((c) => c.key));
  const checked = new Map(review.chapter_checks.map((c) => [c.chapter_key, c]));
  for (const key of keys) if (!checked.has(key)) errors.push(`chapter_checks 沒有檢查章節「${key}」`);
  for (const check of review.chapter_checks) {
    if (!keys.has(check.chapter_key)) errors.push(`chapter_checks 的「${check.chapter_key}」不是藍圖章節`);
    else if (!(check.matches_sources && check.order_ok && check.level_ok)) errors.push(`章節「${check.chapter_key}」自我審查未通過（${[!check.matches_sources && "內容不符來源", !check.order_ok && "順序不符", !check.level_ok && "層級不符"].filter(Boolean).join("、")}）：${check.note}`);
  }
  for (const r of review.requirements) {
    for (const key of r.chapter_keys) if (!keys.has(key)) errors.push(`requirements「${r.requirement.slice(0, 30)}」指向不存在的章節「${key}」`);
    if (!r.chapter_keys.length) errors.push(`「${r.requirement.slice(0, 60)}」（${r.from}）沒有任何章節涵蓋：補進藍圖`);
  }
  for (const key of keys) if (!review.requirements.some((r) => r.chapter_keys.includes(key))) warnings.push(`章節「${key}」沒有對應到任何來源要求，確認它是否超出範圍`);
  if (review.user_outline && !review.requirements.some((r) => r.from === "user_outline")) errors.push("有 user_outline，但 requirements 沒有逐項對照使用者課綱（from: \"user_outline\"）");
  if (review.user_outline && !review.references.some((r) => r.kind === "user_outline")) errors.push("references 要列出使用者課綱");
  const cited = new Set(blueprint.sources.map((s) => s.kind));
  const pairs: [string, (typeof REFERENCE_KINDS)[number]][] = [["ebook", "textbook"], ["ib_syllabus", "ib_syllabus"], ["school_syllabus", "school_syllabus"], ["chapter_material", "chapter_material"]];
  for (const [source, ref] of pairs) if (cited.has(source as never) && !review.requirements.some((r) => r.from === ref)) errors.push(`藍圖引用了 ${source}，但自我審查沒有逐項對照它（requirements.from: "${ref}"）`);
  if (review.gaps.length) errors.push(`自我審查列出 ${review.gaps.length} 個缺口：${review.gaps.slice(0, 5).join("；")}。修改藍圖直到沒有缺口`);
  if (review.verdict !== "pass") errors.push("verdict 不是 pass：修改藍圖，直到自我審查完全符合課本、大綱與使用者課綱");
  return { errors, warnings };
}

export const CLASSROOM_REVIEW_SCHEMA = "classroom-review/v1";
export const classroomReviewSchema = z.object({
  schema: z.literal(CLASSROOM_REVIEW_SCHEMA),
  chapters: z.array(z.object({
    chapter_key: text(1, 60),
    topics: z.array(z.object({
      concept: text(1, 100).describe("藍圖 new_concepts 的 name"),
      explained_in: z.array(text(1, 200)).min(1).describe("講解它的投影片場景標題"),
      how: text(30, 1000).describe("怎麼講：定義、推導、圖解、逐步例題，以及學生最可能卡住的地方如何處理"),
    })).min(1),
    objectives: z.array(z.object({ id: text(1, 40), assessed_in: z.array(text(1, 200)).min(1).describe("考到這個目標的 quiz 場景標題（先測／檢核）"), evidence: text(15, 600) })).min(1),
    modules: z.array(z.object({ scene_title: text(1, 200), interaction: text(20, 600).describe("學生實際做什麼操作"), guided_by_dialogue: z.boolean() })),
  })).min(1).max(20),
  rules: z.object({
    no_questions_on_slides: z.boolean(),
    worked_examples_without_learner_computing: z.boolean(),
    modules_interactive_only: z.boolean(),
    modules_guided_by_dialogue: z.boolean(),
    checkpoints_are_quizzes: z.boolean(),
  }),
  summary: text(30, 3000).describe("給使用者看的整體說明：課程如何完整契合課綱"),
  gaps: z.array(text(3, 400)).max(100),
  verdict: z.enum(["pass", "fail"]),
});
export type ClassroomReview = z.infer<typeof classroomReviewSchema>;
interface SceneInfo { title?: string; type?: string }

export function checkClassroomReview(review: ClassroomReview, blueprint: CourseBlueprint, scenes: readonly SceneInfo[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const titles = new Map(scenes.map((s) => [(s.title ?? "").trim(), s]));
  const reviewed = new Map(review.chapters.map((c) => [c.chapter_key, c]));
  for (const chapter of blueprint.chapters) {
    const r = reviewed.get(chapter.key);
    if (!r) { errors.push(`沒有說明章節「${chapter.key}」`); continue; }
    const concepts = new Set(r.topics.map((t) => t.concept.trim().toLowerCase()));
    for (const concept of chapter.new_concepts) if (!concepts.has(concept.name.trim().toLowerCase())) errors.push(`章節「${chapter.key}」沒有說明新概念「${concept.name}」在哪裡、怎麼講解`);
    const objectives = new Set(r.objectives.map((o) => o.id));
    for (const objective of chapter.objectives) if (!objectives.has(objective.id)) errors.push(`章節「${chapter.key}」沒有說明目標 ${objective.id}（${objective.text.slice(0, 30)}）在哪個測驗考到`);
    for (const topic of r.topics) for (const title of topic.explained_in) {
      const scene = titles.get(title.trim());
      if (!scene) errors.push(`「${topic.concept}」的講解場景「${title}」不存在`);
      else if (scene.type === "quiz") errors.push(`「${topic.concept}」寫在測驗「${title}」講解：講解要在投影片`);
    }
    for (const objective of r.objectives) for (const title of objective.assessed_in) {
      const scene = titles.get(title.trim());
      if (!scene) errors.push(`目標 ${objective.id} 的測驗場景「${title}」不存在`);
      else if (scene.type !== "quiz" && scene.type !== "interactive") errors.push(`目標 ${objective.id} 寫在「${title}」考，但那是投影片：檢核要用 quiz`);
    }
    for (const m of r.modules) {
      const scene = titles.get(m.scene_title.trim());
      if (!scene) errors.push(`互動模組「${m.scene_title}」不存在`);
      else if (scene.type !== "interactive") errors.push(`「${m.scene_title}」不是互動模組`);
      if (!m.guided_by_dialogue) errors.push(`互動模組「${m.scene_title}」沒有用對話導覽操作`);
    }
    const ownModules = scenes.filter((s) => s.type === "interactive" && parseTitle(s.title ?? "").key === chapter.key).map((s) => (s.title ?? "").trim());
    for (const title of ownModules) if (!r.modules.some((m) => m.scene_title.trim() === title)) warnings.push(`互動模組「${title}」沒有在 modules 說明學生做什麼`);
  }
  for (const key of reviewed.keys()) if (!blueprint.chapters.some((c) => c.key === key)) errors.push(`「${key}」不是藍圖章節`);
  for (const [rule, ok] of Object.entries(review.rules)) if (!ok) errors.push(`規則 ${rule} 未遵守：修正場景後再覆核`);
  if (review.gaps.length) errors.push(`覆核列出 ${review.gaps.length} 個缺口：${review.gaps.slice(0, 5).join("；")}。用 update_openmaic_scene 修正後再覆核`);
  if (review.verdict !== "pass") errors.push("verdict 不是 pass：課程還沒完整契合課綱，修正後再覆核");
  return { errors, warnings };
}

export const GENERATION_REVIEW_GUIDE = `## 藍圖審核與 yolo 模式（強制）
1. 寫好 blueprint 後，先詳細自我審查（schema "${BLUEPRINT_SELF_REVIEW_SCHEMA}"）：逐項列出課本、IB／學校大綱、章節教材，以及使用者要求的課綱（user_outline，使用者有給時原文照抄）的每一項要求，說明哪個章節涵蓋、深度是否足夠；每章檢查內容、順序與 SL／HL 層級。有任何缺口就先修改藍圖，直到 verdict=pass 且 gaps 為空。
2. submit_course_blueprint（附 blueprint、self_review、chapter_id）。伺服器會重做藍圖檢查與自我審查檢查，不符合就退回，修改後重送。
3. mode="review"（預設）：藍圖會在 App「AI 生成 → 互動課程」視覺化給使用者審核。請使用者去 App 查看，之後用 get_course_blueprint_review 讀取結果：approved 才能 start_openmaic_classroom（傳 blueprint_draft_id）；changes_requested 依 feedback 修改藍圖，再 submit_course_blueprint（replaces_draft_id 帶上一版）。也可以在對話中依使用者要求修改後重送。
4. mode="yolo"：只有使用者明確說「yolo」或「不用問我、直接做完」時使用。藍圖不等使用者審核，自我審查通過就直接核准，接著一路生成到發布，中途不再詢問使用者。

## 課程完成後的覆核（強制，發布前）
官方 core 完成後：check_openmaic_slides、check_openmaic_modules、check_openmaic_alignment 都通過，再 submit_classroom_review（schema "${CLASSROOM_REVIEW_SCHEMA}"）：逐章說明每個新概念在哪些投影片、怎麼講解（定義、推導、逐步例題），每個學習目標在哪個先測／檢核測驗考到，每個互動模組讓學生做什麼、是否由對話導覽；並確認規則：投影片不放題目也不要學生自己算、模組只用於互動且有對話導覽、課間檢核用 quiz。有缺口就 update_openmaic_scene 修正後再覆核，verdict=pass 才能 publish_openmaic_classroom。發布後把 summary 告訴使用者。`;
