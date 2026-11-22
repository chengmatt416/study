// 手寫防誤觸（全站共用）。判斷規則在 mistouch.ts，這裡負責攔截事件：
// - 每個手指／手掌接觸落下時判斷一次要不要丟掉；丟掉的接觸到它離開螢幕為止都不算
//   （不畫、不捲動、不縮放、不點擊），筆抬起來換行時還放著的手掌也不會動到頁面。
// - 筆落下時，已經在螢幕上的接觸追溯丟掉，並通知編輯器取消那個接觸正在做的事（INK_GUARD_CANCEL_EVENT）。
// - 觸控筆自己點在按鈕、選單上（不是書寫面）不攔：筆可以直接點按鈕。
// - 標有 data-ink 的書寫面上，觸控筆本身的觸控不會觸發捲動（Android / Chrome 的 stylus 預設會平移）。
// - 書寫鎖定：書寫區內忽略所有手指輸入，只接受觸控筆與滑鼠。
// 在 capture 階段登記在 window 上，所以不受元件是否 stopPropagation 影響。
import { useSyncExternalStore } from "react";
import { judgeOnPenDown, judgeTouch, type GuardLevel, type PenState, type RejectReason } from "./mistouch";

let installed = false;

const readKey = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeKey = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 無痕模式 */
  }
};

// ---------- 筆的狀態 ----------
const pen: PenState = { down: false, x: 0, y: 0, lastContactAt: 0, lastHoverAt: 0 };
/** 這台裝置用過觸控筆（書寫鎖定只能用筆開啟；沒見過筆的裝置不會被鎖） */
const PEN_SEEN_KEY = "ink-pen-seen";
let penSeen = readKey(PEN_SEEN_KEY) === "1";
/** 最近一次用筆的時間（Date.now；書寫鎖定的提示用） */
let lastPenAt = 0;

export const isPenActive = () => pen.down;
export const hasSeenPen = () => penSeen;

// ---------- 防誤觸強度 ----------
const LEVEL_KEY = "ink-guard-level";
const levelSubs = new Set<() => void>();
const parseLevel = (v: string | null): GuardLevel => (v === "off" || v === "strict" ? v : "standard");
let level: GuardLevel = parseLevel(readKey(LEVEL_KEY));

export const getGuardLevel = (): GuardLevel => level;
export function setGuardLevel(next: GuardLevel) {
  level = next;
  writeKey(LEVEL_KEY, next);
  levelSubs.forEach((f) => f());
}
export function useGuardLevel(): [GuardLevel, (v: GuardLevel) => void] {
  const v = useSyncExternalStore(
    (cb) => (levelSubs.add(cb), () => levelSubs.delete(cb)),
    () => level,
    () => "standard" as GuardLevel,
  );
  return [v, setGuardLevel];
}

// ---------- 書寫模式：書寫區內忽略所有手指輸入（不畫、不捲動、不縮放、不翻頁、不點擊），只接受觸控筆與滑鼠 ----------
const WM_KEY = "ink-writing-mode";
let writingMode = readKey(WM_KEY) === "1";
// 逃生口：這台裝置從沒用過觸控筆卻處於鎖定（例如更新前用手指誤開），手指會什麼都點不到——直接解除
if (writingMode && !penSeen) {
  writingMode = false;
  writeKey(WM_KEY, "0");
}
const subs = new Set<() => void>();
const applyAttr = () => typeof document !== "undefined" && document.documentElement.toggleAttribute("data-writing-mode", writingMode);
applyAttr();

export const isWritingMode = () => writingMode;
export function setWritingMode(v: boolean) {
  writingMode = v;
  writeKey(WM_KEY, v ? "1" : "0");
  applyAttr();
  subs.forEach((f) => f());
}
export function useWritingMode(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => writingMode,
    () => false,
  );
  return [v, setWritingMode];
}

// 標 data-ink-guard-exempt 的元件（書寫鎖定按鈕）不受書寫鎖定與防誤觸影響：手指永遠碰得到解除鍵
const isExempt = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-ink-guard-exempt]");
const inZone = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-ink-zone]") && !t.closest("[data-ink-guard-exempt]");
/** 落在書寫區的頁面上（不是書寫區裡的按鈕、面板、輸入框） */
const onInkSurface = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("[data-ink-zone]") && !t.closest("[data-ink-ui],button,a,input,textarea,select,[role=button],[role=dialog],[role=menu]");

/** 書寫鎖定擋下手指時通知鎖定按鈕提示使用者（正在用筆寫字時手掌碰到不算，不提示） */
export const WRITING_BLOCKED_EVENT = "ink-writing-blocked";
let lastBlockedNotice = 0;
function noticeBlocked() {
  const now = Date.now();
  if (now - lastPenAt < 8000 || now - lastBlockedNotice < 2500) return;
  lastBlockedNotice = now;
  window.dispatchEvent(new CustomEvent(WRITING_BLOCKED_EVENT));
}

// ---------- 被丟掉的接觸 ----------

/**
 * 筆落下時追溯丟掉了一些已經在螢幕上的接觸：detail.pointerIds 是它們的 pointerId。
 * 編輯器收到後要取消那些接觸正在做的事（手指畫到一半的筆畫、捏合縮放）。
 */
