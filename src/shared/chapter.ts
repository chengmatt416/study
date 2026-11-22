// Chapters gather one study unit: the 重點整理 (and its OpenMAIC course), mock exams, flashcard decks and uploaded source
// material. Each learner picks how to study a chapter once (onboarding) and can change it later in the chapter settings.
import { z } from "zod";

export const MATERIAL_FORMATS = ["pptx", "docx", "md", "pdf", "html"] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];
/** Original upload size limit. The extracted text is stored next to it. */
export const MAX_MATERIAL_BYTES = 30 * 1024 * 1024;
export const MAX_MATERIAL_TEXT_CHARS = 3_000_000;
/** Characters returned per MCP read; the chatbot pages with next_offset. */
export const MATERIAL_PAGE_CHARS = 24_000;

export const studyModeSchema = z.enum(["summary", "course"]);
export type StudyMode = z.infer<typeof studyModeSchema>;
export const chapterPreferenceSchema = z.object({ study_mode: studyModeSchema, cards_before_exam: z.boolean() });
export type ChapterPreference = z.infer<typeof chapterPreferenceSchema>;

export const chapterVisibilitySchema = z.enum(["shared", "private"]);
export type ChapterVisibility = z.infer<typeof chapterVisibilitySchema>;
export const chapterCreateSchema = z.object({
  subject_id: z.string().min(1).max(100),
  /** private (default): only the creator sees it. shared: everyone who can see the subject. */
  visibility: chapterVisibilitySchema.default("private"),
  title: z.string().trim().min(1).max(120),
  code: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  sort: z.number().int().min(0).max(100_000).optional(),
});
export const chapterPatchSchema = chapterCreateSchema.omit({ subject_id: true, visibility: true }).extend({ visibility: chapterVisibilitySchema }).partial();

export interface ChapterSummary {
  id: string;
  subject_id: string;
  title: string;
  code: string | null;
  description: string | null;
  sort: number;
  visibility: ChapterVisibility;
  /** The current user created it (private chapters are only ever listed to their creator). */
  mine: boolean;
  notes: number;
  exams: number;
  decks: number;
  materials: number;
  has_course: boolean;
  preference: ChapterPreference | null;
  can_edit: boolean;
}
export interface ChapterNote { id: string; slug: string; title: string; has_course: boolean; visibility: string; updated_at: number }
export interface ChapterExam { id: string; slug: string; title: string; visibility: string; updated_at: number; review_status: "pending" | "passed" | null }
export interface ChapterDeck { id: string; title: string; cards: number; due: number; visibility: string; updated_at: number }
export interface ChapterMaterial { id: string; filename: string; format: MaterialFormat; size: number; text_chars: number; sections: number; created_at: number; can_delete: boolean }
export interface ChapterDetail extends ChapterSummary {
  note_list: ChapterNote[];
  exam_list: ChapterExam[];
  deck_list: ChapterDeck[];
  material_list: ChapterMaterial[];
}

export type StudyStepKind = "summary" | "course" | "cards" | "exam";
export interface StudyStep { kind: StudyStepKind; title: string; detail: string; url: string | null; ready: boolean }

/** The learner's path through a chapter, built from their preference and what the chapter actually contains. */
export function studyPlan(chapter: Pick<ChapterDetail, "note_list" | "exam_list" | "deck_list">, preference: ChapterPreference): StudyStep[] {
  const steps: StudyStep[] = [];
  const note = chapter.note_list[0] ?? null;
  const course = chapter.note_list.find((n) => n.has_course) ?? null;
  if (preference.study_mode === "course") {
    steps.push(course
      ? { kind: "course", title: "OpenMAIC 互動式課程", detail: "從頭一步步講解，適合還不熟這章的內容。", url: `/notes/${encodeURIComponent(course.slug)}?view=course`, ready: true }
      : { kind: "course", title: "OpenMAIC 互動式課程", detail: note ? "這章還沒有互動課程，可先讀重點整理，或請 AI 依重點整理生成課程。" : "這章還沒有重點整理與互動課程。", url: note ? `/notes/${encodeURIComponent(note.slug)}` : null, ready: false });
  } else {
    steps.push({ kind: "summary", title: "文字版重點整理", detail: "快速回顧重點，考前自我檢核用。", url: note ? `/notes/${encodeURIComponent(note.slug)}` : null, ready: !!note });
  }
  if (preference.cards_before_exam) {
    const deck = chapter.deck_list[0] ?? null;
    steps.push({ kind: "cards", title: "字卡複習", detail: deck ? `先複習${chapter.deck_list.length > 1 ? ` ${chapter.deck_list.length} 組` : ""}重要詞彙，再進模擬考。` : "這章還沒有字卡組。", url: deck ? `/decks/${encodeURIComponent(deck.id)}` : null, ready: !!deck });
  }
  const exam = chapter.exam_list.find((e) => e.review_status !== "pending") ?? null;
  steps.push({ kind: "exam", title: "模擬試題", detail: exam ? "用考試等級的題目檢核這章。" : chapter.exam_list.length ? "試題正在等 AI 完成 IB 對齊覆核。" : "這章還沒有模擬試題。", url: exam ? `/exams/${encodeURIComponent(exam.slug)}` : null, ready: !!exam });
  return steps;
}

export function materialFormat(filename: string): MaterialFormat | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "markdown") return "md";
  if (ext === "htm") return "html";
  return (MATERIAL_FORMATS as readonly string[]).includes(ext ?? "") ? ext as MaterialFormat : null;
}

/** One page of a material's text for a chatbot, never cutting a surrogate pair. */
export function materialPage(text: string, offset: number, limit = MATERIAL_PAGE_CHARS) {
  const start = Math.max(0, Math.min(offset, text.length));
  let end = Math.min(text.length, start + Math.max(1, Math.min(limit, MATERIAL_PAGE_CHARS)));
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
  return { offset: start, text: text.slice(start, end), next_offset: end < text.length ? end : null, total_chars: text.length };
}
