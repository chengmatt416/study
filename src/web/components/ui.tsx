// STUDY 設計系統：Aurora Ink（靛紫漸層、玻璃質感、彈簧動畫）
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { AnimatePresence, animate, motion, useDragControls, useInView, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Tray, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "../lib/api";
import type { Subject } from "../lib/types";
import { useDevice } from "../lib/device";
import { STUDY_MOTION } from "../../shared/motion";

export const spring = STUDY_MOTION.spring;
export const softSpring = STUDY_MOTION.softSpring;

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <motion.button
      whileTap={props.disabled ? undefined : { scale: 0.97 }}
      whileHover={props.disabled ? undefined : { y: -1 }}
      transition={spring}
      className={clsx(
        "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl font-medium whitespace-nowrap select-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-white dark:focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        variant === "primary" && "bg-aurora text-on-accent shadow-[var(--shadow-glow)] before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/15 before:to-transparent before:content-['']",
        variant === "secondary" && "hairline bg-white/80 text-slate-800 shadow-[var(--shadow-soft)] backdrop-blur hover:bg-white hover:text-slate-900 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10",
        variant === "ghost" && "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white",
        variant === "danger" && "bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-[0_8px_24px_-8px_rgb(225_29_72/.6)]",
        className,
      )}
      {...(props as HTMLMotionProps<"button">)}
    >
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </motion.button>
  );
}

export function IconButton({ label, children, active, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      transition={spring}
      aria-label={label}
      title={label}
      className={clsx(
        "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 dark:text-slate-300 dark:focus-visible:ring-white dark:focus-visible:ring-offset-ink-950",
        active ? "bg-brand-600 text-white shadow-[var(--shadow-glow)] dark:text-white" : "hover:bg-slate-900/5 hover:text-slate-900 dark:hover:bg-white/10 dark:hover:text-white",
        className,
      )}
      {...(props as HTMLMotionProps<"button">)}
    >
      {children}
    </motion.button>
  );
}

export function Card({ className, children, interactive, ...rest }: { className?: string; children: ReactNode; interactive?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "hairline rounded-3xl bg-white/90 shadow-[var(--shadow-soft)] backdrop-blur-sm dark:bg-ink-900/80",
        interactive && "transition duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[var(--shadow-lift)] active:translate-y-0 active:scale-[0.99] dark:hover:border-white/20",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** 進場動畫：與課程內容相同的淡入與小幅上移，不模糊閱讀中的文字。 */
export function Reveal({ children, delay = 0, className, y = 14 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { duration: STUDY_MOTION.reveal, ease: STUDY_MOTION.ease, delay }}>
      {children}
    </motion.div>
  );
}

/** 子元素依序進場 */
export function Stagger({ children, className, gap = 0.045 }: { children: ReactNode; className?: string; gap?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : "hidden"} animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : Math.min(gap, STUDY_MOTION.stagger) } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: STUDY_MOTION.travel }, show: { opacity: 1, y: 0, transition: reduce ? { duration: 0 } : { duration: STUDY_MOTION.reveal, ease: STUDY_MOTION.ease } } }}>
      {children}
    </motion.div>
  );
}

/** 數字滾動 */
export function CountUp({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const ctl = animate(0, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => ref.current && (ref.current.textContent = v.toFixed(decimals)) });
    return () => ctl.stop();
  }, [value, inView, decimals]);
  return (
    <span ref={ref} className={clsx("tabular-nums", className)}>
      0
    </span>
  );
}

/** 進度環 */
export function Ring({ value, size = 64, stroke = 6, children, className }: { value: number; size?: number; stroke?: number; children?: ReactNode; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={clsx("relative grid place-items-center", className ?? "text-ink-900 dark:text-white")} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <motion.div
      className={clsx("h-6 w-6 rounded-full border-2 border-brand-200 border-t-brand-600 dark:border-white/10 dark:border-t-brand-400", className)}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
      role="status"
      aria-label="載入中"
    />
  );
}

/** 載入骨架 */
export function Loading({ label, rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-4 py-8" aria-busy="true" aria-label={label ?? "載入中"}>
      <div className="skeleton h-8 w-1/3 rounded-xl" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-20 rounded-3xl" style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
      {label && <div className="pt-2 text-center text-sm text-slate-500">{label}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <Reveal className="m-4">
      <div className="flex gap-3 rounded-3xl border border-rose-200 bg-rose-50/80 p-4 text-sm whitespace-pre-wrap text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
        <WarningCircle size={22} weight="duotone" className="shrink-0" />
        {(error as Error)?.message ?? String(error)}
      </div>
    </Reveal>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Reveal className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="relative">
        <div className="absolute -inset-1 rounded-full bg-slate-400/10 ring-1 ring-slate-900/5 dark:bg-white/5 dark:ring-white/10" />
        <div className="relative grid h-20 w-20 animate-[float_6s_ease-in-out_infinite] place-items-center rounded-full bg-ink-100 text-ink-900 shadow-[var(--shadow-soft)] dark:bg-white/10 dark:text-white">
          {icon ?? <Tray size={36} weight="duotone" />}
        </div>
      </div>
      <div className="font-display text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</div>
      {children && <div className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</div>}
    </Reveal>
  );
}

export function Badge({ children, color = "slate", className }: { children: ReactNode; color?: "slate" | "brand" | "yellow" | "red" | "green" | "blue"; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide tabular-nums ring-1 ring-inset",
        color === "slate" && "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
        color === "brand" && "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:ring-brand-700/50",
        color === "yellow" && "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
        color === "red" && "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/30",
        color === "green" && "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
        color === "blue" && "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30",
        className,
      )}
    >
      {children}
    </span>
  );
}