export const INK_GUARD_CANCEL_EVENT = "ink-guard-cancel";

interface LiveTouch {
  pointerId: number;
  x: number;
  y: number;
  radius: number;
  startedAt: number;
  onInk: boolean;
  exempt: boolean;
  rejected: RejectReason | null;
}
/** 螢幕上的手指／手掌接觸（以 pointerId 為鍵） */
const live = new Map<number, LiveTouch>();
/** 被丟掉的 Touch.identifier（touch 事件用；和 pointerId 是兩套編號，用落點對應） */
const rejectedTouchIds = new Set<number>();
/** 剛被丟掉的接觸離開螢幕的位置與時間：擋掉它可能產生的點擊 */
let lastRejectedEnd = { x: 0, y: 0, at: 0 };

/** 這個 Touch 是不是被防誤觸丟掉的（手掌）。自己處理 touch 事件的元件用它過濾 e.touches */
export const isRejectedTouch = (t: Touch): boolean => rejectedTouchIds.has(t.identifier);
/** 螢幕上算數的接觸：手指與觸控筆，不含被丟掉的手掌 */
export function presentTouches(list: ArrayLike<Touch>): Touch[] {
  const out: Touch[] = [];
  for (let i = 0; i < list.length; i++) if (!rejectedTouchIds.has(list[i].identifier)) out.push(list[i]);
  return out;
}
/** 沒被丟掉的手指（也不含觸控筆自己的觸控） */
export function realFingers(list: TouchList): Touch[] {
  const out: Touch[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!rejectedTouchIds.has(t.identifier) && !isStylus(t)) out.push(t);
  }
  return out;
}

function isStylus(t: Touch) {
  return (t as Touch & { touchType?: string }).touchType === "stylus";
}

function findLiveAt(x: number, y: number): LiveTouch | null {
  let best: LiveTouch | null = null;
  let bestD = 6;
  for (const lt of live.values()) {
    const d = Math.hypot(lt.x - x, lt.y - y);
    if (d < bestD) {
      best = lt;
      bestD = d;
    }
  }
  return best;
}

