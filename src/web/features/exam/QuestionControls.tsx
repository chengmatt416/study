import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import { motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpenText,
  CheckCircle,
  CircleHalf,
  PencilLine,
  Trash,
  XCircle,
} from "@phosphor-icons/react";
import {
  countCompletionWords,
  GAP_TOKEN,
  wordLimitInstruction,
  type CompletionLayout,
  type EvidenceResponse,
  type PublicQuestion,
  type QuestionResult,
  type Response,
} from "../../../shared/exam";
import type { ExamPassage, ParsedChoiceItem } from "../../../shared/exam-paper";
import { Markdown } from "../../components/Markdown";
import { OpenAnswerInput } from "./AnswerInputs";
import { MathField } from "./MathField";
import { useOptionShortcuts } from "./useOptionShortcuts";

const MATH_HINT = "可直接打字：/ 分數 · ^ 次方 · _ 下標 · sqrt 根號 · pi 為 π；點右側鍵盤圖示開啟數學鍵盤";

export function OptionCheckSvg() {
  return (
    <svg aria-hidden="true" className="exam-option-check" fill="none" viewBox="0 0 24 24">
      <path d="M5.5 12.5l4.2 4 8.8-9" pathLength="1" />
    </svg>
  );
}

export function GapBlank({ text }: { text: string | null }) {
  return (
    <span className="exam-gap" data-filled={text ? "true" : undefined}>
      {text || <span className="sr-only">空白</span>}
    </span>
  );
}

