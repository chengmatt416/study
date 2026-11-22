// 試題渲染：Markdown（含 LaTeX）先輸出 HTML，再把作答元件以 portal 放進對應位置。
// - :::choices 的 li → 點選作答（加上 selected/correct/wrong 樣式）
// - :blank{#id} → 行內輸入框
// - 其餘題型 → 題目區塊尾端的作答元件
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { Markdown } from "../../components/Markdown";
import { countCompletionWords, wordLimitInstruction, type PublicQuestion, type QuestionResult, type Response } from "../../../shared/exam";
import { MathField } from "./MathField";
import { ExamFeedbackCard, QuestionControl } from "./QuestionControls";
import "./exam-take.css";

export type Responses = Record<string, Response>;

interface Slot {
  key: string;
  el: HTMLElement;
  path: string[]; // [qid] 或 [qid, partId]
  q: PublicQuestion;
  blankId?: string;
}

interface Props {
  md: string;
  questions: PublicQuestion[];
  responses: Responses;
  onChange?: (qid: string, value: Response) => void;
  results?: QuestionResult[];
  selfScores?: Record<string, number>;
  onSelfScore?: (key: string, score: number) => void;
  selfScoreBusy?: boolean;
  mode: "exam" | "exam-review";
}

function getAt(resp: Responses, path: string[]): Response {
  let v: Response = resp[path[0]];
  for (const p of path.slice(1)) v = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Response>)[p] : undefined;
  return v;
}

function resultAt(results: QuestionResult[] | undefined, path: string[]): QuestionResult | undefined {
  let r = results?.find((x) => x.id === path[0]);
  for (const p of path.slice(1)) r = r?.parts?.find((x) => x.id === p);
  return r;
}

function renderInlineBlankPortal(
  q: PublicQuestion,
  blankId: string,
  value: Response,
  readOnly: boolean,
  onChangeValue: (v: Response) => void,
  res?: QuestionResult,
) {
  const map = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const ok = res?.detail?.[blankId];
  const blank = q.blanks?.find((b) => b.id === blankId);
  const kind = blank?.kind;
  if (kind !== "text") {
    return (
      <MathField
        inline
        label={`空格 ${blankId}`}
        value={map[blankId] ?? ""}
        readOnly={readOnly}
        className={res ? (ok ? "is-correct" : "is-wrong") : undefined}
        onChange={(v) => onChangeValue({ ...map, [blankId]: v })}
      />
    );
  }
  const val = map[blankId] ?? "";
  const wLimit = blank?.wordLimit ?? q.wordLimit;
  const numOk = blank?.numbersAllowed ?? q.numbersAllowed ?? false;
  const over = wLimit !== undefined && countCompletionWords(val, numOk) > wLimit;
  return (
    <input
      aria-label={`空格 ${blankId}`}
      aria-invalid={over || undefined}
      className={clsx(
        "mx-1 inline-block h-9 w-32 rounded-lg border px-2 text-center font-mono text-base outline-none focus:ring-2 focus:ring-brand-500/40",
        res
          ? ok
            ? "border-green-600 bg-green-50 dark:bg-green-900/30"
            : "border-red-500 bg-red-50 dark:bg-red-900/30"
          : over
            ? "border-rose-500 bg-rose-50 dark:bg-rose-950/30"
            : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
      )}
      value={val}
      readOnly={readOnly}
      onChange={(e) => onChangeValue({ ...map, [blankId]: e.target.value })}
    />
  );
}

