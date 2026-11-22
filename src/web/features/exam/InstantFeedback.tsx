import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui";
import type { PublicQuestion, QuestionResult } from "../../../shared/exam";
import type { InstantFeedback, InstantMark } from "../../../shared/exam-instant";
import { ExamFeedbackCard } from "./QuestionControls";

export function InstantReviewNotes({ marks, questionId }: { marks: InstantMark[]; questionId: string }) {
  return <div className="rounded-2xl border border-slate-200 p-4 text-sm dark:border-white/15">
    <h3 className="font-semibold">AI 複核建議</h3>
    <p className="mt-1 text-slate-600 dark:text-slate-300">練習成績依原判分計算。</p>
    <ul className="mt-2 space-y-2">
      {marks.map(mark => <li key={mark.id}>
        <p className="font-semibold">{mark.id === questionId ? "" : `(${mark.id.slice(questionId.length + 1)}) `}建議得分 {mark.score} 分</p>
        <Markdown md={mark.comment} />
      </li>)}
    </ul>
  </div>;
}

export function InstantFeedbackPanel({ feedback, question, reviewing, onReview }: {
  feedback: InstantFeedback;
  question: PublicQuestion;
  reviewing: boolean;
  onReview: () => void;
}) {
  function card(q: PublicQuestion, grade: QuestionResult, id: string) {
    if (q.parts?.length) return q.parts.map(part => {
      const result = grade.parts?.find(item => item.id === part.id);
      return result && <div key={part.id}><p className="font-mono text-xs font-semibold">({part.id})</p>{card(part, result, `${id}.${part.id}`)}</div>;
    });
    return <ExamFeedbackCard q={q} res={grade} keyPath={id} />;
  }

  const { result } = feedback;
  const source = feedback.aiGraded.length ? (feedback.reviewable ? "系統與 AI 批改" : "AI 批改") : "系統判分";
  const status = result.correct === true ? "正確" : result.correct === "partial" ? "部分正確" : "錯誤";
  return <section aria-label="即時回饋" className="space-y-3">
    <p role="status" className="text-sm font-semibold">
      <span className={question.parts?.length ? undefined : "sr-only"}>{status} · {result.score} / {result.max} 分 · </span>{source}
    </p>
    {card(question, feedback.result, question.id)}
    {feedback.review
      ? <InstantReviewNotes marks={feedback.review} questionId={question.id} />
      : feedback.reviewable && <Button variant="secondary" size="sm" disabled={reviewing} onClick={onReview}>
          {reviewing ? "AI 複核中…" : "請 AI 複核"}
        </Button>}
  </section>;
}
