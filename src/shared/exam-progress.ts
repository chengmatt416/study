import type { PublicQuestion } from "./exam";
import { decodeInk, inkStrokeCount } from "./ink";

export function hasExamResponse(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (obj.type === "ABSENCE") return true;
    if (obj.type === "SPAN") return typeof obj.quote === "string" && obj.quote.trim().length > 0;
    return Object.entries(obj).some(([key, item]) =>
      key === "ink" ? typeof item === "string" && inkStrokeCount(decodeInk(item)) > 0 : key !== "mode" && hasExamResponse(item),
    );
  }
  return true;
}

/** A question is complete only when each required part or blank has a response. */
export function examQuestionAnswered(question: PublicQuestion, value: unknown): boolean {
  const fields = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  if (question.type === "multipart" && question.parts?.length) return question.parts.every((part) => examQuestionAnswered(part, fields[part.id]));
  if ((question.type === "fill_blank" || question.type === "completion") && question.blanks?.length) {
    return question.blanks.every((blank) => hasExamResponse(fields[blank.id]));
  }
  if (question.type === "matching" && question.lefts?.length) return question.lefts.every((left) => hasExamResponse(fields[left]));
  if (question.type === "multi_choice" && question.maxSelections && question.maxSelections > 0) {
    return Array.isArray(value) && value.length >= question.maxSelections;
  }
  return hasExamResponse(value);
}