/** 渲染含行內 :blank{#id} 的單一題幹（用於逐題作答介面中的填空／結構填空題）。 */
export function InlineQuestionMarkdown({
  md,
  q,
  value,
  readOnly,
  onChange,
  result,
}: {
  md: string;
  q: PublicQuestion;
  value: Response;
  readOnly: boolean;
  onChange: (v: Response) => void;
  result?: QuestionResult;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [blankEls, setBlankEls] = useState<{ id: string; el: HTMLElement }[]>([]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const found = [...root.querySelectorAll<HTMLElement>("span.blank[data-blank]")].map((el, idx) => ({
      id: el.dataset.blank || `b${idx}`,
      el,
    }));
    setBlankEls(found);
  }, [md]);

  const map = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const textBlanks = (q.blanks ?? []).filter((b) => b.kind === "text");
  const overAny = textBlanks.some((b) => {
    const lim = b.wordLimit ?? q.wordLimit;
    return lim !== undefined && countCompletionWords(map[b.id] ?? "", b.numbersAllowed ?? q.numbersAllowed ?? false) > lim;
  });

  return (
    <div className="space-y-3">
      {q.wordLimit !== undefined && (
        <p className="exam-question-rubric">
          作答字數限制：<strong>{wordLimitInstruction(q.wordLimit, Boolean(q.numbersAllowed))}</strong>
        </p>
      )}
      <div className="prose-md">
        <Markdown ref={ref} md={md} mode="exam" />
      </div>
      {blankEls.map((b, idx) =>
        createPortal(
          renderInlineBlankPortal(q, b.id, value, readOnly, onChange, result),
          b.el,
          `${b.id}-${idx}`,
        ),
      )}
      {!readOnly && overAny && (
        <p className="exam-word-count" data-over="true" aria-live="polite">
          有空格超過作答字數上限，批改將會判定錯誤。
        </p>
      )}
    </div>
  );
}