export function installInkGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const swallow = (e: Event, preventDefault = true) => {
    e.stopImmediatePropagation();
    if (preventDefault && e.cancelable) e.preventDefault();
  };

  // ----- 觸控筆 -----
  const penDown = (e: PointerEvent) => {
    pen.down = true;
    pen.x = e.clientX;
    pen.y = e.clientY;
    lastPenAt = Date.now();
    if (!penSeen) {
      penSeen = true;
      writeKey(PEN_SEEN_KEY, "1");
    }
    // 第一次偵測到觸控筆：全站預設「只用觸控筆書寫」（使用者手動關閉後會記住選擇）
    if (readKey("ink-pen-only") === null) {
      writeKey("ink-pen-only", "1");
      window.dispatchEvent(new CustomEvent("ink-pen-seen"));
    }
    // 筆落下時已經在螢幕上的接觸：追溯丟掉（先放手掌再下筆）
    const now = performance.now();
    const cancelled: number[] = [];
    for (const lt of live.values()) {
      if (lt.rejected || lt.exempt) continue;
      if (judgeOnPenDown({ x: lt.x, y: lt.y, radius: lt.radius, onInkSurface: lt.onInk, startedAt: lt.startedAt }, pen, now, level)) {
        lt.rejected = "pen-down";
        cancelled.push(lt.pointerId);
      }
    }
    if (cancelled.length) window.dispatchEvent(new CustomEvent(INK_GUARD_CANCEL_EVENT, { detail: { pointerIds: cancelled } }));
  };
  const penUp = () => {
    pen.down = false;
    pen.lastContactAt = performance.now();
    lastPenAt = Date.now();
  };

  // ----- 指標事件：手指／手掌在抵達任何元件之前先判斷 -----
  const onPointer = (e: PointerEvent) => {
    const type = e.type;
    if (e.pointerType === "pen") {
      if (type === "pointerdown") penDown(e);
      else if (type === "pointerup" || type === "pointercancel") penUp();
      else if (type === "pointermove") {
        pen.x = e.clientX;
        pen.y = e.clientY;
        if (e.buttons === 0) pen.lastHoverAt = performance.now();
      }
      return;
    }
    if (e.pointerType !== "touch") return;

    if (type === "pointerdown") {
      const now = performance.now();
      const exempt = isExempt(e.target);
      const surface = onInkSurface(e.target);
      const radius = Math.max(e.width || 0, e.height || 0) / 2;
      const verdict = exempt ? ({ reject: false } as const) : judgeTouch({ x: e.clientX, y: e.clientY, radius, onInkSurface: surface }, pen, now, level);
      live.set(e.pointerId, {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        radius,
        startedAt: now,
        onInk: surface,
        exempt,
        rejected: verdict.reject ? verdict.reason : null,
      });
      if (verdict.reject) return swallow(e);
    } else {
      const lt = live.get(e.pointerId);
      if (lt) {
        if (type === "pointermove") {
          lt.x = e.clientX;
          lt.y = e.clientY;
          // 接觸面在按下之後才變大（手掌慢慢貼上去）：書寫中就改判成手掌
          const radius = Math.max(e.width || 0, e.height || 0) / 2;
          if (radius > lt.radius) lt.radius = radius;
        }
        const ended = type === "pointerup" || type === "pointercancel";
        if (ended) live.delete(e.pointerId);
        if (lt.rejected) {
          if (ended) lastRejectedEnd = { x: e.clientX, y: e.clientY, at: performance.now() };
          return swallow(e, !ended);
        }
      }
    }

    // 書寫鎖定：書寫區內的手指完全無效
    if (writingMode && inZone(e.target)) {
      swallow(e, type !== "pointerup" && type !== "pointercancel");
      if (type === "pointerdown") noticeBlocked();
    }
  };
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const) window.addEventListener(type, onPointer, true);

  // ----- 點擊：書寫鎖定，以及被丟掉的接觸可能產生的點擊 -----
  const onClick = (e: Event) => {
    const me = e as PointerEvent;
    const pt = me.pointerType;
    if (writingMode && inZone(e.target) && pt === "touch") return swallow(e);
    if (pt === "touch" || pt === "" || pt === undefined) {
      const since = performance.now() - lastRejectedEnd.at;
      if (since < 700 && Math.hypot(me.clientX - lastRejectedEnd.x, me.clientY - lastRejectedEnd.y) < 30 && !isExempt(e.target)) swallow(e);
    }
  };
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onClick, true);

  window.addEventListener("blur", () => {
    pen.down = false;
    live.clear();
    rejectedTouchIds.clear();
  });

  // ----- touch 事件：擋住瀏覽器自己的捲動、縮放與合成點擊 -----
  // 這次觸控是不是觸控筆自己的：Safari 有 touchType；沒有的瀏覽器用「和剛才筆的 pointerdown 同一點」判斷
  const isPenTouch = (t: Touch) => {
    const type = (t as Touch & { touchType?: string }).touchType;
    if (type !== undefined) return type === "stylus";
    return pen.down && Math.abs(t.clientX - pen.x) < 3 && Math.abs(t.clientY - pen.y) < 3;
  };
  const onTouch = (e: TouchEvent) => {
    const changed = [...e.changedTouches];
    // 用落點把 Touch.identifier 對應到剛才判斷過的 pointer
    if (e.type === "touchstart") {
      // 螢幕上只有這次新落下的接觸：之前沒收到結束事件的舊紀錄可以清掉
      if (e.touches.length === changed.length) {
        const now = performance.now();
        for (const [id, lt] of live) if (now - lt.startedAt > 400) live.delete(id);
      }
      for (const t of changed) {
        if (isPenTouch(t)) continue;
        if (findLiveAt(t.clientX, t.clientY)?.rejected) rejectedTouchIds.add(t.identifier);
      }
    } else {
      // 追溯丟掉的接觸（筆落下時）：之後的事件才知道
      for (const t of changed) {
        if (!rejectedTouchIds.has(t.identifier) && !isPenTouch(t) && findLiveAt(t.clientX, t.clientY)?.rejected) rejectedTouchIds.add(t.identifier);
      }
    }
    const ended = e.type === "touchend" || e.type === "touchcancel";
    const allChangedRejected = changed.length > 0 && changed.every((t) => rejectedTouchIds.has(t.identifier));
    if (ended) for (const t of changed) if (rejectedTouchIds.has(t.identifier)) queueMicrotask(() => rejectedTouchIds.delete(t.identifier));
    if (allChangedRejected) {
      // 手掌的事件：不給任何元件，也不讓瀏覽器捲動、縮放或產生點擊
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (!e.cancelable) return;

    const onInk = e.target instanceof Element && !!e.target.closest("[data-ink]");
    const stylus = [...e.touches, ...changed].some(isStylus);
    // 筆尖點在按鈕、選單等介面上（不是書寫面）：放行，瀏覽器才會產生 click，筆可以直接點按鈕
    const ownPenTap = !onInk && changed.length > 0 && changed.every(isPenTouch);
    if (ownPenTap) return;
    if (pen.down || (onInk && stylus)) return void e.preventDefault();
    // 書寫模式：書寫區內的手指觸控完全無效（連同之後的合成點擊）
    if (writingMode && !stylus && inZone(e.target)) e.preventDefault();
  };
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const)
    window.addEventListener(type, onTouch, { passive: false, capture: true });

  // 觸控板/瀏覽器縮放手勢
  window.addEventListener(
    "wheel",
    (e) => {
      if (writingMode && e.ctrlKey && inZone(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { passive: false, capture: true },
  );
  // iOS：書寫時不要出現長按選字/放大鏡/縮放手勢
  document.addEventListener("selectstart", (e) => pen.down && e.preventDefault());
  document.addEventListener("gesturestart", (e) => (pen.down || (writingMode && inZone(e.target))) && e.preventDefault());
  document.addEventListener("gesturechange", (e) => (pen.down || (writingMode && inZone(e.target))) && e.preventDefault());
}
installInkGuard();