const modalStack: HTMLElement[] = [];
const modalInert = new Map<HTMLElement, { count: number; previous: boolean }>();
let modalOverflow = "";
const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** 手機：可下拉關閉的底部抽屜；平板/桌機：彈簧縮放對話框或右側面板 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  side = "auto",
  wide,
  animation,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  side?: "auto" | "right" | "bottom";
  wide?: boolean;
  animation?: "reduced" | "none";
}) {
  const device = useDevice();
  const ref = useRef<HTMLDivElement>(null);
  const openingFocus = useRef<HTMLElement | null>(null);
  const opened = useRef(false);
  if (open && !opened.current) openingFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  opened.current = open;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const titleId = useId();
  const dragControls = useDragControls();
  const mode = side === "auto" ? (device === "phone" ? "bottom" : "center") : side;
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || !panel) return;
    const trigger = openingFocus.current;
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(panel) && !element.hasAttribute("data-modal-announcement") && !['SCRIPT', 'STYLE'].includes(element.tagName));
    if (!modalStack.length) modalOverflow = document.body.style.overflow;
    modalStack.push(panel);
    siblings.forEach(element => {
      const entry = modalInert.get(element) ?? { count: 0, previous: element.inert };
      entry.count++; modalInert.set(element, entry); element.inert = true;
    });
    document.body.style.overflow = "hidden";
    const isTop = () => modalStack.at(-1) === panel;
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => element.getClientRects().length && !element.closest('[inert], [hidden]'));
      const first = items[0], last = items.at(-1), current = document.activeElement;
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (current === first || current === panel || !panel.contains(current))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (current === last || current === panel || !panel.contains(current))) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (isTop() && !panel.contains(event.target as Node)) panel.focus(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    panel.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      const wasTop = isTop();
      modalStack.splice(modalStack.indexOf(panel), 1);
      siblings.forEach(element => {
        const entry = modalInert.get(element);
        if (entry && --entry.count === 0) { element.inert = entry.previous; modalInert.delete(element); }
      });
      if (!modalStack.length) document.body.style.overflow = modalOverflow;
      if (wasTop && trigger) queueMicrotask(() => {
        const top = modalStack.at(-1);
        if (trigger.isConnected && !trigger.closest('[inert]') && (!top || top.contains(trigger))) trigger.focus();
      });
    };
  }, [open]);

  const panel = animation === "none"
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : animation === "reduced"
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : mode === "bottom"
      ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%" } }
      : mode === "right"
        ? { initial: { x: "100%" }, animate: { x: 0 }, exit: { x: "100%" } }
        : { initial: { opacity: 0, scale: 0.94, y: 16 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: 8 } };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={clsx("fixed inset-0 z-50 flex", mode === "center" && "items-center justify-center p-6")} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : "對話框"}>
          <motion.div data-sheet-backdrop="" className="absolute inset-0 bg-ink-950/40 backdrop-blur-[3px]" initial={animation === "none" ? false : { opacity: 0 }}
            animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={animation ? { duration: animation === "none" ? 0 : 0.13 } : undefined} onClick={onClose} />
          <motion.div
            ref={ref}
            tabIndex={-1}
            {...panel}
            transition={animation ? { duration: animation === "none" ? 0 : 0.13 } : mode === "center" ? spring : { type: "spring", stiffness: 380, damping: 38 }}
            drag={mode === "bottom" ? "y" : false}
            // 只能從上方把手/標題列拖曳關閉；內容區（計算機、PDF）的觸控事件完全不攔截
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
            className={clsx(
              "relative flex flex-col bg-white shadow-2xl outline-none dark:bg-ink-900",
              mode === "bottom" && "safe-bottom mt-auto max-h-[92%] w-full rounded-t-[28px]",
              mode === "right" && "ml-auto h-full w-full max-w-md",
              mode === "center" && clsx("hairline max-h-[85vh] w-full rounded-[28px]", wide ? "max-w-4xl" : "max-w-lg"),
            )}
          >
            {mode === "bottom" && (
              <div className="flex shrink-0 cursor-grab justify-center pt-2.5 pb-1 [touch-action:none]" onPointerDown={(e) => dragControls.start(e)}>
                <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
              </div>
            )}
            <div className={clsx("flex items-center gap-2 px-5 pt-3 pb-3", mode === "bottom" && "[touch-action:none]")} onPointerDown={(e) => mode === "bottom" && !(e.target as Element).closest("button") && dragControls.start(e)}>
              <div id={titleId} className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{title}</div>
              <IconButton label="關閉" onClick={onClose}>
                <X size={18} weight="bold" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 分段切換：選取指示器以共享版面動畫滑動 */
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; className?: string }) {
  const id = useId();
  return (
    <div className={clsx("no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-slate-900/5 p-1 dark:bg-white/5", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx("relative shrink-0 rounded-xl px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-white", value === it.value ? "text-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400")}
        >
          {value === it.value && <motion.span layoutId={`tab-${id}`} className="absolute inset-0 rounded-xl bg-white shadow-[var(--shadow-soft)] dark:bg-white/15" transition={spring} />}
          <span className="relative inline-flex items-center gap-1.5">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="min-w-0 flex-[1_1_16rem]">
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-[0.18em] text-brand-600 uppercase dark:text-brand-300">{eyebrow}</div>}
        <h1 className="truncate font-display text-[28px] leading-tight font-semibold md:text-[34px]">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </Reveal>
  );
}

export function useSubjects() {
  return useQuery({ queryKey: ["subjects"], queryFn: () => api.get<{ subjects: Subject[] }>("/api/subjects").then((r) => r.subjects), staleTime: 10 * 60_000 });
}

export function SubjectDot({ subjectId }: { subjectId: string | null }) {
  const { data } = useSubjects();
  const s = data?.find((x) => x.id === subjectId);
  if (!s) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className="h-2 w-2 rounded-full ring-2 ring-white dark:ring-ink-900" style={{ background: s.color ?? "#64748b" }} />
      {s.name}
    </span>
  );
}

