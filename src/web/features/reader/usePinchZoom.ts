// 放大縮小手勢：兩指捏合（觸控）、觸控板捏合 / Ctrl(⌘)+滾輪、雙擊放大。
// 手勢進行中以 CSS transform 即時預覽（只套在畫面附近的頁面，iPhone 上大型圖層才不會閃爍），放開後才以新倍率重新排版，
// 並以「頁面上的位置」為錨點還原捲動：手指/游標（或按鈕縮放時的畫面中心）下的那一點維持在原處。
// 頁與頁之間的間距不隨倍率縮放，所以不能只把捲動位置乘上倍率（越後面的頁差越多）。
// iPhone / iOS Safari 的處理重點：
// - touch-action: pan-x pan-y 無法阻止 iOS Safari 雙指縮放整頁並送出 pointercancel，因此觸控縮放改用 TouchEvent（passive: false）
//   搭配 gesturestart / gesturechange / gestureend preventDefault()，且在雙指碰觸時通知標注層取消進行中的單指筆跡。
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isPenActive, isWritingMode, presentTouches } from "../../lib/inkGuard";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 5;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface Options {
  zoom: number;
  onZoomChange?: (z: number) => void;
  /** 渲染倍率（變更後才調整捲動位置） */
  renderScale: number;
  view?: "single" | "spread";
}

/** A point on the book: which page, and where on it (0..1 across and down). */
export interface PageAnchor { index: number; u: number; v: number }
type Point = { fx: number; fy: number };

const pagesOf = (content: HTMLElement) => content.querySelectorAll<HTMLElement>(".pdf-page");

/** The page under a point of the scroll box (container coordinates), found by binary search on the page column. */
export function anchorAt(container: HTMLElement, content: HTMLElement, { fx, fy }: Point): PageAnchor | null {
  const pages = pagesOf(content);
  if (!pages.length) return null;
  const box = container.getBoundingClientRect();
  const x = box.left + fx, y = box.top + fy;
  let index = 0;
  if (pages.length > 4) {
    let lo = 0, hi = pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pages[mid].getBoundingClientRect().top <= y) lo = mid; else hi = mid - 1;
    }
    index = lo;
  } else {
    // Spread view: the pages sit side by side.
    let best = Infinity;
    pages.forEach((page, i) => { const r = page.getBoundingClientRect(); const d = Math.abs(x - (r.left + r.width / 2)) + Math.abs(y - (r.top + r.height / 2)); if (d < best) { best = d; index = i; } });
  }
  const r = pages[index].getBoundingClientRect();
  return { index, u: r.width ? (x - r.left) / r.width : 0.5, v: r.height ? (y - r.top) / r.height : 0 };
}

/** Scrolls so the anchored page point sits under the given point of the scroll box again. */
export function restoreAnchor(container: HTMLElement, content: HTMLElement, anchor: PageAnchor, { fx, fy }: Point) {
  const page = pagesOf(content)[anchor.index];
  if (!page) return;
  const box = container.getBoundingClientRect(), r = page.getBoundingClientRect();
  container.scrollLeft += r.left + anchor.u * r.width - (box.left + fx);
  container.scrollTop += r.top + anchor.v * r.height - (box.top + fy);
}

type MaybeStylusTouch = Touch & { touchType?: string };
const hasStylus = (touches: ArrayLike<Touch>) => {
  for (let i = 0; i < touches.length; i++) if ((touches[i] as MaybeStylusTouch).touchType === "stylus") return true;
  return false;
};

export interface PinchZoomBindings {
  getZoom: () => number;
  onZoomChange: (z: number) => void;
  getContent: () => HTMLElement | null;
  pending: { current: { anchor: PageAnchor | null; at: Point } | null };
  previewed: { current: HTMLElement[] };
  settleTimer: { current: number };
  clearPreview: () => void;
  remember: () => void;
  supportsTouch?: boolean;
}