export function ExamBody({ md, questions, responses, onChange, results, selfScores, onSelfScore, selfScoreBusy, mode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const readOnly = !onChange;

  const setAt = useCallback(
    (path: string[], value: Response) => {
      if (!onChange) return;
      if (path.length === 1) return onChange(path[0], value);
      const top = (responses[path[0]] && typeof responses[path[0]] === "object" ? { ...(responses[path[0]] as Record<string, Response>) } : {}) as Record<string, Response>;
      top[path[1]] = value;
      onChange(path[0], top as Response);
    },
    [onChange, responses],
  );

  // 掃描 DOM 建立 portal 插槽（題目內容改變時重建）
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll("[data-slot]").forEach((n) => n.remove());
    const next: Slot[] = [];
    const byId = new Map(questions.map((q) => [q.id, q]));
    const handle = (scope: HTMLElement, q: PublicQuestion, path: string[]) => {
      if (q.type === "multipart" && q.parts) {
        for (const part of q.parts) {
          const partEl = scope.querySelector<HTMLElement>(`.question-part[data-part="${CSS.escape(part.id)}"]`) ?? scope;
          handle(partEl, part, [...path, part.id]);
        }
        return;
      }
      const isPart = scope.classList.contains("question-part");
      const blanks = [...scope.querySelectorAll<HTMLElement>("span.blank[data-blank]")].filter((b) => (b.closest(".question-part") ?? null) === (isPart ? scope : null));
      const usesInlineBlanks = (q.type === "fill_blank" || q.type === "completion") && blanks.length > 0;
      if (usesInlineBlanks) {
        for (const b of blanks) next.push({ key: path.join(".") + "#" + b.dataset.blank, el: b, path, q, blankId: b.dataset.blank });
      }
      const hasChoices = (q.type === "single_choice" || q.type === "multi_choice") && Boolean(scope.querySelector("li.choice[data-choice]"));
      const needsControl = !usesInlineBlanks && !hasChoices;
      const host = document.createElement("div");
      host.dataset.slot = "1";
      host.className = "mt-3";
      scope.appendChild(host);
      next.push({ key: path.join(".") + (needsControl ? "#ctl" : "#fb"), el: host, path, q, blankId: needsControl ? undefined : "__feedback" });
    };
    root.querySelectorAll<HTMLElement>("section.question[data-question]").forEach((sec, index) => {
      const q = byId.get(sec.dataset.question!);
      if (q) {
        sec.id = `q-${q.id}`;
        sec.setAttribute("aria-label", `第 ${index + 1} 題`);
        handle(sec, q, [q.id]);
      }
    });
    setSlots(next);
  }, [md, questions]);

  // 選擇題：點選 li
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: (() => void)[] = [];
    const bind = (scope: HTMLElement, q: PublicQuestion, path: string[]) => {
      if (q.type === "multipart") {
        q.parts?.forEach((p) => bind(scope.querySelector<HTMLElement>(`.question-part[data-part="${CSS.escape(p.id)}"]`) ?? scope, p, [...path, p.id]));
        return;
      }
      if (q.type !== "single_choice" && q.type !== "multi_choice") return;
      const value = getAt(responses, path);
      const res = resultAt(results, path);
      const expected = res?.expected as string | string[] | undefined;
      const choices = [...scope.querySelectorAll<HTMLElement>("li.choice[data-choice]")];
      const group = scope.querySelector<HTMLElement>(".choices");
      group?.setAttribute("role", q.type === "single_choice" ? "radiogroup" : "group");
      group?.setAttribute("aria-label", `${path.join(".")} 題選項`);
      choices.forEach((li, index) => {
        const label = li.dataset.choice!;
        const selected =
          q.type === "single_choice"
            ? typeof value === "string" && value.toLowerCase() === label.toLowerCase()
            : Array.isArray(value) && value.some((v) => String(v).toLowerCase() === label.toLowerCase());
        li.classList.toggle("selected", selected);
        if (results) {
          const isAns = Array.isArray(expected)
            ? expected.some((e) => e.toLowerCase() === label.toLowerCase())
            : typeof expected === "string" && expected.toLowerCase() === label.toLowerCase();
          li.classList.toggle("correct", isAns);
          li.classList.toggle("wrong", selected && !isAns);
        }
        li.setAttribute("role", q.type === "single_choice" ? "radio" : "checkbox");
        li.setAttribute("aria-checked", String(selected));
        li.setAttribute("aria-disabled", String(readOnly));
        li.tabIndex = readOnly
          ? -1
          : q.type === "single_choice"
            ? selected || (!choices.some((choice) => choice.dataset.choice === value) && index === 0)
              ? 0
              : -1
            : 0;
        li.style.cursor = readOnly ? "default" : "pointer";
        if (readOnly) return;
        const click = () => {
          if (q.type === "single_choice") setAt(path, selected ? null : label);
          else {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            if (selected) setAt(path, arr.filter((x) => x.toLowerCase() !== label.toLowerCase()));
            else if (!q.maxSelections || arr.length < q.maxSelections) setAt(path, [...arr, label].sort());
          }
        };
        const key = (e: KeyboardEvent) => {
          if (q.type === "single_choice" && ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            const at =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? choices.length - 1
                  : (index + (["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1) + choices.length) % choices.length;
            const target = choices[at];
            setAt(path, target.dataset.choice!);
            target.focus();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            click();
          }
        };
        li.addEventListener("click", click);
        li.addEventListener("keydown", key);
        cleanups.push(() => (li.removeEventListener("click", click), li.removeEventListener("keydown", key)));
      });
    };
    const byId = new Map(questions.map((q) => [q.id, q]));
    root.querySelectorAll<HTMLElement>("section.question[data-question]").forEach((sec) => {
      const q = byId.get(sec.dataset.question!);
      if (q) bind(sec, q, [q.id]);
    });
    return () => cleanups.forEach((f) => f());
  }, [slots, responses, results, questions, readOnly, setAt]);

  return (
    <>
      <Markdown ref={ref} md={md} mode={mode} />
      {slots.map((s) => {
        const res = resultAt(results, s.path);
        const value = getAt(responses, s.path);
        let node: ReactNode;
        if (s.blankId && s.blankId !== "__feedback") {
          node = renderInlineBlankPortal(s.q, s.blankId, value, readOnly, (v) => setAt(s.path, v), res);
        } else if (s.blankId === "__feedback") {
          node = res ? (
            <ExamFeedbackCard res={res} q={s.q} keyPath={s.path.join(".")} selfScores={selfScores} onSelfScore={onSelfScore} selfScoreBusy={selfScoreBusy} />
          ) : null;
        } else {
          node = (
            <>
              <QuestionControl q={s.q} value={value} readOnly={readOnly} onChange={(v) => setAt(s.path, v)} result={res} />
              {res && (
                <ExamFeedbackCard res={res} q={s.q} keyPath={s.path.join(".")} selfScores={selfScores} onSelfScore={onSelfScore} selfScoreBusy={selfScoreBusy} />
              )}
            </>
          );
        }
        return createPortal(node, s.el, s.key);
      })}
    </>
  );
}
