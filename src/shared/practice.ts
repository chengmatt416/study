import { z } from "zod";

export const practiceSourceSchema = z.enum(["all", "own"]);
export type PracticeSource = z.infer<typeof practiceSourceSchema>;
export const practiceVisibilitySchema = z.enum(["private", "shared"]);

export interface PracticeLibrary {
  private_count: number;
  shared_count: number;
}

export const PRACTICE_KINDS = ["question", "flashcard", "concept"] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

export const PRACTICE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const PRACTICE_IB_GRADES = [1, 2, 3, 4, 5, 6, 7] as const;
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTIES)[number];
export type PracticeIbGrade = (typeof PRACTICE_IB_GRADES)[number];
export type PracticeLevel = PracticeDifficulty | `ib-${PracticeIbGrade}`;
export const practiceLevelSchema = z.enum([
  ...PRACTICE_DIFFICULTIES, "ib-1", "ib-2", "ib-3", "ib-4", "ib-5", "ib-6", "ib-7",
]);
export const PRACTICE_DIFFICULTY_LABELS: Record<PracticeDifficulty, string> = {
  easy: "簡單", medium: "中等", hard: "困難",
};
export const practiceScaleSchema = z.enum(["general", "ib"]);
export type PracticeScale = z.infer<typeof practiceScaleSchema>;

export type PracticeSubject = {
  id: string;
  name: string;
  color: string | null;
  practice_scale: PracticeScale;
  levels: Partial<Record<PracticeLevel, Partial<Record<PracticeKind, number>>>>;
} & Record<PracticeKind, number>;

const markdown = z.string().trim().min(1).max(6000);
const option = z.string().trim().min(1).max(1000);
const levelFields = {
  difficulty: z.enum(PRACTICE_DIFFICULTIES).optional().describe("For general subjects only. Defaults to medium."),
  ib_grade: z.literal(PRACTICE_IB_GRADES).optional().describe("Required for IB subjects. Omit difficulty when setting this."),
};
const question = {
  kind: z.literal("question"),
  prompt_md: markdown,
  passage_md: markdown.optional(),
  instructions_md: markdown.optional(),
  explanation_md: markdown.optional(),
  ...levelFields,
};
const optionIndex = z.number().int().min(1).max(8).describe("1-based position of a correct option");
export const practiceImportSchema = z.object({
  subject_id: z.string().min(1).max(120),
  visibility: practiceVisibilitySchema.optional(),
  items: z.array(z.union([
    z.object({ kind: z.literal("flashcard"), prompt_md: markdown, answer_md: markdown, ...levelFields }),
    z.object({ kind: z.literal("concept"), prompt_md: markdown, answer_md: markdown, ...levelFields }),
    z.object({ ...question, answer_format: z.literal("choice").optional(), options: z.array(option).min(2).max(8), correct_option: optionIndex }),
    z.object({ ...question, answer_format: z.literal("multiple"), options: z.array(option).min(3).max(8), correct_options: z.array(optionIndex).min(2).max(8) }),
    z.object({ ...question, answer_format: z.literal("text"), accepted_answers: z.array(option).min(1).max(12) }),
    z.object({
      ...question, answer_format: z.literal("numeric"), numeric_answer: z.number(),
      unit: z.string().trim().min(1).max(80).optional(), absolute_tolerance: z.number().nonnegative().optional(),
    }),
  ])).min(1).max(16),
});
export type PracticeImportItem = z.infer<typeof practiceImportSchema>["items"][number];

export function practiceItemLevel(item: PracticeImportItem): PracticeLevel {
  return item.ib_grade ? `ib-${item.ib_grade}` : item.difficulty ?? "medium";
}

export const practiceRefSchema = z.object({
  kind: z.enum(PRACTICE_KINDS),
  source_key: z.string().regex(/^[01]:.+$/).max(240),
  entry: z.string().min(1).max(200),
  version: z.string().min(1).max(300),
});
export type PracticeRef = z.infer<typeof practiceRefSchema>;

export const practiceAnswerSchema = z.union([z.string().max(2000), z.array(z.string().max(100)).max(30)]);
export type PracticeAnswer = z.infer<typeof practiceAnswerSchema>;

export interface PracticeItem extends PracticeRef {
  subject_id: string;
  shared_by_member?: boolean;
  prompt_md: string;
  passage_md?: string;
  instructions?: string;
  unit?: string;
  options?: { id: string; md: string }[];
  multiple?: boolean;
  selection_limit?: number;
}

export interface PracticeFeedback {
  correct: boolean | "partial" | null;
  reference_md?: string;
  explanation_md?: string;
  correct_options?: string[];
}

export interface PracticeCursor {
  key: string;
  offset: number;
}

export interface PracticePage {
  items: PracticeItem[];
  next: PracticeCursor | null;
}
