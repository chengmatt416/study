// AI 文字即時串流的平順顯示：伺服器一次送來一段（幾個字到幾十個字），畫面上一個字一個字長出來，
// 速度依積壓量調整（積越多越快，最慢約 0.25 秒追上），不會比伺服器慢太多，也不會一段一段跳。
// 新內容不是舊內容的延續（模型改寫、重新連線）時，從共同前綴接著長。減少動態效果時直接顯示全文。
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** 每一幀要多顯示幾個字：積壓 backlog 個字時，約 catchUpMs 內追上，至少 minPerSecond 字／秒 */
export function revealStep(backlog: number, dtMs: number, catchUpMs = 260, minPerSecond = 45): number {
  if (backlog <= 0) return 0;
  const perMs = Math.max(minPerSecond / 1000, backlog / catchUpMs);
  return Math.min(backlog, Math.max(1, Math.round(perMs * dtMs)));
}

/** 兩段字串的共同前綴長度（以 UTF-16 單位；不切開代理對） */
export function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i > 0 && i < a.length && isHighSurrogate(a.charCodeAt(i - 1))) i--;
  return i;
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** 不要停在代理對中間或 Markdown 跳脫符號後面 */
function safeCut(text: string, n: number): number {
  let i = Math.min(text.length, n);
  if (i > 0 && i < text.length && isHighSurrogate(text.charCodeAt(i - 1))) i++;
  return i;
}

/**
 * 回傳目前要顯示的文字與是否還在追趕。
 * active=false（例如任務已完成）時一樣會把剩下的字平順補完，再停在全文。
 */
export function useSmoothText(target: string | null | undefined, opts: { maxFps?: number } = {}): { text: string; catchingUp: boolean } {
  const reduce = useReducedMotion();
  const full = target ?? "";
  const [shown, setShown] = useState(full);
  const shownRef = useRef(full);
  const targetRef = useRef(full);
  targetRef.current = full;
  const frame = useRef<number | null>(null);
  const minFrameMs = 1000 / (opts.maxFps ?? 40);

  useEffect(() => {
    if (reduce || typeof requestAnimationFrame === "undefined") {
      shownRef.current = full;
      setShown(full);
      return;
    }
    const cur = shownRef.current;
    if (!full.startsWith(cur)) {
      // 改寫：退到共同前綴再長
      shownRef.current = cur.slice(0, commonPrefix(cur, full));
      setShown(shownRef.current);
    }
    if (frame.current !== null) return;
    let last = performance.now();
    let lastPaint = last;
    const tick = (now: number) => {
      const goal = targetRef.current;
      const have = shownRef.current;
      if (have.length >= goal.length) {
        frame.current = null;
        if (have !== goal) {
          shownRef.current = goal;
          setShown(goal);
        }
        return;
      }
      const dt = Math.min(100, now - last);
      last = now;
      const step = revealStep(goal.length - have.length, dt);
      shownRef.current = goal.slice(0, safeCut(goal, have.length + step));
      if (now - lastPaint >= minFrameMs || shownRef.current.length >= goal.length) {
        lastPaint = now;
        setShown(shownRef.current);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [full, reduce, minFrameMs]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  return { text: reduce ? full : shown, catchingUp: !reduce && shown.length < full.length };
}
