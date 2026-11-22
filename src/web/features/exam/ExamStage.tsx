import { useCallback, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { BookOpenText, ListBullets } from "@phosphor-icons/react";
import "./exam-take.css";

const SPLIT_KEY = "dyshibdp-exam-split";
const SPLIT_MIN = 30;
const SPLIT_MAX = 70;
const SPLIT_DEFAULT = 48;

export type ExamPane = "passage" | "question";

export function useExamPane(stage: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<ExamPane>("question");
  const current = useRef<ExamPane>("question");
  const scroll = useRef({ passage: 0, question: 0 });
  const reset = useCallback(() => {
    current.current = "question";
    setView("question");
  }, []);
  const show = useCallback((next: ExamPane) => {
    if (current.current === next) return;
    const element = stage.current;
    if (element) scroll.current[current.current] = element.scrollTop;
    current.current = next;
    setView(next);
    requestAnimationFrame(() => {
      if (element && current.current === next) element.scrollTop = scroll.current[next];
    });
  }, [stage]);
  return { view, show, reset };
}

export function ExamPaneToggle({
  view, onChange, label = "切換材料或題目", passageLabel = "材料", answerLabel = "題目",
}: {
  view: ExamPane;
  onChange: (view: ExamPane) => void;
  label?: string;
  passageLabel?: string;
  answerLabel?: string;
}) {
  return <fieldset className="exam-view-toggle">
    <legend className="sr-only">{label}</legend>
    <button type="button" aria-pressed={view === "passage"} onClick={() => onChange("passage")}>
      <BookOpenText size={16} />{passageLabel}
    </button>
    <button type="button" aria-pressed={view === "question"} onClick={() => onChange("question")}>
      <ListBullets size={16} />{answerLabel}
    </button>
  </fieldset>;
}

export function ExamStage({ passage, children, stageRef }: {
  passage?: ReactNode;
  children: ReactNode;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const { split, save, preview } = useExamSplit(SPLIT_KEY, SPLIT_DEFAULT);
  return <div ref={stageRef} className="exam-stage min-w-0 flex-1"
    style={passage ? ({ "--split": `${split}%` } as CSSProperties) : undefined}>
    {passage}
    {passage && <ExamSplitHandle container={stageRef} split={split} save={save} preview={preview} initial={SPLIT_DEFAULT}
      label="調整材料與作答欄寬度" />}
    {children}
  </div>;
}

const clamp = (ratio: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(ratio)));

export function useExamSplit(storageKey: string, initial: number) {
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved >= SPLIT_MIN && saved <= SPLIT_MAX) return saved;
    } catch { /* The separator still works without storage. */ }
    return initial;
  });
  function preview(ratio: number) { setSplit(clamp(ratio)); }
  function save(ratio: number) {
    const value = clamp(ratio);
    setSplit(value);
    try { localStorage.setItem(storageKey, String(value)); } catch { /* Keep the in-memory width. */ }
  }
  return { split, save, preview };
}

export function ExamSplitHandle({ container, split, save, preview, initial, label, className = "" }: {
  container: RefObject<HTMLDivElement | null>;
  split: number;
  save: (ratio: number) => void;
  preview: (ratio: number) => void;
  initial: number;
  label: string;
  className?: string;
}) {
  const drag = useRef<{ id: number; x: number; width: number; split: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  function dragRatio(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    return active?.id === event.pointerId ? active.split + ((event.clientX - active.x) / active.width) * 100 : null;
  }
  function stopDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  return <div className={`exam-splitter ${className}`} data-dragging={dragging || undefined} role="separator" tabIndex={0} aria-label={label}
      aria-orientation="vertical" aria-valuemin={SPLIT_MIN} aria-valuemax={SPLIT_MAX} aria-valuenow={split}
      onDoubleClick={() => save(initial)}
      onKeyDown={(event) => {
        const targets: Record<string, number | undefined> = {
          ArrowLeft: split - 5, ArrowRight: split + 5, Home: SPLIT_MIN, End: SPLIT_MAX, Enter: initial,
        };
        const target = targets[event.key];
        if (target === undefined) return;
        event.preventDefault();
        save(target);
      }}
      onPointerDown={(event) => {
        const bounds = container.current?.getBoundingClientRect();
        if (!bounds?.width || drag.current || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width: bounds.width, split };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const ratio = dragRatio(event);
        if (ratio !== null) preview(ratio);
      }}
      onPointerUp={(event) => {
        const ratio = dragRatio(event);
        if (ratio !== null) save(ratio);
        stopDrag(event);
      }}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag} />;
}
