import { z } from "zod";

const line = (max: number) => z.string().trim().min(1).max(max);
export const WRITING_MAX_LENGTH = 12_000;
export const writingLanguageSchema = z.enum(["en", "zh"]);
export const writingPromptSchema = z.object({
  title: line(150),
  language: writingLanguageSchema.describe("en 英文，zh 中文"),
  prompt: line(4000).describe("直接給學生看的題目，可含文體、受眾、寫作情境與建議篇幅"),
  markscheme: z.array(z.object({
    name: line(100),
    max: z.number().int().min(1).max(100),
    description: line(1600).describe("依分數或級距說明給分條件"),
  })).min(1).max(8).describe("作答前固定的評分規準，順序即 criterion 編號"),
});
export const writingDraftSchema = z.object({
  text: z.string().max(WRITING_MAX_LENGTH).refine((value) => value.trim().length > 0, "請先寫下作答內容"),
});

export const writingFeedbackSchema = z.object({
  summary: line(2000),
  scores: z.array(z.object({
    criterion: z.number().int().min(1).max(8).describe("markscheme 裡的項目編號，從 1 開始，每個恰好評一次"),
    points: z.number().int().nonnegative(),
    comment: line(1200),
  })).min(1).max(8),
  corrections: z.array(z.object({
    quote: z.string().min(1).max(400).refine((value) => value.trim().length > 0).describe("逐字引用初稿的短片段，空白及標點必須相同，引用彼此不得重疊"),
    occurrence: z.number().int().min(1).optional().describe("同一片段重複時必填，以全文中第幾次出現為準（從 1 開始）"),
    kind: z.enum(["vocabulary", "grammar", "style"]),
    replacement: z.string().trim().max(400).describe("建議的修正文字，空字串代表刪除"),
    explanation: line(1000),
  })).max(40).describe("圈出實際可改善的片段。若沒有則傳空陣列"),
});

export const WRITING_STATUSES = ["draft", "awaiting_feedback", "revision", "complete"] as const;
export type WritingStatus = (typeof WRITING_STATUSES)[number];
export type WritingLanguage = z.infer<typeof writingLanguageSchema>;
export type WritingPrompt = z.infer<typeof writingPromptSchema>;
export type WritingFeedbackInput = z.infer<typeof writingFeedbackSchema>;
export type WritingCorrection = WritingFeedbackInput["corrections"][number] & { start: number; end: number };
export type WritingFeedback = Omit<WritingFeedbackInput, "corrections"> & { corrections: WritingCorrection[]; total: number; max: number };

export interface WritingSummary {
  id: string;
  title: string;
  language: WritingLanguage;
  status: WritingStatus;
  created_at: number;
}

export interface WritingPractice extends WritingSummary {
  prompt: string;
  draft: string | null;
  feedback: WritingFeedback | null;
  markscheme: WritingPrompt["markscheme"] | null;
  final_draft: string | null;
}

export function resolveWritingFeedback(
  draft: string,
  markscheme: WritingPrompt["markscheme"],
  input: WritingFeedbackInput,
): { feedback: WritingFeedback } | { errors: string[] } {
  const errors: string[] = [];
  const scores = [...input.scores].sort((a, b) => a.criterion - b.criterion);
  if (scores.length !== markscheme.length || scores.some((score, i) => score.criterion !== i + 1)) {
    errors.push("評分必須涵蓋 markscheme 的每一項，且每項恰好一次。");
  }
  for (const { criterion, points } of scores) {
    const row = markscheme[criterion - 1];
    if (!row || points > row.max) errors.push(`第 ${criterion} 項的分數超出 markscheme 配分。`);
  }

  const corrections = input.corrections.flatMap((correction, i) => {
    const { quote, occurrence } = correction;
    let start = draft.indexOf(quote);
    for (let seen = 1; start !== -1 && seen < (occurrence ?? 1); seen++) {
      start = draft.indexOf(quote, start + 1);
    }
    if (start === -1 || (occurrence === undefined && draft.indexOf(quote, start + 1) !== -1)) {
      errors.push(`第 ${i + 1} 則批註無法唯一定位。請逐字引用初稿，若片段重複則提供 occurrence。`);
      return [];
    }
    return [{ ...correction, start, end: start + quote.length }];
  }).sort((a, b) => a.start - b.start);

  if (corrections.some((correction, i) => i > 0 && correction.start < corrections[i - 1].end)) {
    errors.push("批註圈選範圍不可重疊，請合併修正或縮短引用。");
  }
  if (errors.length) return { errors };
  return {
    feedback: {
      summary: input.summary, scores, corrections,
      total: scores.reduce((total, score) => total + score.points, 0),
      max: markscheme.reduce((total, row) => total + row.max, 0),
    },
  };
}
