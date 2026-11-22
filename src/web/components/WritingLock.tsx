// 書寫鎖定按鈕的輸入規則（筆記本、電子書標注、考試演算紙三個工具列共用）：
// - 開啟：只接受觸控筆點擊。手指、滑鼠、鍵盤都開不了，沒有筆的裝置不會把自己鎖在外面。
// - 解除：觸控筆、滑鼠、鍵盤點一下即可；手指要長按約 0.7 秒（筆沒電或不在手邊時的逃生口），短按只提示做法。
// - 按鈕外層帶 data-ink-guard-exempt：鎖定時書寫區的手指輸入照樣被擋，唯獨這顆按鈕手指碰得到。
// - 鎖定中手指點書寫區被擋下時，按鈕會閃一下，告訴使用者為什麼沒反應、要從哪裡解除。
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Lock } from "@phosphor-icons/react";
import { toast } from "./ui";
import { hasSeenPen, setWritingMode, useWritingMode, WRITING_BLOCKED_EVENT } from "../lib/inkGuard";

export const LOCK_HOLD_MS = 700;

type InputKind = "pen" | "touch" | "mouse" | "keyboard";

// 全頁共用的提示節流（考試頁可能同時有好幾個演算紙工具列，不要一次跳好幾個提示）
let lastHintAt = 0;
let lastBlockedHintAt = 0;

export interface WritingLockControl {
  locked: boolean;
  /** 這台裝置用過觸控筆（書寫鎖定只能用筆開啟，沒用過筆的裝置不必顯示鎖頭） */
  penSeen: boolean;
  /** 手指正在長按解除（顯示進度圈） */
  holding: boolean;
  /** 每次手指被書寫鎖定擋下就加一（按鈕閃一下） */
  nudge: number;
  label: string;
  /** 套在按鈕外層（display: contents 的 span）上：記錄輸入種類、長按計時、豁免書寫鎖定 */
  bind: {
    "data-ink-guard-exempt": "";
    onPointerDownCapture: (e: ReactPointerEvent) => void;
    onPointerUpCapture: () => void;
    onPointerCancelCapture: () => void;
    onPointerLeave: () => void;
    onClickCapture: (e: MouseEvent) => void;
    onContextMenu: (e: MouseEvent) => void;
  };
  /** 按鈕的 onClick */
  onActivate: () => void;
}

export function useWritingLock(): WritingLockControl {
  const [locked] = useWritingMode();
  const lastPointer = useRef<{ kind: InputKind; at: number } | null>(null);
  const clickDetail = useRef(1);
  const holdTimer = useRef<number | undefined>(undefined);
  const holdDone = useRef(false);
  const [holding, setHolding] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [penSeen, setPenSeen] = useState(hasSeenPen);

  useEffect(() => {
    if (penSeen) return;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "pen") setPenSeen(true);
    };
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, [penSeen]);

  useEffect(() => {
    const onBlocked = () => {
      setNudge((n) => n + 1);
      // 按鈕閃一下之外，第一次（之後每分鐘最多一次）說明為什麼手指沒反應
      const now = Date.now();
      if (now - lastBlockedHintAt > 60_000) {
        lastBlockedHintAt = now;
        lastHintAt = now;
        toast("書寫鎖定中，手指操作已停用：用觸控筆點鎖頭，或用手指長按鎖頭約 1 秒解除");
      }
    };
    window.addEventListener(WRITING_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(WRITING_BLOCKED_EVENT, onBlocked);
  }, []);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const cancelHold = useCallback(() => {
    if (holdTimer.current === undefined) return;
    window.clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
    setHolding(false);
  }, []);

  const hint = useCallback((msg: string) => {
    const now = Date.now();
    if (now - lastHintAt < 2500) return;
    lastHintAt = now;
    toast(msg);
  }, []);

  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent) => {
      const kind: InputKind = e.pointerType === "pen" ? "pen" : e.pointerType === "touch" ? "touch" : "mouse";
      lastPointer.current = { kind, at: Date.now() };
      holdDone.current = false;
      if (!locked || kind !== "touch") return;
      cancelHold();
      setHolding(true);
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = undefined;
        holdDone.current = true;
        setHolding(false);
        setWritingMode(false);
        try {
          navigator.vibrate?.(12);
        } catch {
          /* 不支援震動 */
        }
        toast("已解除書寫鎖定");
      }, LOCK_HOLD_MS);
    },
    [locked, cancelHold],
  );

  const onActivate = useCallback(() => {
    cancelHold();
    if (holdDone.current) {
      holdDone.current = false;
      return;
    }
    const p = lastPointer.current;
    lastPointer.current = null;
    const kind: InputKind = p && Date.now() - p.at < 2000 ? p.kind : clickDetail.current === 0 ? "keyboard" : "mouse";
    if (!locked) {
      if (kind === "pen") setWritingMode(true);
      else hint("書寫鎖定要用觸控筆點才能開啟（避免沒有筆時手指被鎖住）");
      return;
    }
    if (kind === "touch") {
      hint("用觸控筆點一下即可解除；手邊沒有筆時，用手指長按鎖頭約 1 秒");
      return;
    }
    setWritingMode(false);
  }, [locked, cancelHold, hint]);

  const label = locked
    ? "書寫鎖定中（書寫區忽略手指）：用觸控筆或滑鼠點一下解除；只有手指時長按約 1 秒"
    : "書寫鎖定：用觸控筆點一下開啟，書寫區會忽略所有手指觸控（只能用觸控筆開啟）";

  return {
    locked,
    penSeen,
    holding,
    nudge,
    label,
    bind: {
      "data-ink-guard-exempt": "",
      onPointerDownCapture,
      onPointerUpCapture: cancelHold,
      onPointerCancelCapture: cancelHold,
      onPointerLeave: cancelHold,
      onClickCapture: (e) => {
        clickDetail.current = e.detail;
      },
      // iOS／Android 長按不要跳出選單
      onContextMenu: (e) => e.preventDefault(),
    },
    onActivate,
  };
}

/** 鎖頭圖示＋長按進度圈＋被擋下時的提示閃光 */
export function WritingLockGlyph({
  lock,
  size = 16,
  idleWeight = "regular",
}: {
  lock: Pick<WritingLockControl, "locked" | "holding" | "nudge">;
  size?: number;
  idleWeight?: "regular" | "duotone";
}) {
  return (
    <span className="writing-lock-glyph" aria-hidden="true">
      <Lock size={size} weight={lock.locked ? "fill" : idleWeight} />
      {lock.holding && (
        <svg className="writing-lock-hold" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10.5" pathLength={1} />
        </svg>
      )}
      {lock.locked && lock.nudge > 0 && <span key={lock.nudge} className="writing-lock-nudge" />}
    </span>
  );
}