const GAP_MATCH_RE = /\{gap(?::([A-Za-z0-9_-]+))?\}|:blank\{#([A-Za-z0-9_-]+)\}/g;

function hasGapToken(text: string): boolean {
  return /\{gap(?::[A-Za-z0-9_-]+)?\}|:blank\{#[A-Za-z0-9_-]+\}/.test(text);
}

/** 渲染支援 Markdown + LaTeX + mhchem 與行內 {gap} / :blank{#id} 空格的文字。 */
function RichTextWithGaps({
  text,
  slotFor,
}: {
  text: string;
  slotFor: (gapId: string, occurrence: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<{ key: string; gapId: string; occ: number; el: HTMLElement }[]>([]);

  const normalizedMd = useMemo(() => {
    let occ = 0;
    return text.replace(GAP_MATCH_RE, (_full, gId, bId) => `:blank{#${gId ?? bId ?? `g${occ++}`}}`);
  }, [text]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const found = [...root.querySelectorAll<HTMLElement>("span.blank[data-blank]")].map((el, occ) => ({
      key: `${el.dataset.blank || "g"}-${occ}`,
      gapId: el.dataset.blank || `g${occ}`,
      occ,
      el,
    }));
    setTargets(found);
  }, [normalizedMd]);

  return (
    <>
      <Markdown ref={ref} md={normalizedMd} mode="exam" />
      {targets.map((t) => createPortal(slotFor(t.gapId, t.occ), t.el, t.key))}
    </>
  );
}

export function StemWithGap({ md, filledText }: { md: string; filledText: string | null }) {
  if (!md.includes(GAP_TOKEN)) return <Markdown md={md} mode="exam" />;
  return <RichTextWithGaps text={md} slotFor={() => <GapBlank text={filledText} />} />;
}

interface ControlProps {
  typedOnly?: boolean;
  q: PublicQuestion;
  value: Response;
  readOnly: boolean;
  onChange: (v: Response) => void;
  result?: QuestionResult;
  choices?: ParsedChoiceItem[];
  shortcuts?: boolean;
  passage?: ExamPassage | null;
  onOpenPassage?: () => void;
  /** 若為 true，選擇題選項已在 Markdown HTML 中渲染（如 ExamBody 的 :::choices），此處不重複渲染選項。 */
  choicesRenderedInMd?: boolean;
}

function JudgementControl({
  q,
  value,
  readOnly,
  onChange,
  result,
  shortcuts,
}: ControlProps) {
  const name = useId();
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const items: { val: string | boolean; key: string; label: string; aliases: string[] }[] =
    q.type === "tfng"
      ? [
          { val: "TRUE", key: "A", label: "True", aliases: ["1", "t"] },
          { val: "FALSE", key: "B", label: "False", aliases: ["2", "f"] },
          { val: "NOT_GIVEN", key: "C", label: "Not Given", aliases: ["3", "n"] },
        ]
      : q.type === "ynng"
        ? [
            { val: "YES", key: "A", label: "Yes", aliases: ["1", "y"] },
            { val: "NO", key: "B", label: "No", aliases: ["2", "n"] },
            { val: "NOT_GIVEN", key: "C", label: "Not Given", aliases: ["3"] },
          ]
        : [
            { val: true, key: "A", label: "正確 (True)", aliases: ["1", "t"] },
            { val: false, key: "B", label: "錯誤 (False)", aliases: ["2", "f"] },
          ];

  const isChosen = (itemVal: string | boolean) =>
    typeof value === "string" && typeof itemVal === "string"
      ? value.toUpperCase() === itemVal.toUpperCase()
      : value === itemVal;

  const expected = result?.expected;
  const isExpected = (itemVal: string | boolean) =>
    typeof expected === "string" && typeof itemVal === "string"
      ? expected.toUpperCase() === itemVal.toUpperCase()
      : expected === itemVal;

  useOptionShortcuts(
    items.map((i) => i.key),
    shortcuts && !readOnly
      ? (index) => {
          const picked = items[index];
          if (!picked) return;
          onChange(picked.val);
          groupRef.current?.querySelectorAll("input")[index]?.focus();
        }
      : null,
    items.map((i) => i.aliases),
  );

  return (
    <fieldset className="exam-options" disabled={readOnly} ref={groupRef}>
      <legend>選擇一個答案</legend>
      {items.map((item, idx) => {
        const checked = isChosen(item.val);
        const showCorrect = result ? isExpected(item.val) : false;
        const showWrong = result ? checked && !showCorrect : false;
        return (
          <label
            key={String(item.val)}
            className="exam-option"
            data-selected={checked || undefined}
            data-correct={showCorrect || undefined}
            data-wrong={showWrong || undefined}
            data-disabled={readOnly || undefined}
            style={{ "--i": idx } as CSSProperties}
          >
            <input
              type="radio"
              name={name}
              checked={checked}
              disabled={readOnly}
              onChange={() => onChange(item.val)}
              value={String(item.val)}
            />
            <span className="exam-option-key" aria-hidden="true">
              {item.key}
            </span>
            <span className="exam-option-text whitespace-nowrap font-semibold">{item.label}</span>
            <OptionCheckSvg />
          </label>
        );
      })}
    </fieldset>
  );
}

function ChoiceControl({
  q,
  value,
  readOnly,
  onChange,
  result,
  choices,
  shortcuts,
}: ControlProps) {
  const name = useId();
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const items: ParsedChoiceItem[] = useMemo(() => {
    if (choices && choices.length > 0) return choices;
    return (q.options ?? []).map((key) => ({ key, md: q.optionTexts?.[key] ?? key }));
  }, [choices, q.options, q.optionTexts]);

  const multiple = q.type === "multi_choice";
  const chosen = multiple
    ? Array.isArray(value)
      ? value.map(String)
      : []
    : typeof value === "string" && value
      ? [value]
      : [];
  const maxSel = multiple ? q.maxSelections : 1;
  const full = multiple && maxSel !== undefined && chosen.length >= maxSel;

  const toggle = (key: string) => {
    if (readOnly) return;
    if (!multiple) {
      onChange(chosen[0]?.toLowerCase() === key.toLowerCase() ? null : key);
      return;
    }
    const exists = chosen.some((c) => c.toLowerCase() === key.toLowerCase());
    if (exists) {
      onChange(chosen.filter((c) => c.toLowerCase() !== key.toLowerCase()));
    } else if (!full) {
      const nextSet = new Set([...chosen, key]);
      onChange(items.map((i) => i.key).filter((k) => [...nextSet].some((c) => c.toLowerCase() === k.toLowerCase())));
    }
  };

  useOptionShortcuts(
    items.map((item) => (item.key.length === 1 ? item.key : null)),
    shortcuts && !readOnly
      ? (index) => {
          const item = items[index];
          if (!item) return;
          toggle(item.key);
          groupRef.current?.querySelectorAll("input")[index]?.focus();
        }
      : null,
    items.map((_, index) => (index < 9 ? [String(index + 1)] : [])),
  );

  const expectedArr = Array.isArray(result?.expected)
    ? result.expected.map((x) => String(x).toLowerCase())
    : typeof result?.expected === "string"
      ? [result.expected.toLowerCase()]
      : [];

  return (
    <fieldset className="exam-options" disabled={readOnly} ref={groupRef}>
      <legend>
        {multiple
          ? maxSel
            ? `請選擇 ${maxSel} 個答案`
            : "複選題（可選多個）"
          : "選擇一個答案"}
      </legend>
      {items.map((item, idx) => {
        const checked = chosen.some((c) => c.toLowerCase() === item.key.toLowerCase());
        const showCorrect = result ? expectedArr.includes(item.key.toLowerCase()) : false;
        const showWrong = result ? checked && !showCorrect : false;
        const lockedOut = multiple && full && !checked;
        return (
          <label
            key={item.key}
            className="exam-option"
            data-selected={checked || undefined}
            data-correct={showCorrect || undefined}
            data-wrong={showWrong || undefined}
            data-disabled={readOnly || lockedOut || undefined}
            style={{ "--i": idx } as CSSProperties}
          >
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name}
              checked={checked}
              disabled={readOnly || lockedOut}
              onChange={() => toggle(item.key)}
              value={item.key}
            />
            <span className="exam-option-key" aria-hidden="true">
              {item.key}
            </span>
            <span className="exam-option-text">
              <Markdown md={item.md} mode="exam" />
            </span>
            <OptionCheckSvg />
          </label>
        );
      })}
      {multiple && maxSel !== undefined && (
        <p className="exam-choice-count" data-complete={chosen.length === maxSel} aria-live="polite">
          已選擇 {chosen.length} / {maxSel} 項
        </p>
      )}
    </fieldset>
  );
}

function CompletionLayoutBody({
  layout,
  slotFor,
}: {
  layout: CompletionLayout;
  slotFor: (gapId: string, occurrence: number) => ReactNode;
}) {
  let baseOcc = 0;
  const renderCell = (text: string) => {
    const offset = baseOcc;
    const matches = text.match(GAP_MATCH_RE);
    baseOcc += matches?.length ?? 0;
    return <RichTextWithGaps text={text} slotFor={(id, localOcc) => slotFor(id, offset + localOcc)} />;
  };

  switch (layout.kind) {
    case "table":
      return (
        <section aria-label={layout.title ?? "表格填空"} className="exam-completion-table-wrap">
          <table className="exam-completion-table">
            {layout.title && <caption>{layout.title}</caption>}
            <thead>
              <tr>
                {layout.columns.map((col, idx) => (
                  <th key={`${col}-${idx}`} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {layout.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} data-gap={hasGapToken(cell) ? "true" : undefined}>
                      {renderCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    case "flowchart":
      return (
        <figure className="exam-flowchart">
          {layout.title && <figcaption>{layout.title}</figcaption>}
          <ol>
            {layout.steps.map((step, idx) => (
              <li key={idx} data-gap={hasGapToken(step) ? "true" : undefined}>
                {renderCell(step)}
              </li>
            ))}
          </ol>
        </figure>
      );
    case "diagram":
      return (
        <figure className="exam-diagram">
          <figcaption>{layout.title}</figcaption>
          {layout.description && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{layout.description}</p>}
          {layout.image && <img src={layout.image} alt={layout.title ?? "圖表"} className="mb-3 max-h-72 rounded-xl" />}
          <ol>
            {layout.labels.map((label, idx) => (
              <li key={idx} data-gap={hasGapToken(label) ? "true" : undefined}>
                {renderCell(label)}
              </li>
            ))}
          </ol>
        </figure>
      );
    case "notes":
    case "text":
      return (
        <div className="space-y-2">
          {layout.title && <p className="font-semibold">{layout.title}</p>}
          {layout.lines.length === 1 ? (
            <div className="text-[17px] leading-relaxed">{renderCell(layout.lines[0])}</div>
          ) : (
            <ul className="exam-notes-list list-disc">
              {layout.lines.map((line, idx) => (
                <li key={idx} data-gap={hasGapToken(line) ? "true" : undefined}>
                  {renderCell(line)}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
  }
}

function CompletionControl({
  q,
  value,
  readOnly,
  onChange,
  result,
  shortcuts,
}: ControlProps) {
  const countId = useId();
  const blanks = q.blanks;
  const isMultiBlank = Boolean(blanks && blanks.length > 0);
  const blankMap = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const singleStr = typeof value === "string" ? value : "";

  const wordLimit = q.wordLimit;
  const numbersAllowed = Boolean(q.numbersAllowed);
  const rubric = wordLimit ? wordLimitInstruction(wordLimit, numbersAllowed) : null;

  // 詞庫題支援按 A/B/C 或 1/2/3 快捷選詞
  useOptionShortcuts(
    (q.wordBank ?? []).map((w) => (w.key.length === 1 ? w.key : null)),
    shortcuts && !readOnly && q.wordBank && !isMultiBlank
      ? (index) => {
          const picked = q.wordBank?.[index];
          if (!picked) return;
          onChange(picked.key);
        }
      : null,
  );

  const renderSlot = (gapId: string, occ: number) => {
    const spec = blanks?.find((b) => b.id === gapId) ?? blanks?.[occ];
    if (isMultiBlank && spec) {
      const val = blankMap[spec.id] ?? "";
      const ok = result?.detail?.[spec.id];
      if (spec.kind !== "text") {
        return (
          <MathField
            inline
            label={`空格 ${spec.id}`}
            value={val}
            readOnly={readOnly}
            className={result ? (ok ? "is-correct" : "is-wrong") : undefined}
            onChange={(v) => onChange({ ...blankMap, [spec.id]: v })}
          />
        );
      }
      const wLimit = spec.wordLimit ?? wordLimit;
      const numOk = spec.numbersAllowed ?? numbersAllowed;
      const over = wLimit !== undefined && countCompletionWords(val, numOk) > wLimit;
      return (
        <input
          aria-label={`空格 ${spec.id}`}
          aria-invalid={over || (result && !ok) || undefined}
          className={clsx(
            "exam-gap-input",
            result && (ok ? "border-green-600 bg-green-50 dark:bg-green-900/30" : "border-rose-500 bg-rose-50 dark:bg-rose-900/30"),
          )}
          value={val}
          readOnly={readOnly}
          size={Math.min(26, Math.max(9, val.length + 2))}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange({ ...blankMap, [spec.id]: e.target.value })}
        />
      );
    }

    if (q.wordBank && !isMultiBlank) {
      const pickedText = q.wordBank.find((w) => w.key.toLowerCase() === singleStr.toLowerCase())?.text ?? (singleStr || null);
      return <GapBlank text={pickedText} />;
    }

    const over = wordLimit !== undefined && countCompletionWords(singleStr, numbersAllowed) > wordLimit;
    return readOnly ? (
      <GapBlank text={singleStr || null} />
    ) : (
      <input
        aria-describedby={wordLimit ? countId : undefined}
        aria-invalid={over || undefined}
        aria-label="填空作答"
        className="exam-gap-input"
        value={singleStr}
        maxLength={140}
        size={Math.min(28, Math.max(10, singleStr.length + 2))}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  };

  const wordCount = !isMultiBlank && !q.wordBank ? countCompletionWords(singleStr, numbersAllowed) : 0;
  const overLimit = wordLimit !== undefined && wordCount > wordLimit;

  return (
    <div className="space-y-3">
      {rubric && (
        <p className="exam-question-rubric">
          作答字數限制：<strong>{rubric}</strong>
        </p>
      )}
      {q.layout ? (
        <CompletionLayoutBody layout={q.layout} slotFor={renderSlot} />
      ) : !isMultiBlank && !q.wordBank ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">答：</span>
          {renderSlot("a", 0)}
        </div>
      ) : null}

      {q.wordBank && !isMultiBlank && (
        <div className="exam-word-bank" role="radiogroup" aria-label="詞庫選項">
          {q.wordBank.map((w) => {
            const selected = singleStr.toLowerCase() === w.key.toLowerCase();
            return (
              <button
                key={w.key}
                type="button"
                disabled={readOnly}
                data-selected={selected || undefined}
                onClick={() => onChange(selected ? null : w.key)}
                className="exam-word-chip"
              >
                <span className="font-mono text-xs opacity-75">{w.key}</span>
                <span>{w.text}</span>
              </button>
            );
          })}
        </div>
      )}

      {!readOnly && wordLimit !== undefined && !isMultiBlank && !q.wordBank && (
        <p id={countId} className="exam-word-count" data-over={overLimit || undefined} aria-live="polite">
          {overLimit
            ? `已輸入 ${wordCount} 字：超過上限 ${wordLimit} 字，批改將會判定錯誤。`
            : `已輸入 ${wordCount} / ${wordLimit} 字${numbersAllowed ? "（數字不計字數）" : ""}`}
        </p>
      )}
    </div>
  );
}

function EvidenceControl({
  q,
  value,
  readOnly,
  onChange,
  passage,
  onOpenPassage,
}: ControlProps) {
  const [manualText, setManualText] = useState("");
  const [manualBlockId, setManualBlockId] = useState(passage?.blocks[0]?.blockId ?? "");
  const [manualError, setManualError] = useState("");
  const ev =
    value && typeof value === "object" && !Array.isArray(value) && "type" in value
      ? (value as EvidenceResponse)
      : typeof value === "string" && value.trim()
        ? ({ type: "SPAN", blockId: "", quote: value } as EvidenceResponse)
        : null;
  const isAbsence = ev?.type === "ABSENCE";
  const span = ev?.type === "SPAN" ? ev : null;
  const blockLetter = span && passage ? passage.blocks.find((b) => b.blockId === span.blockId)?.letter : "";

  const applyManual = () => {
    const qText = manualText.trim();
    if (!qText) {
      setManualError("請輸入或貼上原文句子。");
      return;
    }
    if (passage && manualBlockId) {
      const block = passage.blocks.find((b) => b.blockId === manualBlockId);
      if (block) {
        const plain = block.md.replace(/[*_`]/g, "");
        const idx = plain.toLowerCase().indexOf(qText.toLowerCase());
        onChange({
          type: "SPAN",
          passageId: passage.id,
          blockId: block.blockId,
          ...(idx >= 0 ? { startOffset: idx, endOffset: idx + qText.length } : {}),
          quote: qText,
        });
        setManualError("");
        setManualText("");
        return;
      }
    }
    onChange({ type: "SPAN", blockId: manualBlockId, quote: qText });
    setManualError("");
    setManualText("");
  };

  return (
    <div className="space-y-3">
      <p className="exam-question-instructions">
        請在左側文章中反白選取能證明答案的原文文句並按「設為本題答案」，或在下方手動輸入引文。
      </p>

      {onOpenPassage && !readOnly && (
        <button type="button" className="exam-open-passage" onClick={onOpenPassage}>
          <BookOpenText size={17} /> 開啟文章反白選取證據
        </button>
      )}

      {span && (
        <div className="exam-evidence-card">
          {blockLetter && <span className="exam-evidence-para-badge">{blockLetter}</span>}
          <blockquote className="exam-evidence-quote">“{span.quote}”</blockquote>
          {!readOnly && (
            <button
              type="button"
              aria-label="清除引文"
              onClick={() => onChange(null)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
            >
              <Trash size={15} />
            </button>
          )}
        </div>
      )}

      {!span && !isAbsence && readOnly && (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400 dark:bg-white/5">（未引用原文）</div>
      )}

      {q.allowAbsence && (
        <label className="exam-option">
          <input
            type="checkbox"
            checked={isAbsence}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked ? { type: "ABSENCE" } : null)}
          />
          <span className="exam-option-key" aria-hidden="true">
            ∅
          </span>
          <span className="exam-option-text">文章未提及相關資訊（Not Given / 無對應依據）</span>
          <OptionCheckSvg />
        </label>
      )}

      {!readOnly && !isAbsence && (
        <details className="rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5 text-sm dark:border-white/15">
          <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
            或以鍵盤手動輸入原文引句
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {passage && passage.blocks.some((b) => b.letter) && (
              <label className="grid gap-1 text-xs text-slate-500">
                段落
                <select
                  value={manualBlockId}
                  onChange={(e) => setManualBlockId(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                >
                  {passage.blocks
                    .filter((b) => b.letter)
                    .map((b) => (
                      <option key={b.blockId} value={b.blockId}>
                        段落 {b.letter}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="grid min-w-44 flex-1 gap-1 text-xs text-slate-500">
              原文引句
              <input
                type="text"
                value={manualText}
                placeholder="貼上或輸入文章中的原文…"
                onChange={(e) => {
                  setManualText(e.target.value);
                  setManualError("");
                }}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-800"
              />
            </label>
            <button
              type="button"
              onClick={applyManual}
              className="h-10 rounded-xl bg-ink-900 px-3.5 text-xs font-semibold text-white dark:bg-white dark:text-ink-900"
            >
              套用引文
            </button>
          </div>
          {manualError && <p className="mt-2 text-xs text-rose-600">{manualError}</p>}
        </details>
      )}
    </div>
  );
}

function OrderingControl({ q, value, readOnly, onChange, result }: ControlProps) {
  const order = Array.isArray(value) && value.length ? (value as string[]) : (q.items ?? []);
  const expected = Array.isArray(result?.expected) ? (result.expected as string[]) : null;
  const move = (i: number, d: number) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <ol className="space-y-2">
      {order.map((it, i) => {
        const itemOk = expected ? expected[i] === it : undefined;
        return (
          <li
            key={it}
            className={clsx(
              "flex items-center gap-3 rounded-2xl border bg-white px-3.5 py-2.5 dark:bg-ink-900",
              result
                ? itemOk
                  ? "border-green-600 bg-green-50/70 dark:bg-green-900/25"
                  : "border-rose-500 bg-rose-50/70 dark:bg-rose-900/25"
                : "border-slate-200 dark:border-white/15",
            )}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 font-mono text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 text-base">
              <Markdown md={it} mode="exam" />
            </div>
            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900/5 hover:bg-slate-900/10 disabled:opacity-30 dark:bg-white/10"
                  aria-label="上移"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900/5 hover:bg-slate-900/10 disabled:opacity-30 dark:bg-white/10"
                  aria-label="下移"
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function MatchingControl({ q, value, readOnly, onChange, result }: ControlProps) {
  const map = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, string>;
  const usedRights = useMemo(() => new Set(Object.values(map).filter(Boolean)), [map]);
  const rights = q.rights ?? [];

  return (
    <div className="space-y-3">
      {(q.lefts ?? []).map((left, idx) => {
        const chosen = map[left] ?? "";
        const ok = result?.detail?.[left];
        return (
          <div
            key={left}
            className={clsx(
              "rounded-2xl border bg-white p-3.5 dark:bg-ink-900",
              result
                ? ok
                  ? "border-green-600 bg-green-50/50 dark:bg-green-900/20"
                  : "border-rose-500 bg-rose-50/50 dark:bg-rose-900/20"
                : "border-slate-200 dark:border-white/15",
            )}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 font-mono text-xs font-bold text-slate-600 dark:bg-white/10 dark:text-slate-300">
                {idx + 1}
              </span>
              <div className="min-w-28 flex-1 font-medium">
                <Markdown md={left} mode="exam" />
              </div>
              <ArrowRight size={16} className="shrink-0 text-slate-400" />
              <select
                disabled={readOnly}
                aria-label={`配對 ${left}`}
                value={chosen}
                onChange={(e) => onChange({ ...map, [left]: e.target.value })}
                className={clsx(
                  "h-11 min-w-44 flex-1 rounded-xl border bg-white px-3 text-sm font-medium dark:bg-slate-800",
                  result ? (ok ? "border-green-600" : "border-rose-500") : "border-slate-300 dark:border-slate-600",
                )}
              >
                <option value="">請選擇配對項目…</option>
                {rights.map((r) => {
                  const usedElsewhere = !q.allowReuse && usedRights.has(r) && chosen !== r;
                  return (
                    <option key={r} value={r}>
                      {r}
                      {usedElsewhere ? "（已配對）" : ""}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScalarControl({ q, value, readOnly, onChange, result }: ControlProps) {
  const countId = useId();
  if (q.type === "numeric" || q.type === "expression") {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-slate-500">答：</span>
          <MathField
            value={(value as string) ?? ""}
            readOnly={readOnly}
            onChange={(v) => onChange(v)}
            label="作答"
            placeholder={q.type === "numeric" ? "數值" : "算式"}
            className={result ? (result.correct === true ? "is-correct" : "is-wrong") : undefined}
          />
          {q.unit && <span className="shrink-0 text-sm">{q.unit}</span>}
        </div>
        {!readOnly && <p className="mt-1.5 pl-9 text-[11px] leading-4 text-slate-400">{MATH_HINT}</p>}
      </div>
    );
  }

  const textVal = (value as string) ?? "";
  const wordLimit = q.wordLimit;
  const numbersAllowed = Boolean(q.numbersAllowed);
  const words = wordLimit !== undefined ? countCompletionWords(textVal, numbersAllowed) : 0;
  const over = wordLimit !== undefined && words > wordLimit;
  const tone = result ? (result.correct === true ? "border-green-600" : "border-rose-500") : "border-slate-300 dark:border-slate-600";

  return (
    <div className="space-y-2">
      {wordLimit !== undefined && (
        <p className="exam-question-rubric">
          字數上限：<strong>{wordLimitInstruction(wordLimit, numbersAllowed)}</strong>
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">答：</span>
        <input
          aria-describedby={wordLimit !== undefined ? countId : undefined}
          aria-invalid={over || undefined}
          className={clsx("h-12 w-full max-w-md rounded-xl border bg-white px-3.5 font-mono text-base dark:bg-slate-800", tone)}
          value={textVal}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        {q.unit && <span className="text-sm">{q.unit}</span>}
      </div>
      {!readOnly && wordLimit !== undefined && (
        <p id={countId} className="exam-word-count" data-over={over || undefined} aria-live="polite">
          {over ? `已輸入 ${words} 字（超過 ${wordLimit} 字上限）` : `已輸入 ${words} / ${wordLimit} 字`}
        </p>
      )}
    </div>
  );
}

function FillBlankFallbackControl({ q, value, readOnly, onChange, result }: ControlProps) {
  const tone = result ? (result.correct === true ? "border-green-600" : result.correct === "partial" ? "border-amber-500" : "border-rose-500") : "border-slate-300 dark:border-slate-600";
  const map = (value && typeof value === "object" ? value : {}) as Record<string, string>;
  return (
    <div className="flex flex-wrap gap-3">
      {(q.blanks ?? []).map((b) => (
        <label key={b.id} className="flex items-center gap-1.5 text-sm">
          <span>({b.id})</span>
          {b.kind === "text" ? (
            <input
              className={clsx("h-10 w-32 rounded-lg border bg-white px-2.5 font-mono dark:bg-slate-800", tone)}
              value={map[b.id] ?? ""}
              readOnly={readOnly}
              onChange={(e) => onChange({ ...map, [b.id]: e.target.value })}
            />
          ) : (
            <MathField
              inline
              label={`空格 ${b.id}`}
              value={map[b.id] ?? ""}
              readOnly={readOnly}
              className={result ? (result.detail?.[b.id] ? "is-correct" : "is-wrong") : undefined}
              onChange={(v) => onChange({ ...map, [b.id]: v })}
            />
          )}
        </label>
      ))}
    </div>
  );
}

/** 統一渲染非行內空格類題型的作答控制項（支援 ExamTake 單題與 ExamBody 全卷/檢討）。 */
export function QuestionControl(props: ControlProps) {
  const { q, value, readOnly, onChange, choicesRenderedInMd } = props;
  switch (q.type) {
    case "true_false":
    case "tfng":
    case "ynng":
      return <JudgementControl {...props} />;
    case "single_choice":
    case "multi_choice":
      if (choicesRenderedInMd) return null;
      return <ChoiceControl {...props} />;
    case "numeric":
    case "expression":
    case "text":
      return <ScalarControl {...props} />;
    case "fill_blank":
      return <FillBlankFallbackControl {...props} />;
    case "completion":
      return <CompletionControl {...props} />;
    case "evidence":
      return <EvidenceControl {...props} />;
    case "ordering":
      return <OrderingControl {...props} />;
    case "matching":
      return <MatchingControl {...props} />;
    case "open":
      return <OpenAnswerInput value={value} readOnly={readOnly} typedOnly={props.typedOnly} onChange={(v) => onChange(v as Response)} />;
    default:
      return null;
  }
}

export function formatExpectedAnswer(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "正確" : "錯誤";
  if (v === "TRUE") return "True";
  if (v === "FALSE") return "False";
  if (v === "NOT_GIVEN") return "Not Given";
  if (v === "YES") return "Yes";
  if (v === "NO") return "No";
  if (v === "ABSENCE") return "文章未提供相關資訊 (Not Given)";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${x}`)
      .join("；");
  }
  return String(v);
}

export function ExamFeedbackCard({
  res,
  q,
  keyPath,
  selfScores,
  onSelfScore,
  selfScoreBusy,
}: {
  res: QuestionResult;
  q: PublicQuestion;
  keyPath: string;
  selfScores?: Record<string, number>;
  onSelfScore?: (key: string, score: number) => void;
  selfScoreBusy?: boolean;
}) {
  if (q.type === "multipart") return null;
  const reviewed = res.correct === null && selfScores?.[keyPath] !== undefined;
  const tone =
    res.correct === true
      ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
      : res.correct === null
        ? "bg-slate-50 dark:bg-slate-800"
        : res.correct === "partial"
          ? "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className={clsx("mt-4 rounded-2xl p-4 text-sm", tone)}
    >
      <div className="flex items-center gap-2 font-semibold">
        {res.correct === true ? (
          <CheckCircle size={20} weight="fill" />
        ) : res.correct === null ? (
          <PencilLine size={20} weight="fill" />
        ) : res.correct === "partial" ? (
          <CircleHalf size={20} weight="fill" />
        ) : (
          <XCircle size={20} weight="fill" />
        )}
        {res.correct === true ? "正確" : res.correct === null ? (reviewed ? "已評分" : "待自評") : res.correct === "partial" ? "部分正確" : "錯誤"} ·{" "}
        {res.score}/{res.max} 分
      </div>
      {res.correct !== true && res.expected !== undefined && (
        <div className="mt-1">
          正確答案：<span className="font-mono">{formatExpectedAnswer(res.expected)}</span>
        </div>
      )}
      {res.comment && (
        <div className="mt-2 rounded-xl bg-white/60 p-3 dark:bg-white/5">
          <div className="text-xs font-semibold opacity-70">批改評語</div>
          <Markdown md={res.comment} />
        </div>
      )}
      {res.modelAnswer && (
        <div className="mt-2">
          <div className="text-xs font-semibold opacity-70">參考答案</div>
          <Markdown md={res.modelAnswer} />
        </div>
      )}
      {res.rubric && (
        <div className="mt-2">
          <div className="text-xs font-semibold opacity-70">評分規準</div>
          <Markdown md={res.rubric} />
        </div>
      )}
      {res.correct === null && onSelfScore && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          自評得分：
          {Array.from({ length: Math.floor(res.max) + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              disabled={selfScoreBusy}
              aria-label={`自評 ${keyPath}：${i} / ${res.max} 分`}
              aria-pressed={selfScores?.[keyPath] === i}
              onClick={() => onSelfScore(keyPath, i)}
              className={clsx(
                "h-11 min-w-11 rounded-lg border px-2 font-mono text-xs disabled:opacity-50",
                selfScores?.[keyPath] === i
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
              )}
            >
              {i}
            </button>
          ))}
        </div>
      )}
      {res.explanation && (
        <div className="mt-2 border-t border-black/10 pt-2 dark:border-white/10">
          <Markdown md={res.explanation} />
        </div>
      )}
    </motion.div>
  );
}
