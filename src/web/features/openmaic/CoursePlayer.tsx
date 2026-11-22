import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { gradeCourseQuestion, type OpenMaicCourse, type QuizQuestion } from "../../../shared/openmaic";
import { Markdown } from "../../components/Markdown";
import { Button, Card } from "../../components/ui";
import { GuidedModule } from "./GuidedModule";
import { ContentTransition } from "../../components/ContentTransition";
import { STUDY_MOTION } from "../../../shared/motion";
import { MasteryCoursePlayer } from "./MasteryCoursePlayer";
import { NativeClassroom } from "./NativeClassroom";

export function CoursePlayer({ course, slug }: { course: OpenMaicCourse; slug?: string }) {
  if (course.format === "openmaic-core") return <NativeClassroom slug={slug} title={course.title} version={course.core_version} />;
  if (course.format === "openmaic-scenes" && course.learning_design === "mastery/v1") return <MasteryCoursePlayer course={course} />;
  return <LegacyCoursePlayer course={course} />;
}

function LegacyCoursePlayer({ course }: { course: Exclude<OpenMaicCourse, { format: "openmaic-core" }> }) {
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [direction, setDirection] = useState(1);
  const navId = useId();
  const reduced = useReducedMotion();
  if (!started) return <ContentTransition id="welcome"><div className="space-y-5 py-6"><p className="text-xs tracking-[0.2em] text-slate-500 uppercase">Interactive lesson</p><h2 className="font-display text-3xl font-semibold md:text-4xl">{course.title}</h2><p className="max-w-xl text-sm leading-7 text-slate-500">這份課程使用舊版格式。透過「更新或管理課程」重新生成，即可使用先測分流、逐步教學、不懂詳解與章節檢核。</p><Button variant="primary" onClick={() => setStarted(true)}>開始課程</Button></div></ContentTransition>;
  if (course.format === "openmaic-html") return <ContentTransition id="player"><GuidedModule html={course.html} title={course.title} /></ContentTransition>;
  const scene = course.scenes[index];
  const steps = scene.type === "interactive" ? scene.content.lesson_steps : undefined;
  const completed = !steps || (progress[scene.order] ?? 0) >= steps.length - 1;
  const go = (next: number) => { setDirection(next >= index ? 1 : -1); setIndex(next); };
  return (
    <ContentTransition id="player"><div className="space-y-5">
      <div>
        <h2 className="font-display text-2xl font-semibold">{course.title}</h2>
        {course.description && <p className="mt-2 text-sm text-slate-500">{course.description}</p>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-500">課程學習目標</summary><ul className="mt-2 list-disc space-y-1 pl-5">{course.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></details>
      </div>
      <nav aria-label="課程場景" className="course-scene-nav">
        {course.scenes.length > 8 ? <label className="flex w-full flex-wrap items-center gap-3 text-sm"><span className="text-slate-500">課程單元 {index + 1} / {course.scenes.length}</span><select aria-label="選擇課程單元" className="min-w-0 flex-1 rounded-xl border border-black/10 bg-transparent px-4 py-3 dark:border-white/10" value={index} onChange={(e) => go(Number(e.target.value))}>{course.scenes.map((s, i) => <option key={s.order} value={i}>{i + 1}. {s.title}</option>)}</select></label> : course.scenes.map((s, i) => <motion.button key={s.order} type="button" className="course-scene-tab" aria-current={i === index ? "step" : undefined} onClick={() => go(i)} whileTap={reduced ? undefined : { scale: 0.98 }} transition={reduced ? { duration: 0 } : STUDY_MOTION.spring}>{i === index && <motion.span aria-hidden="true" layoutId={`${navId}-active`} className="course-scene-indicator" transition={reduced ? { duration: 0 } : STUDY_MOTION.spring} />}<span className="relative">{i + 1}. {s.title}</span></motion.button>)}
      </nav>
      <ContentTransition id={scene.order} direction={direction}>
      <section aria-label={scene.title} className="space-y-3">
        <h3 className="text-lg font-semibold">{scene.title}</h3>
        {scene.learningObjective && <p className="text-sm"><strong>學習目標：</strong>{scene.learningObjective}</p>}
        {scene.type === "interactive" ? <GuidedModule key={scene.order} html={scene.content.html} title={scene.title} steps={steps} initialStep={progress[scene.order] ?? 0} onProgress={(step) => setProgress((old) => ({ ...old, [scene.order]: step }))} /> : <CourseQuiz key={scene.order} questions={scene.content.questions} />}
        <AnimatePresence initial={false}>{scene.reflection && completed && <motion.div key="reflection" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.reveal, ease: STUDY_MOTION.ease }}><Card className="p-4"><div className="mb-2 text-sm font-semibold">想一想</div><Markdown md={scene.reflection} /></Card></motion.div>}</AnimatePresence>
      </section>
      </ContentTransition>
      <div className="flex items-center justify-between gap-3">
        <Button disabled={index === 0} onClick={() => go(index - 1)}>上一節</Button>
        <span className="text-sm text-slate-500">{index + 1} / {course.scenes.length}</span>
        <Button disabled={index === course.scenes.length - 1 || !completed} className={completed && steps && index < course.scenes.length - 1 ? "lesson-next-ready" : undefined} onClick={() => go(index + 1)}>下一節</Button>
      </div>
    </div></ContentTransition>
  );
}

