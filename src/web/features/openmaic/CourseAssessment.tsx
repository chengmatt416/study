import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { gradeCourseQuestion, type QuizQuestion } from "../../../shared/openmaic";
import type { Responses } from "../../../shared/learning-path";
import { STUDY_MOTION } from "../../../shared/motion";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui";
import { ContentTransition } from "../../components/ContentTransition";
import { useLessonFocus } from "./useLessonFocus";

export function CourseAssessment({ questions, diagnostic = false, onResult }: { questions: QuizQuestion[]; diagnostic?: boolean; onResult: (responses: Responses, passed: boolean) => void }) {
  const [responses, setResponses] = useState<Responses>({});
  const [index, setIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [unsure, setUnsure] = useState<string[]>([]);
  const focus = useLessonFocus();
  const reduced = useReducedMotion();
  const group = useId();
  const q = questions[index];
  if (!q) return <p role="alert">課程缺少檢核題目，請更新課程。</p>;
  const selected = responses[q.id] ?? [];
  const answered = unsure.includes(q.id) || selected.some((value) => value.trim());
  const allAnswered = questions.every((question) => unsure.includes(question.id) || (responses[question.id] ?? []).some((value) => value.trim()));
  const correct = gradeCourseQuestion(q, selected);
  const hasShort = questions.some((question) => question.type === "short_answer");
  const passes = (selfReviewed: string[]) => questions.every((question) => gradeCourseQuestion(question, responses[question.id] ?? []) === true || question.type === "short_answer" && selfReviewed.includes(question.id));
  const submit = () => { setSubmitted(true); onResult(responses, passes(reviewed)); };
  return <div className="course-assessment">
    <div className="course-reading-meta"><span>{diagnostic ? "先測 · 找到適合你的起點" : "提取練習 · 用自己的理解作答"}</span><span className="tabular-nums">{String(index + 1).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}</span></div>
    <ContentTransition id={q.id}>
      <fieldset disabled={submitted} className="course-question">
        <legend className="lesson-eyebrow">{q.type === "multiple" ? "複選題" : q.type === "single" ? "單選題" : "簡答 · 依規準自行檢核"}</legend>
        <div className="course-question-prompt outline-none" tabIndex={-1} ref={focus}><Markdown md={q.question} /></div>
        {q.type === "short_answer" ? <textarea aria-label="你的答案" className="course-short-answer" value={selected[0] ?? ""} onChange={(e) => setResponses({ ...responses, [q.id]: [e.target.value] })} /> : <div className="space-y-3">{q.options?.map((option) => <label key={option.value} className="course-option">
          <input type={q.type === "single" ? "radio" : "checkbox"} name={`${group}-${q.id}`} checked={selected.includes(option.value)} onChange={(e) => { setUnsure(unsure.filter((id) => id !== q.id)); setResponses({ ...responses, [q.id]: q.type === "single" ? [option.value] : e.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value) }); }} />
          <span className="course-option-key" aria-hidden="true">{option.value}</span><span className="min-w-0"><Markdown md={option.label} /></span>
        </label>)}</div>}
        {diagnostic && <button type="button" className="course-text-button mt-4" aria-pressed={unsure.includes(q.id)} onClick={() => { setUnsure([...unsure.filter((id) => id !== q.id), q.id]); setResponses({ ...responses, [q.id]: [] }); }}>還不會，從這裡學起{unsure.includes(q.id) ? " ✓" : ""}</button>}
      </fieldset>
    </ContentTransition>
    <AnimatePresence initial={false}>{submitted && <motion.section key={q.id} aria-label="作答回饋" className="course-feedback" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.reveal, ease: STUDY_MOTION.ease }}>
      <p className="mb-3 font-semibold">{correct === null ? "比對推理與檢核規準" : correct ? "已掌握這個概念" : diagnostic ? "這會是接下來的學習重點" : "先釐清這個概念，再試一次"}</p>
      <Markdown md={q.analysis} />
      {q.answer && <div className="mt-3 text-sm"><Markdown md={`參考答案：${q.type === "short_answer" ? q.answer.join("\n\n") : q.answer.map((value) => q.options?.find((option) => option.value === value)?.label ?? value).join("；")}`} /></div>}
      {q.type === "short_answer" && <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={reviewed.includes(q.id)} onChange={(e) => { const next = e.target.checked ? [...reviewed, q.id] : reviewed.filter((id) => id !== q.id); setReviewed(next); onResult(responses, passes(next)); }} /><span>我已逐項比對參考答案與解析，確認推理符合規準（自行檢核，未自動評分）。</span></label>}
    </motion.section>}</AnimatePresence>
    <div className="course-reading-actions">
      <Button variant="ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一題</Button>
      {index < questions.length - 1 ? <Button disabled={!answered && !submitted} onClick={() => setIndex(index + 1)}>下一題</Button> : !submitted ? <Button variant="primary" disabled={!allAnswered} onClick={submit}>{diagnostic ? "完成先測，安排學習路徑" : "檢查理解"}</Button> : <Button onClick={() => { setSubmitted(false); setReviewed([]); setIndex(0); onResult({}, false); }}>重新作答</Button>}
    </div>
    {submitted && <p role="status" className="course-assessment-status">{diagnostic ? "先測完成，學習路徑已依概念缺口安排。" : passes(reviewed) ? "檢核已通過，可以繼續。" : hasShort ? "選擇題須全對；簡答須逐項比對規準後確認。" : "尚有概念需要釐清。可回看各題解析，或重新學習本章。"}</p>}
  </div>;
}
