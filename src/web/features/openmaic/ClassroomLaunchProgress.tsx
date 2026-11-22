import { useEffect, useRef, useState } from "react";
import { CLASSROOM_TIPS, tipAt } from "../../../shared/classroom-tips";
import { LAUNCH_STEPS } from "./classroom-launch";

/** What to tell the learner at this many seconds, honestly: the first open after a quiet period is the slow one. */
export function waitMessage(seconds: number): string {
  if (seconds < 5) return "正在準備，完成後就會進入課堂。";
  if (seconds < 25) return "第一次開啟通常需要多一點時間；準備完成後會自動進入。";
  return "還在準備教材，你可以繼續等待，或取消後稍候再試。";
}

export function ClassroomLaunchProgress({ step, elapsed, onBack, onCancel, focusOnMount = false }: { step: number; elapsed: number; onBack?: () => void; onCancel?: () => void; focusOnMount?: boolean }) {
  const progress = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusOnMount) return;
    progress.current?.focus({ preventScroll: true });
    progress.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [focusOnMount]);
  const [tip, setTip] = useState(() => Math.floor(Math.random() * CLASSROOM_TIPS.length));
  useEffect(() => { const timer = setInterval(() => setTip(value => value + 1), 6500); return () => clearInterval(timer); }, []);
  return (
    <div ref={progress} tabIndex={-1} aria-label="正在準備你的課堂" className="hairline mt-6 max-w-xl scroll-mb-28 rounded-3xl bg-white/90 p-5 text-left shadow-[var(--shadow-soft)] backdrop-blur-sm sm:p-6 dark:bg-ink-900/80" aria-busy="true">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-semibold">正在準備你的課堂</h3>
        <span aria-hidden="true" className="text-xs text-slate-500 tabular-nums dark:text-slate-400">已等待 {elapsed} 秒</span>
      </div>
      <ol className="mt-4 space-y-3" aria-label="準備進度">
        {LAUNCH_STEPS.map((label, index) => {
          const state = index < step ? "done" : index === step ? "current" : "todo";
          return (
            <li key={label} className="flex items-start gap-3" aria-current={state === "current" ? "step" : undefined}>
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-300 ${state === "done" ? "bg-aurora text-on-accent shadow-[var(--shadow-glow)]" : state === "current" ? "border-2 border-brand-200 border-t-brand-600 motion-safe:animate-spin dark:border-white/10 dark:border-t-white" : "border border-slate-300/70 dark:border-white/15"}`}>
                {state === "done" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="motion-safe:animate-[sk-pop_320ms_cubic-bezier(.22,1,.36,1)]"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] ${state === "current" ? "font-medium" : state === "done" ? "text-slate-500 dark:text-slate-400" : "text-slate-400 dark:text-slate-500"}`}>{label}{state === "current" ? "…" : ""}</span>
                {state === "current" && <span aria-hidden="true" className="skeleton mt-2 block h-1.5 w-full rounded-full" />}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="mt-4 text-sm text-slate-600 dark:text-slate-300">{waitMessage(elapsed)}</p>
      {onCancel && <button type="button" className="mt-4 inline-flex min-h-11 items-center text-sm underline" onClick={onCancel}>取消開啟，留在這裡</button>}
      {!onCancel && elapsed >= 25 && onBack && <button type="button" className="mt-4 inline-flex min-h-11 items-center text-sm underline" onClick={onBack}>先返回 STUDY</button>}
      <div className="mt-4 rounded-2xl bg-slate-900/5 p-4 dark:bg-white/5" aria-live="off">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">學習小提示</p>
        <p key={tip} className="mt-1 text-sm leading-relaxed motion-safe:animate-[sk-tip_460ms_cubic-bezier(.22,1,.36,1)]">{tipAt(tip)}</p>
      </div>

    </div>
  );
}