function CourseQuiz({ questions }: { questions: QuizQuestion[] }) {
  const reduced = useReducedMotion();
  const [responses, setResponses] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const graded = questions.filter((q) => q.type !== "short_answer");
  const score = graded.reduce((total, q) => total + (gradeCourseQuestion(q, responses[q.id] ?? []) ? q.points : 0), 0);
  const max = graded.reduce((total, q) => total + q.points, 0);
  const complete = questions.every((q) => (responses[q.id] ?? []).some((v) => v.trim()));
  return <div className="space-y-4">
    {questions.map((q, i) => {
      const selected = responses[q.id] ?? [];
      const correct = gradeCourseQuestion(q, selected);
      return <Card key={q.id} className="p-4 md:p-5">
        <fieldset disabled={submitted}>
          <legend className="mb-2 text-sm font-semibold">第 {i + 1} 題 · {q.type === "multiple" ? "複選" : q.type === "single" ? "單選" : "簡答・自我檢核"}</legend>
          <Markdown md={q.question} />
          {q.type === "short_answer" ? <textarea aria-label={`第 ${i + 1} 題答案`} className="mt-3 min-h-28 w-full rounded-xl border border-slate-300 p-3 dark:border-white/20 dark:bg-white/5" value={selected[0] ?? ""} onChange={(e) => setResponses({ ...responses, [q.id]: [e.target.value] })} /> : <div className="mt-3 space-y-2">
            {q.options?.map((o) => <label key={o.value} className="course-answer flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10">
              <input type={q.type === "single" ? "radio" : "checkbox"} name={`course-${q.id}`} className="mt-1" checked={selected.includes(o.value)} onChange={(e) => setResponses({ ...responses, [q.id]: q.type === "single" ? [o.value] : e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value) })} />
              <span className="min-w-0 flex-1"><Markdown md={`${o.value}. ${o.label}`} /></span>
            </label>)}
          </div>}
        </fieldset>
        <AnimatePresence initial={false}>{submitted && <motion.div key="feedback" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.reveal, ease: STUDY_MOTION.ease, delay: reduced ? 0 : Math.min(i * STUDY_MOTION.stagger, STUDY_MOTION.maxStagger) }} className="mt-4 border-t border-slate-200 pt-3 dark:border-white/10">
          <p className="mb-2 font-semibold">{correct === null ? "請比對參考答案（未自動評分）" : correct ? "答對了" : "再想一想"}</p>
          {q.answer && <Markdown md={`參考答案：${q.type === "short_answer" ? q.answer.join("\n\n") : q.answer.map((a) => `${a}. ${q.options?.find((o) => o.value === a)?.label ?? a}`).join("；")}`} />}
          <Markdown md={q.analysis} />
        </motion.div>}</AnimatePresence>
      </Card>;
    })}
    <div className="flex flex-wrap items-center gap-3">
      {submitted ? <Button onClick={() => { setSubmitted(false); setResponses({}); }}>重新練習</Button> : <Button variant="primary" disabled={!complete} onClick={() => setSubmitted(true)}>檢查答案與解析</Button>}
      <span role="status" aria-live="polite" className="text-sm text-slate-500">{submitted ? max ? `選擇題得分 ${score} / ${max}；簡答題請自行檢核。` : "請依參考答案與解析自行檢核。" : "完成所有題目後顯示解析；練習結果不會計入模擬考成績。"}</span>
    </div>
  </div>;
}