/** Attaches pinch-zoom, double-tap zoom, and trackpad/wheel zoom listeners to `el` and returns a cleanup function. */
export function bindPinchZoom(el: HTMLElement, { getZoom, onZoomChange, getContent, pending, previewed, settleTimer, clearPreview, remember, supportsTouch }: PinchZoomBindings): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { startZoom: number; dist: number; start: Point; at: Point; ratio: number; anchor: PageAnchor | null; scrollStart: { left: number; top: number } } | null = null;
  let wheel: { startZoom: number; at: Point; ratio: number; anchor: PageAnchor | null; timer: number } | null = null;
  let tap: { x: number; y: number; t: number; moved: boolean; eligible: boolean } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let postPinch = false;

  const local = (x: number, y: number): Point => { const r = el.getBoundingClientRect(); return { fx: x - r.left, fy: y - r.top }; };
  const anchorFor = (at: Point) => { const c = getContent(); return c ? anchorAt(el, c, at) : null; };
  /** Pages within a screen of the viewport get the preview transform; far pages are blank and need none. */
  const nearbyPages = () => {
    const c = getContent();
    if (!c) return [];
    const box = el.getBoundingClientRect();
    return [...pagesOf(c)].filter((page) => { const r = page.getBoundingClientRect(); return r.bottom > box.top - box.height && r.top < box.bottom + box.height; });
  };
  const preview = (start: Point, ratio: number, dx: number, dy: number) => {
    if (!previewed.current.length) previewed.current = nearbyPages();
    const box = el.getBoundingClientRect();
    for (const page of previewed.current) {
      const r = page.getBoundingClientRect();
      // 每頁以自己的座標表示同一個縮放中心（預覽前量測：transform 會改變量到的位置，所以只在第一次量）
      if (!page.dataset.zoomOrigin) page.dataset.zoomOrigin = `${box.left + start.fx - r.left}px ${box.top + start.fy - r.top}px`;
      page.style.transformOrigin = page.dataset.zoomOrigin;
      page.style.transform = `translate(${dx}px, ${dy}px) scale(${ratio})`;
    }
  };
  const commit = (startZoom: number, ratio: number, anchor: PageAnchor | null, at: Point) => {
    const next = clamp(startZoom * ratio);
    if (Math.abs(next - getZoom()) < 0.005) {
      // 倍率沒變（已到上下限）：只套用手指的平移
      clearPreview();
      const c = getContent();
      if (anchor && c) restoreAnchor(el, c, anchor, at);
      remember();
      return;
    }
    pending.current = { anchor, at };
    onZoomChange(next);
    // 父元件若沒有改倍率，不要讓預覽卡住
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => { if (pending.current) { pending.current = null; clearPreview(); } }, 1200);
  };
  const twoPoints = (ax: number, ay: number, bx: number, by: number) => ({
    d: Math.hypot(ax - bx, ay - by) || 1,
    at: local((ax + bx) / 2, (ay + by) / 2),
  });
  const startTouchPinch = (a: Touch, b: Touch) => {
    const { d, at } = twoPoints(a.clientX, a.clientY, b.clientX, b.clientY);
    pinch = {
      startZoom: getZoom(),
      dist: d,
      start: at,
      at,
      ratio: 1,
      anchor: anchorFor(at),
      scrollStart: { left: el.scrollLeft, top: el.scrollTop },
    };
    postPinch = true;
    tap = null;
    lastTap = null;
    if (typeof CustomEvent === "function") el.dispatchEvent(new CustomEvent("reader-pinch-start"));
  };
  const canDoubleTapTarget = (target: EventTarget | null) => {
    const element = target as Element | null;
    return !element?.closest?.("[data-ink],button,a,[role=button]");
  };

  // Safari (iPhone / iPad / macOS trackpad) fires proprietary GestureEvents that zoom the whole viewport unless prevented.
  const blockGesture = (e: Event) => { if (e.cancelable) e.preventDefault(); };

  // 被防誤觸丟掉的手掌不算手指（手掌放著時另一隻手照樣能縮放，也不會把手掌加一指當成捏合）
  const ft = (e: TouchEvent) => presentTouches(e.touches);
  const onTouchStart = (e: TouchEvent) => {
    if (isPenActive() || isWritingMode() || hasStylus(e.touches)) {
      if (pinch) { clearPreview(); pinch = null; }
      return;
    }
    if (ft(e).length >= 2) {
      if (e.cancelable) e.preventDefault();
      tap = null;
      lastTap = null;
      postPinch = true;
      if (!pinch && !pending.current && ft(e).length === 2) startTouchPinch(ft(e)[0], ft(e)[1]);
      return;
    }
    if (ft(e).length === 1) {
      tap = { x: ft(e)[0].clientX, y: ft(e)[0].clientY, t: performance.now(), moved: false, eligible: canDoubleTapTarget(e.target) };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    if (isPenActive() || isWritingMode() || hasStylus(e.touches)) return;
    if (ft(e).length >= 2 || pinch || postPinch) {
      if (e.cancelable) e.preventDefault();
    }
    if (!pinch && !pending.current && ft(e).length === 2) {
      startTouchPinch(ft(e)[0], ft(e)[1]);
      return;
    }
    if (pinch && ft(e).length >= 2) {
      const a = ft(e)[0], b = ft(e)[1];
      const { d, at } = twoPoints(a.clientX, a.clientY, b.clientX, b.clientY);
      const dsx = el.scrollLeft - pinch.scrollStart.left;
      const dsy = el.scrollTop - pinch.scrollStart.top;
      pinch.ratio = clamp(pinch.startZoom * (d / pinch.dist)) / pinch.startZoom;
      pinch.at = at;
      preview(pinch.start, pinch.ratio, at.fx - pinch.start.fx + dsx, at.fy - pinch.start.fy + dsy);
      return;
    }
    if (tap && ft(e).length === 1 && Math.hypot(ft(e)[0].clientX - tap.x, ft(e)[0].clientY - tap.y) > 10) {
      tap.moved = true;
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (pinch && ft(e).length < 2) {
      if (e.cancelable) e.preventDefault();
      commit(pinch.startZoom, pinch.ratio, pinch.anchor, pinch.at);
      pinch = null;
      postPinch = ft(e).length > 0;
      tap = null;
      lastTap = null;
      return;
    }
    if (ft(e).length === 0) {
      if (postPinch) {
        postPinch = false;
        if (e.cancelable) e.preventDefault();
        tap = null;
        lastTap = null;
        return;
      }
      if (e.type === "touchend" && tap && !tap.moved && tap.eligible && !pending.current && !isPenActive() && !isWritingMode() && !hasStylus(e.changedTouches)) {
        const now = performance.now();
        if (now - tap.t < 280) {
          if (lastTap && now - lastTap.t < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 32) {
            if (e.cancelable) e.preventDefault();
            const at = local(tap.x, tap.y);
            const target = getZoom() > 1.05 ? 1 : 2;
            commit(getZoom(), target / getZoom(), anchorFor(at), at);
            lastTap = null;
          } else {
            lastTap = { t: now, x: tap.x, y: tap.y };
          }
        } else {
          lastTap = null;
        }
      } else if (e.type === "touchcancel" || tap?.moved) {
        lastTap = null;
      }
      tap = null;
    }
  };

  // Fallback for environments that fire touch PointerEvents without TouchEvents.
  const twoPointers = () => {
    const [a, b] = [...pointers.values()];
    return twoPoints(a.x, a.y, b.x, b.y);
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || isPenActive() || isWritingMode()) return; // 書寫中的手掌不觸發縮放/雙擊
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && !pending.current) {
      const { d, at } = twoPointers();
      pinch = { startZoom: getZoom(), dist: d, start: at, at, ratio: 1, anchor: anchorFor(at), scrollStart: { left: el.scrollLeft, top: el.scrollTop } };
      lastTap = null;
      if (typeof CustomEvent === "function") el.dispatchEvent(new CustomEvent("reader-pinch-start"));
    } else if (pointers.size === 1 && canDoubleTapTarget(e.target)) {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30 && !pending.current) {
        const at = local(e.clientX, e.clientY);
        const target = getZoom() > 1.05 ? 1 : 2;
        commit(getZoom(), target / getZoom(), anchorFor(at), at);
        lastTap = null;
      } else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  };
  const move = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const { d, at } = twoPointers();
      const dsx = el.scrollLeft - pinch.scrollStart.left;
      const dsy = el.scrollTop - pinch.scrollStart.top;
      pinch.ratio = clamp(pinch.startZoom * (d / pinch.dist)) / pinch.startZoom;
      pinch.at = at;
      preview(pinch.start, pinch.ratio, at.fx - pinch.start.fx + dsx, at.fy - pinch.start.fy + dsy);
    }
  };
  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      commit(pinch.startZoom, pinch.ratio, pinch.anchor, pinch.at);
      pinch = null;
    }
  };

  // 觸控板捏合會送出 ctrlKey 的 wheel 事件；滑鼠則是 Ctrl/⌘ + 滾輪
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (pending.current || pinch) return;
    const at = local(e.clientX, e.clientY);
    if (!wheel) wheel = { startZoom: getZoom(), at, ratio: 1, anchor: anchorFor(at), timer: 0 };
    wheel.ratio = clamp(wheel.startZoom * wheel.ratio * Math.exp(-e.deltaY * 0.01)) / wheel.startZoom;
    preview(wheel.at, wheel.ratio, 0, 0);
    window.clearTimeout(wheel.timer);
    wheel.timer = window.setTimeout(() => {
      if (!wheel) return;
      commit(wheel.startZoom, wheel.ratio, wheel.anchor, wheel.at);
      wheel = null;
    }, 160);
  };

  const hasTouch = supportsTouch ?? (typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0));
  el.addEventListener("gesturestart", blockGesture, { passive: false });
  el.addEventListener("gesturechange", blockGesture, { passive: false });
  el.addEventListener("gestureend", blockGesture, { passive: false });
  if (hasTouch) {
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });
  } else {
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  el.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    el.removeEventListener("gesturestart", blockGesture);
    el.removeEventListener("gesturechange", blockGesture);
    el.removeEventListener("gestureend", blockGesture);
    if (hasTouch) {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    } else {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    }
    el.removeEventListener("wheel", onWheel);
    if (wheel) window.clearTimeout(wheel.timer);
    clearPreview();
  };
}

