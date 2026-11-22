import { z } from "zod";
import { analyzeExamMarkdown, gradeQuestion, questionPoints, stripSolutions, toPublic, type QuestionSpec, type Response } from "../../shared/exam";
import { parseExamPaper } from "../../shared/exam-paper";
import { hasExamResponse } from "../../shared/exam-progress";
import type { InstantFeedback, InstantMark } from "../../shared/exam-instant";
import { readOpenAnswer } from "../../shared/ink";
import { examGrading, liveAiError } from "./live-ai/service";
import { bad } from "./util";

export type InstantCheckRow = {
  question_id: string;
  response_json: string;
  feedback_json: string;
};

export async function instantChecks(env: Env, attemptId: string) {
  const { results } = await env.DB.prepare(
    "SELECT question_id, response_json, feedback_json FROM exam_instant_checks WHERE attempt_id = ? AND feedback_json IS NOT NULL",
  ).bind(attemptId).all<InstantCheckRow>();
  return results;
}

export function checkedResponses(responses: Record<string, Response>, checks: InstantCheckRow[]) {
  return { ...responses, ...Object.fromEntries(checks.map(row => [row.question_id, JSON.parse(row.response_json) as Response])) };
}

function leaves(q: QuestionSpec, response: Response, id = q.id): { id: string; spec: QuestionSpec; answer: Response }[] {
  if (q.type !== "multipart") return [{ id, spec: q, answer: response }];
  const fields = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, Response> : {};
  return q.parts.flatMap(part => leaves(part, Object.hasOwn(fields, part.id) ? fields[part.id] : undefined, `${id}.${part.id}`));
}

function gradeable({ spec, answer }: ReturnType<typeof leaves>[number]) {
  if (spec.type !== "open") return hasExamResponse(answer);
  const open = readOpenAnswer(answer);
  if (open.mode === "ink") bad("即時批改需要文字作答，請切換為打字", 422);
  return !!open.text?.trim();
}

const marksSchema = z.strictObject({
  marks: z.array(z.strictObject({ id: z.string(), score: z.number(), comment: z.string() })),
});
const { $schema: _schema, ...markFormat } = z.toJSONSchema(marksSchema);

async function markWithAi(
  env: Env, userId: string, attemptId: string, q: QuestionSpec, markdown: string,
  targets: ReturnType<typeof leaves>, review: boolean, signal: AbortSignal,
): Promise<InstantMark[]> {
  const md = stripSolutions(markdown);
  const structure = analyzeExamMarkdown(md);
  const paper = parseExamPaper(md, [toPublic(q, attemptId, structure.choices)]);
  const view = paper.questions[0];
  const data = await examGrading(env, userId, attemptId, {
    task: review ? "獨立複核系統計分，說明與判分規則是否一致。" : "依據題意、參考答案和評分規準給分。",
    question: view?.fullQuestionMd,
    passage: view?.passageId ? paper.passagesById[view.passageId]?.rawMd : undefined,
    answers: targets.map(({ id, spec, answer }) => ({
      id, max: questionPoints(spec), answer_key: spec,
      student_answer: spec.type === "open" ? readOpenAnswer(answer).text : answer,
      ...(review ? { system_score: gradeQuestion(spec, answer).score } : {}),
    })),
  }, markFormat, signal);
  const parsed = marksSchema.safeParse(data);
  if (!parsed.success || parsed.data.marks.length !== targets.length) liveAiError("AI 沒有回傳完整的批改，請重試", 502, "invalid_grade");
  const marks = parsed.data.marks;
  return targets.map(({ id, spec }) => {
    const mark = marks.find(item => item.id === id);
    const max = questionPoints(spec);
    if (!mark || mark.score < 0 || mark.score > max || !mark.comment.trim()) {
      liveAiError("AI 回傳的評分不符配分或題號，請重試", 502, "invalid_grade");
    }
    return { id, score: Math.min(max, Number(mark.score.toFixed(2))), comment: mark.comment.trim().slice(0, 2000) };
  });
}

export async function instantFeedback(
  env: Env, userId: string, attemptId: string, q: QuestionSpec, markdown: () => Promise<string>, response: Response,
  signal: AbortSignal, previous?: InstantFeedback,
): Promise<InstantFeedback> {
  const answered = leaves(q, response).filter(item => (!previous || item.spec.type !== "open") && gradeable(item));
  const objective = answered.filter(item => item.spec.type !== "open");
  if (previous) {
    if (!objective.length) bad("這題已使用 AI 批改", 409);
    const review = await markWithAi(env, userId, attemptId, q, await markdown(), objective, true, signal);
    return { ...previous, review };
  }

  if (!answered.length) bad("請先作答再檢查", 422);
  const open = answered.filter(item => item.spec.type === "open");
  const marks = open.length ? await markWithAi(env, userId, attemptId, q, await markdown(), open, false, signal) : [];
  const result = gradeQuestion(q, response);
  const apply = (grade: typeof result, id: string) => {
    if (grade.parts) {
      grade.parts.forEach(part => apply(part, `${id}.${part.id}`));
      grade.score = Math.min(grade.max, Number(grade.parts.reduce((sum, part) => sum + part.score, 0).toFixed(2)));
    } else if (grade.correct === null) {
      const mark = marks.find(item => item.id === id);
      grade.score = mark?.score ?? 0;
      grade.comment = mark?.comment;
    } else return;
    grade.correct = grade.score >= grade.max ? true : grade.score > 0 ? "partial" : false;
  };
  apply(result, q.id);
  return { result, aiGraded: marks.map(mark => mark.id), reviewable: objective.length > 0 };
}
