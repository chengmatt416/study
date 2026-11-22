import type { QuestionResult } from "./exam";

export type ExamMode = "exam" | "instant";

export interface InstantMark {
  id: string;
  score: number;
  comment: string;
}

export interface InstantFeedback {
  result: QuestionResult;
  aiGraded: string[];
  reviewable: boolean;
  review?: InstantMark[];
}

export function examTakePath(slug: string, mode: ExamMode = "exam", attempt?: string) {
  const search = new URLSearchParams();
  if (mode === "instant") search.set("mode", mode);
  if (attempt) search.set("attempt", attempt);
  return `/exams/${encodeURIComponent(slug)}/take${search.size ? `?${search}` : ""}`;
}
