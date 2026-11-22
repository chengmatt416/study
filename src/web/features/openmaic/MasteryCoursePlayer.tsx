import { useId, useMemo, useReducer, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { advanceLearning, initialLearningState, type LearningAction } from "../../../shared/learning-path";
import type { OpenMaicCourse, teachingStepSchema } from "../../../shared/openmaic";
import type { z } from "zod";
import { STUDY_MOTION } from "../../../shared/motion";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui";
import { ContentTransition } from "../../components/ContentTransition";
import { CourseAssessment } from "./CourseAssessment";
import { GuidedModule } from "./GuidedModule";
import { useLessonFocus } from "./useLessonFocus";
import "./lesson.css";

type SceneCourse = Extract<OpenMaicCourse, { format: "openmaic-scenes" }>;
const phases = ["teaching", "interaction", "checkpoint"] as const;
const phaseLabels = { teaching: "逐步教學", interaction: "互動練習", checkpoint: "理解檢核" };

export function MasteryCoursePlayer({ course }: { course: SceneCourse }) {
  const chapters = useMemo(() => course.scenes.filter((scene) => scene.type === "interactive"), [course]);
  const finalQuestions = useMemo(() => course.scenes.flatMap((scene) => scene.type === "quiz" ? scene.content.questions.map((q) => ({ ...q, id: `${scene.order}:${q.id}` })) : []), [course]);
  const [state, dispatch] = useReducer((current: typeof initialLearningState, action: LearningAction) => advanceLearning(current, action, chapters, finalQuestions.length > 0), initialLearningState);
  const [finalPassed, setFinalPassed] = useState(false);
  const [finished, setFinished] = useState(false);
  const reduced = useReducedMotion();
  const railId = useId();
  const focus = useLessonFocus();
  const chapterIndex = state.route[state.chapter];
  const chapter = chapters[chapterIndex];
  const teaching = chapter?.content.teaching_steps ?? [];
  const inChapter = phases.some((phase) => phase === state.phase);
  const pretest = useMemo(() => chapters.flatMap((c, i) => (c.content.pretest ?? []).map((q) => ({ ...q, id: `${i}:${q.id}` }))), [chapters]);
  const phaseIndex = phases.findIndex((phase) => phase === state.phase);
  const transitionId = `${state.phase}-${state.chapter}-${state.cycle}-${finished}`;
  const restart = () => { dispatch({ type: "restart" }); setFinalPassed(false); setFinished(false); };
  const complete = state.phase === "complete" || finished;
  return <div className="mastery-course">
    <header className="course-masthead"><p className="lesson-eyebrow">OpenMAIC Class / {complete ? "Learning complete" : "Learn with understanding"}</p><h2>{course.title}</h2>{state.phase === "welcome" && course.description && <p className="course-intro">{course.description}</p>}</header>
    {inChapter && <div className="course-chapter-heading"><p className="lesson-eyebrow">第 {chapterIndex + 1} 章 <span className="mx-2">/</span> {chapters.length}</p><h3>{chapter?.title}</h3><p>{chapter?.learningObjective}</p>
      <ol className="course-phase-rail" aria-label="本章學習順序">{phases.map((phase, i) => <li key={phase} aria-current={state.phase === phase ? "step" : undefined} data-complete={i < phaseIndex}><span className="course-phase-number">{i < phaseIndex ? "✓" : String(i + 1).padStart(2, "0")}</span><span>{phaseLabels[phase]}</span>{state.phase === phase && <motion.span layoutId={railId} className="course-phase-active" transition={reduced ? { duration: 0 } : STUDY_MOTION.softSpring} />}</li>)}</ol>
    </div>}
    <ContentTransition id={transitionId}>
      {state.phase === "welcome" && <section className="course-welcome"><div className="course-welcome-rule" aria-hidden="true" /><p className="course-welcome-statement">從你已經理解的地方，<br />再往前一步。</p><p className="course-intro">先用幾題找出學習起點。每一章先一步步講解，再親手練習，最後確認理解；遇到不懂的地方，隨時展開更細的說明。</p><ol className="course-journey" aria-label="課程流程">{["先測定位", "逐步教學", "互動練習", "檢核再前進"].map((label, i) => <li key={label}><span>{String(i + 1).padStart(2, "0")}</span>{label}</li>)}</ol><Button variant="primary" onClick={() => dispatch({ type: "start" })}>開始課程 · 先測</Button><p className="course-session-note">本次學習進度保留至離開或重新整理頁面。</p></section>}
      {state.phase === "pretest" && <CourseAssessment questions={pretest} diagnostic onResult={(responses) => dispatch({ type: "diagnose", responses: chapters.map((c, i) => Object.fromEntries((c.content.pretest ?? []).map((q) => [q.id, responses[`${i}:${q.id}`] ?? []]))) })} />}
      {state.phase === "route" && <section className="course-route"><p className="lesson-eyebrow">Your learning path</p><h3 tabIndex={-1} ref={focus} className="outline-none">{state.route.length ? `從「${chapters[state.route[0]].title}」開始` : "先備概念已掌握，進入遷移檢核"}</h3><p className="course-intro">{state.route.length ? "從先測中最早需要釐清的概念開始，依先備關係學習後續章節。每章檢核通過後再前進。" : "本次先測未發現概念缺口。用最後的應用題確認你能將知識用在新情境，也可以選擇完整重學。"}</p><ol className="course-route-list">{chapters.map((c, i) => <li key={c.order} data-skipped={!state.route.includes(i)}><span className="tabular-nums">{String(i + 1).padStart(2, "0")}</span><span>{c.title}</span><span>{state.route.includes(i) ? "教學 → 練習 → 檢核" : "先測已掌握"}</span></li>)}</ol><div className="course-reading-actions"><Button variant="ghost" disabled={state.route.length === chapters.length} onClick={() => dispatch({ type: "all-chapters" })}>我想從頭完整學習</Button><Button variant="primary" onClick={() => dispatch({ type: "begin" })}>{state.route.length ? "開始這條學習路徑" : "進入遷移檢核"}</Button></div></section>}
      {state.phase === "teaching" && teaching[state.teachingStep] && <TeachingStep key={`${chapter?.order}-${state.teachingStep}`} step={teaching[state.teachingStep]} index={state.teachingStep} total={teaching.length} onBack={() => dispatch({ type: "teach-back" })} onNext={() => dispatch({ type: "teach-next" })} />}
      {state.phase === "interaction" && chapter && <section className="space-y-5"><GuidedModule key={`${chapter.order}-${state.cycle}`} html={chapter.content.html} title={chapter.title} steps={chapter.content.lesson_steps} initialStep={state.interactionStep} onProgress={(step) => dispatch({ type: "interact", step })} /><div className="course-reading-actions"><Button variant="ghost" onClick={() => dispatch({ type: "relearn" })}>回到逐步教學</Button><Button variant="primary" disabled={state.interactionStep !== (chapter.content.lesson_steps?.length ?? 0) - 1} onClick={() => dispatch({ type: "check" })}>練習完成，檢核理解</Button></div></section>}
      {state.phase === "checkpoint" && chapter && <section className="space-y-5"><CourseAssessment questions={chapter.content.checkpoint ?? []} onResult={(responses) => dispatch({ type: "assess", responses })} /><div className="course-reading-actions"><Button variant="ghost" onClick={() => dispatch({ type: "relearn" })}>還不懂，重新學這章</Button><Button variant="primary" disabled={!state.checkpointPassed} onClick={() => dispatch({ type: "advance" })}>{state.chapter + 1 < state.route.length ? "理解了，進入下一章" : "完成本章，繼續檢核"}</Button></div></section>}
      {state.phase === "final" && !finished && <section className="space-y-5"><div className="course-section-title"><p className="lesson-eyebrow">Transfer & connect</p><h3 tabIndex={-1} ref={focus} className="outline-none">把理解用在新情境</h3></div><CourseAssessment questions={finalQuestions} onResult={(_, passed) => setFinalPassed(passed)} /><div className="course-reading-actions"><span className="text-sm text-slate-500">通過選擇題與簡答自我檢核後，完成本課。</span><Button variant="primary" disabled={!finalPassed} onClick={() => setFinished(true)}>完成課程</Button></div></section>}
      {complete && <section className="course-finished"><motion.svg aria-hidden="true" width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="currentColor" opacity=".15" /><motion.path d="m17 28 7 7 15-15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : .65, ease: STUDY_MOTION.ease }} /></motion.svg><h3 tabIndex={-1} ref={focus} className="outline-none">每一步，都有理解。</h3><p className="course-intro">你已完成這次學習路徑與檢核。稍後試著不看教材回想核心概念，讓理解留下來。</p><Button onClick={restart}>重新先測與學習</Button></section>}
    </ContentTransition>
  </div>;
}

function TeachingStep({ step, index, total, onBack, onNext }: { step: z.infer<typeof teachingStepSchema>; index: number; total: number; onBack: () => void; onNext: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const explanationId = useId();
  const focus = useLessonFocus();
  const reduced = useReducedMotion();
  return <article className="course-teaching"><div className="course-reading-meta"><span>一次理解一個概念</span><span className="tabular-nums">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span></div><div className="lesson-progress" role="progressbar" aria-label="教學進度" aria-valuenow={index + 1} aria-valuemin={0} aria-valuemax={total}><motion.div initial={false} animate={{ scaleX: (index + 1) / total }} transition={reduced ? { duration: 0 } : STUDY_MOTION.softSpring} /></div><ContentTransition id={step.id}><div className="course-teaching-copy"><h4 tabIndex={-1} ref={focus} className="outline-none">{step.title}</h4><Markdown md={step.body_md} /></div></ContentTransition><button type="button" className="course-explain-toggle" aria-expanded={expanded} aria-controls={explanationId} onClick={() => setExpanded(!expanded)}><span className="course-explain-icon" aria-hidden="true">{expanded ? "−" : "+"}</span>{expanded ? "收起詳細解說" : "不懂，拆開說明"}<span className="course-explain-hint">{expanded ? "回到主線" : "更小的步驟與例子"}</span></button><div id={explanationId} className="course-explanation" data-expanded={expanded} inert={!expanded} aria-hidden={!expanded}><div><div className="course-explanation-copy"><p className="lesson-eyebrow">Let's take it step by step</p><Markdown md={step.explanation_md} /></div></div></div><div className="course-reading-actions"><Button variant="ghost" disabled={index === 0} onClick={onBack}>上一步</Button><Button variant="primary" onClick={onNext}>{index === total - 1 ? "理解了，動手練習" : "理解了，下一步"}</Button></div></article>;
}