export function usePinchZoom(container: RefObject<HTMLDivElement | null>, content: RefObject<HTMLDivElement | null>, { zoom, onZoomChange, renderScale, view }: Options) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 待套用的還原：錨點，以及放開時它應該在的位置（容器座標）
  const pending = useRef<{ anchor: PageAnchor | null; at: Point } | null>(null);
  // 畫面中心目前看到的位置，按鈕/鍵盤縮放時用它當錨點（縮放前就要知道）
  const centre = useRef<PageAnchor | null>(null);
  const previewed = useRef<HTMLElement[]>([]);
  const settleTimer = useRef(0);

  const clearPreview = () => {
    for (const el of previewed.current) {
      el.style.transform = "";
      el.style.transformOrigin = "";
      delete el.dataset.zoomOrigin;
    }
    previewed.current = [];
    window.clearTimeout(settleTimer.current);
  };
  const remember = () => {
    const el = container.current, c = content.current;
    if (el && c) centre.current = anchorAt(el, c, { fx: el.clientWidth / 2, fy: el.clientHeight / 2 });
  };

  const prev = useRef({ scale: renderScale, view });
  useLayoutEffect(() => {
    const el = container.current, c = content.current;
    const before = prev.current;
    prev.current = { scale: renderScale, view };
    if (!el || !c) return;
    // 切換單/雙頁時由檢視器自己定位到同一頁，這裡不做縮放補償
    if (before.view !== view) { clearPreview(); pending.current = null; remember(); return; }
    if (before.scale === renderScale && !pending.current) return;
    const target = pending.current ?? { anchor: centre.current, at: { fx: el.clientWidth / 2, fy: el.clientHeight / 2 } };
    pending.current = null;
    // 先拿掉預覽再量測，同一個畫格內完成，放開手指時不會閃回舊大小
    clearPreview();
    if (target.anchor) restoreAnchor(el, c, target.anchor, target.at);
    remember();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderScale, view, container, content]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!previewed.current.length) remember(); }); };
    el.addEventListener("scroll", onScroll, { passive: true });
    remember();
    return () => { el.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, content, view]);

  useEffect(() => {
    const el = container.current;
    if (!el || !onZoomChange) return;
    return bindPinchZoom(el, {
      getZoom: () => zoomRef.current,
      onZoomChange,
      getContent: () => content.current,
      pending,
      previewed,
      settleTimer,
      clearPreview,
      remember,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container, content, onZoomChange, view]);
}
