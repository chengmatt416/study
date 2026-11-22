import { validateBlueprint, type CourseBlueprint } from "../../src/shared/course-blueprint";
import { BLUEPRINT_SELF_REVIEW_SCHEMA, CLASSROOM_REVIEW_SCHEMA } from "../../src/shared/generation-review";

type Api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => Promise<T>;
const REF: Record<string, string> = { ebook: "textbook", ib_syllabus: "ib_syllabus", ib_guide: "ib_guide", school_syllabus: "school_syllabus", chapter_material: "chapter_material" };

/** A passing self-review of a blueprint: every chapter checked and covered by every kind of source it cites. */
export function selfReviewFor(input: unknown) {
  const bp = (validateBlueprint(input).value ?? input) as CourseBlueprint;
  const kinds = [...new Set(bp.sources.map((s) => REF[s.kind]).filter(Boolean))];
  if (!kinds.length) kinds.push("textbook");
  return {
    schema: BLUEPRINT_SELF_REVIEW_SCHEMA,
    references: kinds.map((kind) => ({ kind, title: "來源", where: "1-5" })),
    requirements: kinds.flatMap((from) => bp.chapters.map((c) => ({ requirement: `${c.key} 的內容`, from, chapter_keys: [c.key], evidence: "藍圖的目標與新概念涵蓋這一項，深度足夠" }))),
    chapter_checks: bp.chapters.map((c) => ({ chapter_key: c.key, matches_sources: true, order_ok: true, level_ok: true, note: "內容與順序符合課本與大綱" })),
    gaps: [], verdict: "pass",
  };
}

/** Submits a blueprint in yolo mode (approved at once) and starts the classroom from it, as a chatbot would. */
export async function startFromBlueprint<T = Record<string, unknown>>(api: Api, body: { note_slug: string; topic?: string; blueprint: unknown }): Promise<T> {
  const draft = await api<{ draft_id: string }>("POST", "/api/openmaic/blueprints", { note_slug: body.note_slug, topic: body.topic ?? "課程", blueprint: body.blueprint, self_review: selfReviewFor(body.blueprint), mode: "yolo" });
  return api<T>("POST", "/api/openmaic/generations", { note_slug: body.note_slug, blueprint_draft_id: draft.draft_id });
}

/** A passing chapter-by-chapter review of a finished classroom whose scenes follow the blueprint's titles. */
export function classroomReviewFor(input: unknown) {
  const bp = (validateBlueprint(input).value ?? input) as CourseBlueprint;
  return {
    schema: CLASSROOM_REVIEW_SCHEMA,
    chapters: bp.chapters.map((c) => ({
      chapter_key: c.key,
      topics: c.new_concepts.map((concept) => ({ concept: concept.name, explained_in: [c.key], how: "先用定義與圖解講清楚，再一步步帶一個完整例題，最後指出學生最常見的錯誤與原因" })),
      objectives: c.objectives.map((o) => ({ id: o.id, assessed_in: [`檢核：${c.key}`], evidence: "檢核測驗有兩題直接考這個學習目標" })),
      modules: [],
    })),
    rules: { no_questions_on_slides: true, worked_examples_without_learner_computing: true, modules_interactive_only: true, modules_guided_by_dialogue: true, checkpoints_are_quizzes: true },
    summary: "每章先講解新概念與例題，再用檢核測驗確認每個學習目標，完整涵蓋藍圖。",
    gaps: [], verdict: "pass",
  };
}
export const passClassroomReview = (api: Api, generationId: string, blueprint: unknown) =>
  api("POST", `/api/openmaic/generations/${encodeURIComponent(generationId)}/completion-review`, { review: classroomReviewFor(blueprint) });
