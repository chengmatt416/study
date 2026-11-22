import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useDevice } from "../../lib/device";
import { Button, Spinner } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { QalcClient } from "./qalc-client";
import { readToolStorage, toolStorageKey, writeToolStorage } from "./storage";
import { LegacyToolRestore } from "./LegacyToolRestore";

interface Entry {
  input: string;
  parsed: string;
  output: string;
  messages: string;
}

const calculator = new QalcClient(() => new Worker(new URL("./qalc.worker.ts", import.meta.url), { type: "classic" }));
function readHistory(raw: string | null): Entry[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is Entry => entry && [entry.input, entry.parsed, entry.output, entry.messages].every((text) => typeof text === "string" && text.length <= 100_000)).slice(-100) : [];
  } catch { return []; }
}

/** 僅保留排版用標籤 */
const clean = (html: string) => html.replace(/<[^>]*>/g, (token) => {
  const tag = /^<(\/?)(sup|sub|i|b|span)(?:\s|\/?>)/i.exec(token);
  return tag ? `<${tag[1]}${tag[2].toLowerCase()}>` : "";
});

const KEYS = [
  ["sin(", "cos(", "tan(", "ln(", "log(", "√("],
  ["^", "π", "e", "(", ")", "!"],
  ["asin(", "acos(", "atan(", "abs(", "ans", "→"],
  ["7", "8", "9", "÷", "solve(", "deg"],
  ["4", "5", "6", "×", "diff(", "rad"],
  ["1", "2", "3", "−", "integrate(", "%"],
  ["0", ".", "E", "+", ",", "="],
];

