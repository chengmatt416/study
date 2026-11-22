import type { ReactNode } from "react";
import type { WritingCorrection, WritingLanguage, WritingPractice } from "../../../shared/writing-practice";

export function AnnotatedDraft({ draft, corrections, language, onCorrection }: {
  draft: string; corrections: WritingCorrection[]; language: WritingLanguage; onCorrection?: (id: string) => void;
}) {
  const parts: ReactNode[] = [];
  let from = 0;
  corrections.forEach(({ start, end }, index) => {
    const quote = draft.slice(start, end);
    const noteId = `writing-correction-${index + 1}`;
    parts.push(draft.slice(from, start), onCorrection
      ? <a key={start} className="writing-circle" href={`#${noteId}`}
        aria-label={`${quote}，批註 ${index + 1}`}
        onClick={(event) => {
          event.preventDefault();
          onCorrection(noteId);
        }}>{quote}</a>
      : <mark key={start} className="writing-circle">{quote}</mark>);
    from = end;
  });
  parts.push(draft.slice(from));
  return <p className="writing-hand writing-quote" lang={language}>{parts}</p>;
}

const REVIEW_GROUPS = [
  { kind: "vocabulary", title: "單字與用詞" },
  { kind: "grammar", title: "文法" },
  { kind: "style", title: "其他修改" },
] as const;

export function CorrectionReview({ corrections, compact = false }: { corrections: WritingCorrection[]; compact?: boolean }) {
  return <div className="writing-corrections">
    {REVIEW_GROUPS.map(({ kind, title }) => {
      const notes = corrections.map((correction, i) => ({ ...correction, number: i + 1 })).filter((note) => note.kind === kind);
      if (!notes.length && (compact || kind === "style")) return null;
      return <section key={kind}>
        <h3>{title}</h3>
        {notes.length ? <ol>
          {notes.map(({ number, quote, replacement, explanation }) => <li key={number} id={compact ? undefined : `writing-correction-${number}`} tabIndex={compact ? undefined : -1}>
            <p className="writing-correction-edit"><span>{quote}</span><span aria-hidden="true">→</span><strong>{replacement || "刪除"}</strong></p>
            <p>{explanation}</p>
          </li>)}
        </ol> : <p className="writing-muted">這次沒有這類批註。</p>}
      </section>;
    })}
  </div>;
}

export function WritingFeedbackView({ practice }: { practice: WritingPractice }) {
  const { feedback, markscheme } = practice;
  if (!feedback || !markscheme) return null;
  return <>
    <div className="writing-score">
      <div aria-label={`初稿總分 ${feedback.total} 分，滿分 ${feedback.max} 分`}><strong>{feedback.total}</strong><span> / {feedback.max}</span></div>
      <p>{feedback.summary}</p>
    </div>
    <details className="writing-details">
      <summary>各項評分與 markscheme</summary>
      <ul className="writing-criteria">
        {feedback.scores.map(({ criterion, points, comment }) => {
          const row = markscheme[criterion - 1];
          return <li key={criterion}>
            <h3>{row.name} <span>{points} / {row.max}</span></h3>
            <p>{comment}</p>
            <p className="writing-muted">{row.description}</p>
          </li>;
        })}
      </ul>
    </details>
    <section>
      <h3>錯誤複習</h3>
      <CorrectionReview corrections={feedback.corrections} />
    </section>
  </>;
}
