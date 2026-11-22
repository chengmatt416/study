// 公式輸入框（MathLive）：所見即所得輸入數學式，輸出 LaTeX；觸控裝置聚焦時自動開啟數學鍵盤。
// 可直接打字：/ → 分數、^ → 次方、_ → 下標、sqrt → 根號、pi → π；也可直接輸入 LaTeX 指令（\frac 等）。
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { MathfieldElement } from "mathlive";

let loader: Promise<typeof import("mathlive")> | null = null;

export function loadMathlive() {
  if (!loader)
    loader = import("mathlive").then((m) => {
      m.MathfieldElement.fontsDirectory = "/vendor/mathlive/fonts";
      m.MathfieldElement.soundsDirectory = null;
      // 數學鍵盤高度 → CSS 變數，讓作答區底部留白，鍵盤不會蓋住輸入框
      const kb = window.mathVirtualKeyboard;
      kb?.addEventListener("geometrychange", () => {
        document.documentElement.style.setProperty("--mvk-h", `${kb.boundingRect.height}px`);
        const active = document.activeElement as HTMLElement | null;
        if (kb.visible && active?.tagName === "MATH-FIELD") setTimeout(() => active.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      });
      return m;
    });
  return loader;
}

interface Props {
  value: string;
  onChange?: (latex: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
  /** 行內空格：較小、無外框留白 */
  inline?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
}

export function MathField({ value, onChange, readOnly, placeholder, label, className, inline, autoFocus, onEnter }: Props) {
  const host = useRef<HTMLSpanElement>(null);
  const mf = useRef<MathfieldElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const [keyboardOpen,setKeyboardOpen] = useState(!inline);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let el: MathfieldElement | null = null;
    loadMathlive()
      .then(({ MathfieldElement }) => {
        if (!alive || !host.current) return;
        el = new MathfieldElement();
        el.value = value ?? "";
        el.readOnly = !!readOnly;
        el.smartFence = true;
        el.mathVirtualKeyboardPolicy = "manual";
        el.popoverPolicy = "auto";
        if (placeholder) el.setAttribute("placeholder", `\\text{${placeholder.replace(/[{}\\]/g, "")}}`);
        if (label) el.setAttribute("aria-label", label);
        el.addEventListener("input", () => onChangeRef.current?.(el!.value));
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && onEnterRef.current) {
            e.preventDefault();
            onEnterRef.current();
          }
        });
        host.current.appendChild(el);
        el.menuItems = [];
        mf.current = el;
        setReady(true);
        if (autoFocus) setTimeout(() => el?.focus(), 30);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      el?.remove();
      mf.current = null;
    };
    // 只在掛載時建立；值與唯讀狀態由下方 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = mf.current;
    if (el && el.value !== (value ?? "")) el.setValue(value ?? "", { silenceNotifications: true });
  }, [value, ready]);

  useEffect(() => {
    if (mf.current) mf.current.readOnly = !!readOnly;
  }, [readOnly, ready]);

  // 載入失敗（離線且未快取）：退回一般輸入框，仍可輸入 LaTeX 或算式
  if (failed)
    return (
      <input
        className={clsx("rounded-xl border border-slate-300 bg-white px-3 font-mono dark:border-slate-600 dark:bg-slate-800", inline ? "h-9 w-32" : "h-11 w-full", className)}
        value={value ?? ""}
        readOnly={readOnly}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );

  return (
    <span className={clsx("inline-flex max-w-full flex-col", !inline && "w-full")} >
    <span
      ref={host}
      className={clsx("math-input", inline ? "math-input-inline" : "math-input-block", readOnly && "math-input-readonly", !ready && "math-input-loading", className)}
    />
    {!readOnly && ready && inline && <button type="button" aria-expanded={keyboardOpen} className="min-h-10 self-start rounded-md px-2 text-xs text-slate-500" onClick={()=>setKeyboardOpen(open=>!open)}>{keyboardOpen?"收起公式鍵盤":"公式鍵盤"}</button>}
    {!readOnly && ready && keyboardOpen && <span style={inline?{width:"min(20rem, calc(100vw - 3rem))"}:undefined} role="group" aria-label="簡易公式鍵盤" className="flex flex-wrap gap-1 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50 p-1.5 dark:border-slate-600 dark:bg-slate-800">
      {[["分數","\\frac{#0}{#?}"],["根號","\\sqrt{#0}"],["次方","^{#0}"],["下標","_{#0}"],["π","\\pi"],["×","\\times"],["÷","\\div"],["≤","\\le"],["括號","\\left(#0\\right)"]].map(([caption,latex]) => <button type="button" key={caption} aria-label={"插入"+caption} className="min-h-10 min-w-10 rounded-md border border-slate-200 px-2 text-xs hover:bg-white dark:border-slate-600 dark:hover:bg-slate-700" onPointerDown={event=>event.preventDefault()} onClick={()=>{mf.current?.focus();mf.current?.insert(latex,{focus:true,feedback:false});}}>{caption}</button>)}
      <button type="button" className="min-h-10 rounded-md px-2 text-xs" onClick={()=>{mf.current?.focus();if(window.mathVirtualKeyboard?.visible)window.mathVirtualKeyboard.hide();else window.mathVirtualKeyboard?.show();}}>完整鍵盤</button>
    </span>}
    </span>
  );
}