export function SubjectSelect({ value, onChange, allowAll }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const { data } = useSubjects();
  return (
    <select className={clsx(fieldCls, "w-auto max-w-full min-w-0 pr-8")} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? "全部科目" : "（未分類）"}</option>
      {data?.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/** 欄位基礎樣式（不含寬度）；需要固定寬度時用 fieldCls + "w-…"，避免與 w-full 衝突 */
export const fieldCls =
  "h-10 rounded-2xl border border-slate-200 bg-white/90 px-3.5 text-sm shadow-[var(--shadow-soft)] outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-white/5";
export const inputCls = `${fieldCls} w-full`;
export const textareaCls =
  "w-full rounded-2xl border border-slate-200 bg-white/90 p-3.5 font-mono text-sm shadow-[var(--shadow-soft)] outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-white/5";

let toastHost: ((msg: string, kind?: "ok" | "err") => void) | null = null;
export const toast = (msg: string, kind: "ok" | "err" = "ok") => toastHost?.(msg, kind);

export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: "ok" | "err" }[]>([]);
  useEffect(() => {
    toastHost = (msg, kind = "ok") => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, kind }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "err" ? 6000 : 3000);
    };
    return () => {
      toastHost = null;
    };
  }, []);
  return createPortal(
    <div data-modal-announcement className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            role={t.kind === "err" ? "alert" : "status"}
            aria-atomic="true"
            layout
            initial={{ opacity: 0, y: 24, scale: 0.9, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={spring}
            className={clsx(
              "pointer-events-auto flex max-w-md items-start gap-2.5 rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap shadow-2xl backdrop-blur-xl",
              t.kind === "ok" ? "bg-ink-900/90 text-white dark:bg-white/90 dark:text-ink-900" : "bg-rose-600/95 text-white",
            )}
          >
            {t.kind === "ok" ? <CheckCircle size={20} weight="fill" className="shrink-0 text-emerald-400 dark:text-emerald-600" /> : <WarningCircle size={20} weight="fill" className="shrink-0" />}
            {t.msg}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>, document.body,
  );
}

/**
 * 常駐底部面板（手機）：第一次開啟後保持掛載，關閉只是滑出畫面。
 * 用於計算機、資料手冊：關閉再打開不會遺失計算內容，也不必重新載入 GeoGebra。
 */
export function BottomPanel({ open, onClose, title, children, height = "86dvh" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; height?: string }) {
  const [mounted, setMounted] = useState(open);
  const dragControls = useDragControls();
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted) return null;
  return createPortal(
    <>
      <AnimatePresence>{open && <motion.div key="bp-backdrop" className="fixed inset-0 z-40 bg-ink-950/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />}</AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        initial={{ y: "100%" }}
        animate={{ y: open ? 0 : "105%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
        className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[28px] bg-white shadow-2xl dark:bg-ink-900"
        style={{ height, pointerEvents: open ? "auto" : "none", visibility: open ? "visible" : undefined }}
      >
        <div className="shrink-0 [touch-action:none]" onPointerDown={(e) => !(e.target as Element).closest("button") && dragControls.start(e)}>
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-1.5 w-10 rounded-full bg-slate-300 dark:bg-white/20" />
          </div>
          <div className="flex items-center gap-2 px-5 pb-2">
            <div className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{title}</div>
            <IconButton label="關閉" onClick={onClose}>
              <X size={18} weight="bold" />
            </IconButton>
          </div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </motion.div>
    </>,
    document.body,
  );
}
