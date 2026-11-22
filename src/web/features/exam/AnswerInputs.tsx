// 作答輸入元件：
// - OpenAnswerInput：自由作答，可切換「打字」（Markdown + LaTeX，附公式工具列與即時預覽）或「手寫」（書寫區，存進作答）
// - LatexTextarea：含 LaTeX 輸入輔助的文字框
import { useDeferredValue, useId, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { motion, AnimatePresence } from "motion/react";
import { Eye, EyeSlash, Function as FunctionIcon, Scribble, TextT } from "@phosphor-icons/react";
import { Markdown } from "../../components/Markdown";
import { MathField } from "./MathField";
import { Scratchpad, emptyInk } from "./Scratchpad";
import { decodeInk, encodeInk, inkStrokeCount, readOpenAnswer, type OpenAnswer } from "../../../shared/ink";

/** ▯ 是插入後游標的位置 */
const SNIPPETS: { label: string; tex: string; title: string }[] = [
  { label: "a⁄b", tex: "\\frac{▯}{}", title: "分數" },
  { label: "√", tex: "\\sqrt{▯}", title: "根號" },
  { label: "xⁿ", tex: "^{▯}", title: "次方" },
  { label: "xₙ", tex: "_{▯}", title: "下標" },
  { label: "×", tex: "\\times ", title: "乘" },
  { label: "÷", tex: "\\div ", title: "除" },
  { label: "±", tex: "\\pm ", title: "正負" },
  { label: "≤", tex: "\\le ", title: "小於等於" },
  { label: "≥", tex: "\\ge ", title: "大於等於" },
  { label: "≠", tex: "\\ne ", title: "不等於" },
  { label: "≈", tex: "\\approx ", title: "約等於" },
  { label: "π", tex: "\\pi ", title: "pi" },
  { label: "θ", tex: "\\theta ", title: "theta" },
  { label: "Δ", tex: "\\Delta ", title: "Delta" },
  { label: "∞", tex: "\\infty ", title: "無限大" },
  { label: "→", tex: "\\rightarrow ", title: "箭頭" },
  { label: "⇌", tex: "\\rightleftharpoons ", title: "可逆反應" },
  { label: "∫", tex: "\\int_{▯}^{} ", title: "積分" },
  { label: "Σ", tex: "\\sum_{▯}^{} ", title: "總和" },
  { label: "x⃗", tex: "\\vec{▯}", title: "向量" },
  { label: "°", tex: "^{\\circ}", title: "度" },
  { label: "H₂O", tex: "\\ce{▯}", title: "化學式（mhchem）" },
];

/** 游標前未跳脫的 $ 數為奇數 → 在數學式內 */
function insideMath(text: string, pos: number) {
  const before = text.slice(0, pos).replace(/\\\$/g, "");
  return (before.match(/\$/g)?.length ?? 0) % 2 === 1;
}

export function LatexTextarea({ value, onChange, readOnly, placeholder, minRows = 4 }: { value: string; onChange: (v: string) => void; readOnly?: boolean; placeholder?: string; minRows?: number }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formula, setFormula] = useState("");
  const [display, setDisplay] = useState(false);
  const [preview, setPreview] = useState(true);
  const deferred = useDeferredValue(value);
  const hasMath = /\$|\\\(|\\\[/.test(deferred);
  const sel = useRef<[number, number]>([value.length, value.length]);

  const remember = () => {
    const el = ta.current;
    if (el) sel.current = [el.selectionStart, el.selectionEnd];
  };

  const insert = (raw: string) => {
    const [a, b] = sel.current;
    const caret = raw.indexOf("▯");
    const text = raw.replace("▯", "");
    const next = value.slice(0, a) + text + value.slice(b);
    onChange(next);
    const pos = a + (caret >= 0 ? caret : text.length);
    sel.current = [pos, pos];
    setTimeout(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 0);
  };

  const snippet = (tex: string) => {
    const [a] = sel.current;
    insert(insideMath(value, a) ? tex : `$${tex.includes("▯") ? tex : tex + "▯"}$`);
  };

  const insertFormula = () => {
    const tex = formula.trim();
    if (tex) {
      const [a] = sel.current;
      const needNl = a > 0 && value[a - 1] !== "\n";
      insert(display ? `${needNl ? "\n" : ""}$$\n${tex}\n$$\n▯` : insideMath(value, a) ? `${tex}▯` : `$${tex}$▯`);
    }
    setFormula("");
    setFormulaOpen(false);
  };

  if (readOnly)
    return value.trim() ? (
      <div className="rounded-xl bg-slate-50 px-4 py-2 dark:bg-white/5">
        <Markdown md={value} />
      </div>
    ) : (
      <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400 dark:bg-white/5">（未作答）</div>
    );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white focus-within:border-ink-900 focus-within:ring-4 focus-within:ring-ink-900/10 dark:border-slate-600 dark:bg-slate-800 dark:focus-within:border-white dark:focus-within:ring-white/15">
      <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 bg-slate-50/80 px-1.5 py-1 dark:border-white/10 dark:bg-white/5" onPointerDown={(e) => e.target !== e.currentTarget && e.preventDefault()}>
        <button
          type="button"
          onClick={() => {
            remember();
            setFormulaOpen((v) => !v);
          }}
          className={clsx("flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold", formulaOpen ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "hover:bg-slate-200/70 dark:hover:bg-white/10")}
          title="公式編輯器（所見即所得）"
        >
          <FunctionIcon size={16} weight="bold" /> 公式
        </button>
        <span className="mx-1 h-5 w-px shrink-0 bg-black/10 dark:bg-white/10" />
        {SNIPPETS.map((s) => (
          <button key={s.title} type="button" title={`${s.title}（${s.tex.replace("▯", "")}）`} aria-label={s.title} onClick={() => snippet(s.tex)} className="h-8 min-w-8 shrink-0 rounded-lg px-1.5 font-serif text-sm hover:bg-slate-200/70 dark:hover:bg-white/10">
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" title={preview ? "隱藏預覽" : "顯示預覽"} aria-label="預覽" onClick={() => setPreview((v) => !v)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-white/10">
          {preview ? <Eye size={16} /> : <EyeSlash size={16} />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {formulaOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-slate-200 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2 p-2">
              <MathField value={formula} onChange={setFormula} autoFocus onEnter={insertFormula} placeholder="輸入公式：/ 分數、^ 次方、sqrt 根號" className="min-w-0 flex-1" label="公式" />
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> 獨立一行
              </label>
              <button type="button" onClick={insertFormula} className="h-9 rounded-xl bg-ink-900 px-3 text-sm font-semibold text-white dark:bg-white dark:text-ink-900">
                插入
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <textarea
        ref={ta}
        className="block w-full resize-y bg-transparent p-3 font-mono text-[15px] leading-6 outline-none"
        style={{ minHeight: `${minRows * 1.5 + 1.5}rem` }}
        value={value}
        placeholder={placeholder ?? "作答區：可輸入文字與 LaTeX，例如 $x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$"}
        onChange={(e) => onChange(e.target.value)}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        onBlur={remember}
      />
      {preview && hasMath && (
        <div className="border-t border-dashed border-slate-200 px-4 py-1 dark:border-white/10">
          <div className="pt-1 text-[10px] font-semibold tracking-[0.18em] text-slate-400 uppercase">預覽</div>
          <Markdown md={deferred} />
        </div>
      )}
    </div>
  );
}

/** 自由作答（open 題）：打字 / 手寫 切換，兩種內容都保留，交卷時以目前選擇的方式為主要作答 */
export function OpenAnswerInput({ value, onChange, readOnly, typedOnly }: { value: unknown; onChange: (v: OpenAnswer | string | null) => void; readOnly?: boolean; typedOnly?: boolean }) {
  const id = useId();
  const ans = readOpenAnswer(value);
  const [mode, setMode] = useState<OpenAnswer["mode"]>(ans.mode);
  const ink = useMemo(() => (ans.ink ? decodeInk(ans.ink) : null), [ans.ink]);
  const latest = useRef(ans);
  latest.current = { ...ans, mode };

  const save = (patch: Partial<OpenAnswer>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    const text = next.text ?? "";
    if (!next.ink && next.mode === "text") return onChange(text ? text : null); // 純打字：維持字串格式
    if (!next.ink && !text) return onChange(next.mode === "ink" ? { mode: "ink" } : null);
    onChange({ mode: next.mode, ...(text ? { text } : {}), ...(next.ink ? { ink: next.ink } : {}) });
  };

  if (typedOnly && !readOnly) return <LatexTextarea value={ans.text ?? ""} onChange={(text) => onChange(text || null)} />;

  if (readOnly) {
    const showInk = ans.mode === "ink" || (!ans.text && ink);
    return (
      <div className="space-y-2">
        {showInk && ink && inkStrokeCount(ink) > 0 ? <Scratchpad value={ink} readOnly variant="answer" /> : null}
        {(!showInk || ans.text) && <LatexTextarea value={ans.text ?? ""} onChange={() => {}} readOnly />}
        {showInk && (!ink || !inkStrokeCount(ink)) && !ans.text && <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400 dark:bg-white/5">（未作答）</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="relative inline-flex rounded-xl bg-slate-900/5 p-0.5 dark:bg-white/10" role="tablist" aria-label="作答方式">
          {(
            [
              ["text", "打字", TextT],
              ["ink", "手寫", Scribble],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                save({ mode: m });
              }}
              className={clsx("relative flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-xs font-semibold transition-colors", mode === m ? "text-on-accent" : "text-slate-500")}
            >
              {mode === m && <motion.span layoutId={`open-mode-${id}`} className="absolute inset-0 rounded-[10px] bg-aurora" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <Icon size={14} weight="bold" className="relative" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400">{mode === "ink" ? "Apple Pencil 書寫時手指可捲動；可加頁" : "支援 Markdown 與 LaTeX"}</span>
      </div>
      {mode === "text" ? (
        <LatexTextarea value={ans.text ?? ""} onChange={(text) => save({ text })} />
      ) : (
        <Scratchpad value={ink ?? emptyInk(500, "lines")} onChange={(doc) => save({ ink: inkStrokeCount(doc) ? encodeInk(doc) : undefined })} variant="answer" />
      )}
    </div>
  );
}
