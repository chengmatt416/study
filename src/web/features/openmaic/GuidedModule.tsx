import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { acceptsLessonProgress, lessonFlowPrelude, type LessonStep } from "../../../shared/lesson-flow";
import { sandboxCourseHtml } from "../../../shared/openmaic";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui";
import { STUDY_MOTION } from "../../../shared/motion";
import "./lesson.css";

const NO_STEPS: LessonStep[] = [];

export function GuidedModule({ html, title, steps = NO_STEPS, initialStep = 0, onProgress }: { html: string; title: string; steps?: LessonStep[]; initialStep?: number; onProgress?: (index: number) => void }) {
  const [step, setStep] = useState(Math.max(0, Math.min(initialStep, steps.length - 1)));
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const instructionId = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(step);
  const notify = useRef(onProgress);
  const reduced = useReducedMotion();
  const channel = useMemo(() => crypto.randomUUID(), [html, run]);
  const source = useMemo(() => sandboxCourseHtml((steps.length ? lessonFlowPrelude(steps, channel) : "") + html), [steps, channel, html]);
  useEffect(() => { notify.current = onProgress; }, [onProgress]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !acceptsLessonProgress(event.data, channel, steps, current.current)) return;
      current.current = event.data.index;
      setStep(current.current);
      notify.current?.(current.current);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [channel, steps]);
  const blocks = (position: "above" | "beside" | "below") => steps.slice(0, step + 1).flatMap((s, si) => s.blocks.map((block, i) => block.position === position ? <motion.article key={`${run}-${s.id}-${i}`} initial={reduced ? false : { opacity: 0, y: STUDY_MOTION.travel }} animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : { duration: STUDY_MOTION.reveal, ease: STUDY_MOTION.ease, delay: si === step ? Math.min(0.08 + i * STUDY_MOTION.stagger, STUDY_MOTION.maxStagger) : 0 }} className={`lesson-block font-${block.font} size-${block.size} tone-${block.tone} align-${block.align}`}><Markdown md={block.markdown} /></motion.article> : null));
  // Reserve the side rail from the start, so unlocking material never resizes the simulation.
  const aside = steps.some((s) => s.blocks.some((b) => b.position === "beside"));
  const hasVisibleBlocks = (position: "above" | "below") => steps.slice(0, step + 1).some((s) => s.blocks.some((b) => b.position === position));
  const complete = steps.length > 0 && step === steps.length - 1;
  const instruction = steps[step] && <div id={instructionId} className="lesson-instruction" role="status" aria-live="polite" aria-atomic="true">
    <AnimatePresence mode="wait" initial={false}><motion.div key={steps[step].id} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: reduced ? 0 : 0.08, ease: STUDY_MOTION.exitEase } }} transition={{ duration: reduced ? 0 : STUDY_MOTION.instruction, ease: STUDY_MOTION.ease }}>
      <p className="lesson-eyebrow">{complete ? "Reflect & connect" : "Your next move"}</p><h4 className="mb-3 mt-2 text-lg font-semibold">{steps[step].title}</h4><Markdown md={steps[step].instruction_md} />
    </motion.div></AnimatePresence>
  </div>;
  return <div className="guided-lesson space-y-5">
    <div className="lesson-toolbar">
      <div className="min-w-0 flex-1">{steps.length > 0 && <><div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span className="tabular-nums">STEP {String(step + 1).padStart(2, "0")} <span className="mx-1 opacity-50">/</span> {String(steps.length).padStart(2, "0")}</span><span>{complete ? "練習完成" : "依操作逐步展開"}</span></div><div role="progressbar" aria-label="目前互動進度" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step + 1} className="lesson-progress"><motion.div initial={false} animate={{ scaleX: (step + 1) / steps.length }} transition={reduced ? { duration: 0 } : STUDY_MOTION.softSpring} /></div></>}</div>
      <Button size="sm" variant="ghost" onClick={() => { current.current = 0; setStep(0); setLoaded(false); notify.current?.(0); setRun(run + 1); }}>重新開始練習</Button>
    </div>
    {!aside && instruction}
    {hasVisibleBlocks("above") && <div className="space-y-5">{blocks("above")}</div>}
    <div className={aside ? "lesson-regions has-side-rail" : "lesson-regions"}>
      <div className="lesson-stage" aria-busy={!loaded}>
        <motion.iframe key={channel} ref={frame} title={title} aria-describedby={steps.length ? instructionId : undefined} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={() => { frame.current?.contentWindow?.postMessage({ type: "study:lesson-sync", channel, index: current.current }, "*"); setLoaded(true); }} srcDoc={source} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: loaded ? 1 : 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.scene, ease: STUDY_MOTION.ease }} style={{ pointerEvents: loaded ? "auto" : "none" }} className="lesson-frame" />
        <AnimatePresence initial={false}>{!loaded && <motion.div key="loading" role="status" className="lesson-loading" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.feedback }}><span className="lesson-loading-orbit" aria-hidden="true" /><span>正在準備互動空間…</span></motion.div>}</AnimatePresence>
      </div>
      {aside && <aside className="lesson-side-rail" aria-label="逐步課程說明">{instruction}{blocks("beside")}</aside>}
    </div>
    {hasVisibleBlocks("below") && <div className="space-y-5">{blocks("below")}</div>}
    <AnimatePresence initial={false}>{complete && <motion.div key="complete" className="lesson-completion" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.reveal, ease: STUDY_MOTION.ease }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><motion.path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.reveal }} /></svg><span>已完成本章互動步驟，可回顧觀察結果，再檢核理解。</span></motion.div>}</AnimatePresence>
  </div>;
}