export function Qalculate() {
  const owner = useUser().id;
  const historyKey = toolStorageKey(owner, "qalc-history"), angleKey = toolStorageKey(owner, "qalc-angle"), legacyMarker = toolStorageKey(owner, "qalc-legacy-restored");
  const device = useDevice();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Entry[]>(() => readHistory(readToolStorage(historyKey)));
  const [angle, setAngle] = useState<"deg" | "rad">(() => readToolStorage(angleKey) === "rad" ? "rad" : "deg");
  const [attempt, setAttempt] = useState(0), [calculating, setCalculating] = useState(false), [storageError, setStorageError] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const lifetime = useRef(0), running = useRef(false), historyRef = useRef(history);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ownHistory = readHistory(readToolStorage(historyKey));
    historyRef.current = ownHistory; setHistory(ownHistory); setInput("");
    setAngle(readToolStorage(angleKey) === "rad" ? "rad" : "deg");
  }, [historyKey, angleKey]);

  useEffect(() => {
    const token = ++lifetime.current;
    setStatus("loading"); setError(""); running.current = false; setCalculating(false);
    void (async () => {
      const ready = await calculator.call(owner, "init");
      if (token !== lifetime.current) return;
      if (!ready.ok) throw new Error("計算機暫時無法載入，請重試");
      const option = await calculator.call(owner, "option", `angle ${readToolStorage(angleKey) === "rad" ? "rad" : "deg"}`);
      if (!option.ok) throw new Error("計算機暫時無法載入，請重試");
      if (token === lifetime.current) setStatus("ready");
    })().catch((cause: unknown) => { if (token === lifetime.current) { setStatus("error"); setError(cause instanceof Error ? cause.message : "計算機暫時無法載入"); } });
    return () => { lifetime.current++; };
  }, [owner, angleKey, attempt]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [history]);

  const run = async () => {
    const expr = input.trim();
    if (!expr || running.current || status !== "ready") return;
    running.current = true; setCalculating(true); setError("");
    const token = lifetime.current;
    const last = history.at(-1);
    const withAns = last ? expr.replace(/\bans\b/g, `(${last.output.replace(/<[^>]+>/g, "")})`) : expr;
    try {
      const r = await calculator.call(owner, "calc", withAns);
      if (token !== lifetime.current) return;
      if (!r.ok || !r.output?.trim()) { setError(r.error || r.messages || "無法計算這個算式，請確認格式；輸入已保留。"); return; }
      const next = [...historyRef.current, { input: expr, parsed: String(r.input ?? ""), output: String(r.output ?? ""), messages: String(r.messages ?? "") }].slice(-100);
      historyRef.current = next; setHistory(next);
      setStorageError(!writeToolStorage(historyKey, JSON.stringify(next)));
      setInput((current) => current.trim() === expr ? "" : current);
    } catch (cause) {
      if (token === lifetime.current) { setStatus("error"); setError(cause instanceof Error ? cause.message : "計算機暫時無法回應"); }
    } finally { if (token === lifetime.current) { running.current = false; setCalculating(false); } }
  };

  const press = (k: string) => {
    if (k === "=") return void run();
    if (k === "deg" || k === "rad") {
      if (status !== "ready") return;
      setAngle(k);
      setStorageError(!writeToolStorage(angleKey, k));
      const token = lifetime.current;
      void calculator.call(owner, "option", `angle ${k}`).then((response) => { if (!response.ok) throw new Error("角度設定未完成，請重試"); }).catch((cause: unknown) => { if (token === lifetime.current) { setStatus("error"); setError(cause instanceof Error ? cause.message : "角度設定未完成"); } });
      return;
    }
    const map: Record<string, string> = { "÷": "/", "×": "*", "−": "-" };
    const el = inputRef.current!;
    const s = el.selectionStart ?? input.length;
    const ins = map[k] ?? k;
    setInput(input.slice(0, s) + ins + input.slice(el.selectionEnd ?? s));
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(s + ins.length, s + ins.length);
    });
  };

  return (
    <div className="flex h-full flex-col">
      {error && <div role="alert" className="shrink-0 space-y-2 border-b border-slate-200 p-3 text-sm dark:border-white/10"><p>{error}</p>{status === "error" && <Button onClick={() => { calculator.reset(); setAttempt((value) => value + 1); }}>重新載入計算機</Button>}</div>}
      {storageError && <p role="status" className="shrink-0 px-4 pt-3 text-xs text-amber-700 dark:text-amber-300">此裝置無法儲存工具紀錄；本次內容仍可使用，請勿關閉頁面。</p>}
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {history.length === 0 && (
          <div className="text-sm text-slate-500">
            範例：<code>sqrt(2)^3</code>、<code>solve(x^2-5x+6=0)</code>、<code>diff(x^3, x)</code>、<code>integrate(sin(x), 0, pi)</code>、<code>5 km/h to m/s</code>、<code>12!</code>
          </div>
        )}
        {history.map((h, i) => (
          <button key={i} className="block w-full text-right" onClick={() => setInput(h.input)} title="點擊重新編輯">
            <div className="text-xs text-slate-500">{h.parsed ? <span dangerouslySetInnerHTML={{ __html: clean(h.parsed) }} /> : h.input}</div>
            <div className="text-xl font-medium break-all" dangerouslySetInnerHTML={{ __html: "= " + clean(h.output) }} />
            {h.messages && <div className="text-xs text-amber-600">{h.messages}</div>}
          </button>
        ))}
      </div>
      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <LegacyToolRestore available={readHistory(readToolStorage("qalc-history")).length > 0 && readToolStorage(legacyMarker) !== "1"} disabled={status !== "ready" || calculating} onRestore={() => {
          const merged = [...readHistory(readToolStorage("qalc-history")), ...historyRef.current];
          const unique = [...new Map(merged.map((entry) => [JSON.stringify(entry), entry])).values()].slice(-100);
          if (!writeToolStorage(historyKey, JSON.stringify(unique)) || !writeToolStorage(legacyMarker, "1")) return false;
          historyRef.current = unique; setHistory(unique); return true;
        }} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="flex gap-2"
        >
          <input
            ref={inputRef}
            aria-label="計算算式"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            inputMode={device === "desktop" || keyboard ? "text" : "none"}
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 font-mono text-base dark:border-slate-600 dark:bg-slate-800"
            placeholder={status === "loading" ? "載入中…" : "輸入算式，Enter 計算"}
            disabled={status !== "ready"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button aria-label="計算" className="h-11 rounded-xl bg-brand-700 px-4 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2" disabled={status !== "ready" || calculating}>
            {status === "loading" || calculating ? <Spinner className="h-4 w-4 border-white/50 border-t-white" /> : "="}
          </button>
        </form>
        {device !== "desktop" && <button type="button" disabled={status !== "ready"} aria-pressed={keyboard} className="mt-1 min-h-11 rounded-lg px-2 text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 dark:text-slate-300" onClick={() => {
          const next = !keyboard; setKeyboard(next);
          if (inputRef.current) { inputRef.current.inputMode = next ? "text" : "none"; if (next) inputRef.current.focus(); else inputRef.current.blur(); }
        }}>{keyboard ? "使用數學按鍵" : "使用文字鍵盤（變數／單位）"}</button>}
        {device !== "desktop" && !keyboard && (
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {KEYS.flat().map((k) => (
              <button
                key={k}
                type="button"
                aria-label={k === "integrate(" ? "積分 integrate(" : undefined}
                disabled={status !== "ready" || k === "=" && calculating}
                onClick={() => press(k)}
                className={clsx(
                  "h-11 rounded-lg text-sm font-medium active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40",
                  /^\d|\.$/.test(k) ? "bg-white shadow-sm dark:bg-slate-700" : "bg-slate-100 dark:bg-slate-800",
                  k === "=" && "bg-brand-700 text-white",
                  (k === "deg" || k === "rad") && angle === k && "ring-2 ring-brand-600",
                )}
              >
                {k === "integrate(" ? "∫" : k}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <div role="group" aria-label="角度單位" className="flex gap-1">{([['deg', '度'], ['rad', '弧度']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={angle === value} disabled={status !== "ready" || calculating} onClick={() => press(value)} className={clsx("min-h-11 rounded-lg px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40", angle === value ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white" : "text-slate-500")}>{label}</button>)}</div>
          <span>Powered by Qalculate! (GPL)</span>
        </div>
      </div>
    </div>
  );
}
