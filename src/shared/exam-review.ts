// After a mock exam is created, the chatbot reviews it once more against the IB documents it read and reports back.
// A review that is not complete must choose to redo the exam (delete and create again) or edit it, then review again.
import { z } from "zod";
import type { ExamAlignment } from "./course-blueprint";

export const EXAM_REVIEW_SCHEMA = "exam-review/v1";
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const examReviewSchema = z.object({
  schema: z.literal(EXAM_REVIEW_SCHEMA),
  documents_checked: z.array(z.object({ title: text(1, 200), book_id: z.string().max(100).optional(), pages: text(1, 100) })).min(1).max(20)
    .describe("這次覆核實際對照的 IB syllabus／guideline／mark scheme、課本或章節教材與頁碼"),
  questions: z.array(z.object({
    id: text(1, 100),
    syllabus_ref: text(1, 80),
    command_term: text(1, 40),
    in_scope: z.boolean().describe("只考該層級（SL/HL）大綱範圍內的內容"),
    command_term_fits: z.boolean().describe("問法、作答長度與配分符合指令詞"),
    marks_match_markscheme: z.boolean().describe("配分點與答案、評分規則符合 mark scheme"),
    answer_correct: z.boolean().describe("重新算過或推過，答案與解析正確"),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    issue: z.string().trim().max(500).optional().describe("任何一項為 false 時寫出問題"),
  })).min(1).max(200),
  syllabus_coverage: z.array(z.object({ syllabus_ref: text(1, 80), question_ids: z.array(text(1, 100)).min(1), evidence: text(15, 600) })).min(1).max(100)
    .describe("試卷宣稱涵蓋的每個大綱編號，以及哪些題目、如何涵蓋"),
  missing_syllabus_refs: z.array(text(1, 80)).max(100).describe("章節範圍內應考卻沒考到的大綱編號；沒有就給空陣列"),
  overall: z.object({ difficulty_curve_ok: z.boolean(), timing_ok: z.boolean(), notes: text(20, 2000) }),
  verdict: z.enum(["pass", "incomplete"]),
  decision: z.enum(["redo", "edit"]).optional().describe("verdict=incomplete 時必填：redo 重新出整份，edit 修改後再覆核"),
  problems: z.array(text(5, 500)).max(100),
});
export type ExamReview = z.infer<typeof examReviewSchema>;
export interface ExamReviewReport { ok: boolean; status: "passed" | "failed"; errors: string[]; warnings: string[]; next_action: string }

/** Checks a review against the exam's real questions and its stored alignment. ok=false means the review itself is not acceptable. */
export function checkExamReview(review: ExamReview, questionIds: string[], alignment?: ExamAlignment | null): ExamReviewReport {
  const errors: string[] = [], warnings: string[] = [];
  const ids = new Set(questionIds), reviewed = new Map(review.questions.map((q) => [q.id, q]));
  for (const id of questionIds) if (!reviewed.has(id)) errors.push(`沒有覆核第 ${id} 題：每一題都要逐項檢查`);
  for (const q of review.questions) if (!ids.has(q.id)) errors.push(`questions 裡的「${q.id}」不是這份試卷的題號`);
  if (reviewed.size !== review.questions.length) errors.push("questions 有重複的題號");
  for (const c of review.syllabus_coverage) for (const id of c.question_ids) if (!ids.has(id)) errors.push(`syllabus_coverage「${c.syllabus_ref}」引用了不存在的題號「${id}」`);
  const covered = new Set(review.syllabus_coverage.map((c) => c.syllabus_ref.toLowerCase()));
  for (const q of review.questions) if (!covered.has(q.syllabus_ref.toLowerCase())) errors.push(`第 ${q.id} 題的大綱編號「${q.syllabus_ref}」沒有列在 syllabus_coverage`);
  if (alignment) for (const row of alignment.questions) {
    const q = reviewed.get(row.question);
    if (q && q.syllabus_ref.toLowerCase() !== row.syllabus_ref.toLowerCase()) warnings.push(`第 ${row.question} 題覆核的大綱編號「${q.syllabus_ref}」和對齊表「${row.syllabus_ref}」不同，請確認哪一個正確`);
    if (q && q.command_term.toLowerCase() !== row.command_term.toLowerCase()) warnings.push(`第 ${row.question} 題覆核的指令詞「${q.command_term}」和對齊表「${row.command_term}」不同`);
  }
  const failing = review.questions.filter((q) => !(q.in_scope && q.command_term_fits && q.marks_match_markscheme && q.answer_correct));
  for (const q of failing) if (!q.issue) errors.push(`第 ${q.id} 題有一項未通過，issue 要寫出問題`);
  const complete = failing.length === 0 && review.missing_syllabus_refs.length === 0 && review.overall.difficulty_curve_ok && review.overall.timing_ok && review.problems.length === 0;
  if (review.verdict === "pass" && !complete) errors.push(`verdict 是 pass，但覆核內容有問題（${[failing.length ? `${failing.length} 題未通過` : "", review.missing_syllabus_refs.length ? `缺 ${review.missing_syllabus_refs.join("、")}` : "", !review.overall.difficulty_curve_ok ? "難度曲線" : "", !review.overall.timing_ok ? "作答時間" : "", review.problems.length ? "problems 不是空的" : ""].filter(Boolean).join("、")}）：改成 incomplete 並選擇 redo 或 edit`);
  if (review.verdict === "incomplete") {
    if (!review.decision) errors.push("verdict 是 incomplete 時要選 decision：redo（重新出整份）或 edit（修改後再覆核）");
    if (complete) errors.push("verdict 是 incomplete，但沒有列出任何問題：寫出 problems 或改成 pass");
  }
  const status = review.verdict === "pass" ? "passed" : "failed";
  const next_action = errors.length ? "覆核內容不完整，修正後重新 submit_exam_review。"
    : status === "passed" ? "IB 對齊覆核通過，向使用者回報覆核摘要與網址。"
    : review.decision === "redo" ? "選擇重做：先告訴使用者問題，delete_document(slug, permanent=true) 刪除這份草稿，再依問題重新出題、validate_exam、create_exam（附 alignment 與 chapter_id），然後再 submit_exam_review。"
    : "選擇編輯：用 update_document 修改題目、set_exam_answers 更新答案、update_exam_alignment 更新對齊表，再重新 submit_exam_review，直到 verdict=pass。";
  return { ok: errors.length === 0, status, errors, warnings, next_action };
}

export const EXAM_REVIEW_GUIDE = `## 模擬試題建立後的 IB 對齊覆核（強制）
create_exam 成功後，試卷標示為「待 AI 對齊覆核」。你必須重新打開讀過的 IB syllabus／guideline／mark scheme（與課本、章節教材），逐題覆核，再呼叫 submit_exam_review（schema "${EXAM_REVIEW_SCHEMA}"）回報：
- questions：每一題（答案 JSON 的每個 id）都要有一列，逐項回答 in_scope、command_term_fits、marks_match_markscheme、answer_correct（重新算過），任何一項 false 都要寫 issue。
- syllabus_coverage：每個大綱編號由哪些題目、如何涵蓋；missing_syllabus_refs 列出章節範圍內應考卻沒考到的編號。
- overall：難度曲線（由易到難）與作答時間是否合理。
- verdict：全部通過才是 pass。不完整時 verdict=incomplete，並在 decision 選 redo（刪掉重出整份）或 edit（修改題目、答案、對齊表後再覆核），problems 寫出所有問題。
覆核沒通過不要回報「完成」；依 next_action 重做或編輯，直到 pass，最後把覆核摘要告訴使用者。`;
