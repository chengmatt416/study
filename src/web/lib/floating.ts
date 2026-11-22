// 浮動卡片／視窗的擺放引擎：卡片永遠完整留在畫面裡，不會超出邊緣或被鍵盤、瀏海擋住。
//
// 擺放規則（computePlacement，純函式）：
// 1. 依偏好順序找「放得下」的那一邊（右、左、下、上…），放在錨點旁邊、不蓋住錨點。
// 2. 都放不下：選空間最大的那一邊，把卡片縮小（高度不夠就內部捲動、寬度縮到最小寬度）。
// 3. 連最小尺寸都放不下（錨點佔滿畫面）：改成疊在畫面裡、和錨點重疊最少的角落。
// 4. 錨點捲出畫面：卡片貼在最靠近錨點的畫面邊緣，不會跟著跑出去。
// 5. 最後一律夾回可用範圍（可用範圍已扣掉安全區、螢幕鍵盤與指定要避開的邊）。
// 6. 已經選好一邊之後，只要那一邊還放得下最小尺寸就不換邊（內容變長時卡片不會跳來跳去）。
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "right" | "left" | "bottom" | "top";
export type PlacedSide = Side | "overlay";

export interface PlacementInput {
  /** 卡片屬於哪個東西（畫面座標） */
  anchor: Rect;
  /** 卡片想要的大小（量到的實際大小，或還沒量到時的估計） */
  size: { width: number; height: number };
  /** 可用範圍（畫面座標） */
  viewport: Rect;
  /** 依序嘗試的方向 */
  prefer?: readonly Side[];
  /** 和錨點的距離 */
  gap?: number;
  /** 和可用範圍邊緣的距離 */
  margin?: number;
  minWidth?: number;
  minHeight?: number;
  /** 垂直方向（另一軸）怎麼對齊錨點 */
  align?: "start" | "center" | "end";
  /** 上一次選的方向：還放得下最小尺寸就沿用 */
  stickySide?: PlacedSide | null;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  /** 卡片最高可以多高（超過就內部捲動） */
  maxHeight: number;
  side: PlacedSide;
  /** 是否完整放下、沒有縮小也沒有蓋到錨點 */
  fits: boolean;
  /** 展開動畫的原點（相對卡片左上角） */
  origin: { x: number; y: number };
}

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.max(lo, Math.min(hi, v)));

const overlapArea = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** 把錨點夾進可用範圍：捲出畫面的錨點變成貼在邊緣的一條線，卡片就貼在那一邊 */
function clampAnchor(a: Rect, vp: Rect): Rect {
  const left = clamp(a.left, vp.left, vp.left + vp.width);
  const top = clamp(a.top, vp.top, vp.top + vp.height);
  const right = clamp(a.left + a.width, vp.left, vp.left + vp.width);
  const bottom = clamp(a.top + a.height, vp.top, vp.top + vp.height);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function computePlacement(input: PlacementInput): Placement {
  const margin = input.margin ?? 12;
  const gap = input.gap ?? 12;
  const prefer = input.prefer ?? ["right", "left", "bottom", "top"];
  const align = input.align ?? "start";
  const vp = input.viewport;
  const inner: Rect = {
    left: vp.left + margin,
    top: vp.top + margin,
    width: Math.max(0, vp.width - margin * 2),
    height: Math.max(0, vp.height - margin * 2),
  };
  const innerRight = inner.left + inner.width;
  const innerBottom = inner.top + inner.height;
  const a = clampAnchor(input.anchor, vp);
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;

  const wantW = Math.min(input.size.width, inner.width);
  const wantH = Math.min(input.size.height, inner.height);
  const minW = Math.min(input.minWidth ?? Math.min(240, wantW), wantW);
  const minH = Math.min(input.minHeight ?? Math.min(200, wantH), wantH);

  /** 每一邊在主軸上有多少空間 */
  const space: Record<Side, number> = {
    right: innerRight - (aRight + gap),
    left: a.left - gap - inner.left,
    bottom: innerBottom - (aBottom + gap),
    top: a.top - gap - inner.top,
  };
  const horizontal = (s: Side) => s === "right" || s === "left";
  const need = (s: Side) => (horizontal(s) ? wantW : wantH);
  const min = (s: Side) => (horizontal(s) ? minW : minH);

  let side: Side | null = null;
  let fits = false;
  // 6. 沿用上一次的方向
  if (input.stickySide && input.stickySide !== "overlay" && space[input.stickySide] >= min(input.stickySide)) {
    side = input.stickySide;
    fits = space[side] >= need(side);
  }
  // 1. 第一個放得下的方向
  if (!side) {
    for (const s of prefer) {
      if (space[s] >= need(s)) {
        side = s;
        fits = true;
        break;
      }
    }
  }
  // 2. 空間最大的方向（相對於需要的大小），至少要放得下最小尺寸
  if (!side) {
    let best: Side | null = null;
    let bestRatio = 0;
    for (const s of prefer) {
      if (space[s] < min(s)) continue;
      const ratio = space[s] / Math.max(1, need(s));
      if (ratio > bestRatio) {
        best = s;
        bestRatio = ratio;
      }
    }
    side = best;
  }

  const alignCross = (start: number, length: number, size: number, lo: number, hi: number): number => {
    const pos = align === "center" ? start + length / 2 - size / 2 : align === "end" ? start + length - size : start;
    return clamp(pos, lo, hi - size);
  };

  if (side) {
    let width = wantW;
    let height = wantH;
    let left: number;
    let top: number;
    if (horizontal(side)) {
      width = Math.min(wantW, Math.max(minW, space[side]));
      left = side === "right" ? aRight + gap : a.left - gap - width;
      top = alignCross(a.top, a.height, height, inner.top, innerBottom);
    } else {
      height = Math.min(wantH, Math.max(minH, space[side]));
      top = side === "bottom" ? aBottom + gap : a.top - gap - height;
      left = alignCross(a.left, a.width, width, inner.left, innerRight);
    }
    left = clamp(left, inner.left, innerRight - width);
    top = clamp(top, inner.top, innerBottom - height);
    const maxHeight = horizontal(side) ? inner.height : Math.max(minH, space[side]);
    // 動畫原點：靠錨點的那一邊
    const ax = clamp(a.left + a.width / 2 - left, 0, width);
    const ay = clamp(a.top + a.height / 2 - top, 0, height);
    const origin = side === "right" ? { x: 0, y: ay } : side === "left" ? { x: width, y: ay } : side === "bottom" ? { x: ax, y: 0 } : { x: ax, y: height };
    return { left, top, width, maxHeight: Math.min(maxHeight, innerBottom - top), side, fits, origin };
  }

  // 3. 疊在畫面裡：四個角落與四邊中間，選和錨點重疊最少的；一樣少就選離錨點中心最近的（看得出關聯）
  const width = wantW;
  const height = wantH;
  const xs = [inner.left, inner.left + (inner.width - width) / 2, innerRight - width];
  const ys = [inner.top, inner.top + (inner.height - height) / 2, innerBottom - height];
  const acx = a.left + a.width / 2;
  const acy = a.top + a.height / 2;
  let bestPos = { left: xs[2], top: ys[2] };
  let bestScore = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const rect = { left: x, top: y, width, height };
      const dist = Math.hypot(x + width / 2 - acx, y + height / 2 - acy);
      const score = overlapArea(rect, a) + dist * 0.01;
      if (score < bestScore) {
        bestScore = score;
        bestPos = { left: x, top: y };
      }
    }
  }
  return {
    left: bestPos.left,
    top: bestPos.top,
    width,
    maxHeight: Math.max(0, innerBottom - bestPos.top),
    side: "overlay",
    fits: false,
    origin: { x: clamp(acx - bestPos.left, 0, width), y: clamp(acy - bestPos.top, 0, height) },
  };
}

// ---------- 可用範圍 ----------

let safeProbe: HTMLDivElement | null = null;
function safeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
  if (typeof document === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!safeProbe) {
    safeProbe = document.createElement("div");
    safeProbe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(safeProbe);
  }
  const cs = getComputedStyle(safeProbe);
  const n = (v: string) => Number.parseFloat(v) || 0;
  return { top: n(cs.paddingTop), right: n(cs.paddingRight), bottom: n(cs.paddingBottom), left: n(cs.paddingLeft) };
}

/**
 * 畫面上真正能放東西的範圍：visualViewport（螢幕鍵盤彈出、雙指放大網頁時會變小）扣掉安全區（瀏海、Home 橫條），
 * 再扣掉指定要避開的邊（例如上方的工具列）。座標是 position: fixed 用的畫面座標。
 */
export function usableViewport(avoid: { top?: number; right?: number; bottom?: number; left?: number } = {}): Rect {
  if (typeof window === "undefined") return { left: 0, top: 0, width: 1024, height: 768 };
  const vv = window.visualViewport;
  const safe = safeAreaInsets();
  const full = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  // 鍵盤彈出時 visualViewport 變矮；網頁被雙指放大時（scale ≠ 1）fixed 元素的座標系不同，直接用整個視窗
  const base = vv && Math.abs(vv.scale - 1) < 0.01 ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height } : full;
  const left = Math.max(base.left, full.left + safe.left) + (avoid.left ?? 0);
  const top = Math.max(base.top, full.top + safe.top) + (avoid.top ?? 0);
  const right = Math.min(base.left + base.width, full.width - safe.right) - (avoid.right ?? 0);
  const bottom = Math.min(base.top + base.height, full.height - safe.bottom) - (avoid.bottom ?? 0);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// ---------- React ----------

export interface UseFloatingOptions {
  open: boolean;
  /** 錨點的畫面座標；用函式的話每次重新擺放都會重新取（錨點會跟著頁面捲動、縮放時用） */
  anchor: Rect | (() => Rect | null) | RefObject<HTMLElement | null>;
  /** 想要的寬度，與高度上限 */
  width: number;
  maxHeight?: number;
  /** 還沒量到卡片之前估計的高度 */
  estimateHeight?: number;
  prefer?: readonly Side[];
  gap?: number;
  margin?: number;
  minWidth?: number;
  minHeight?: number;
  align?: "start" | "center" | "end";
  /** 可用範圍要避開的邊（px） */
  avoid?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 錨點會自己移動（跟著捲動、縮放、動畫）：每個畫面都重新對位 */
  track?: boolean;
}

function resolveAnchor(anchor: UseFloatingOptions["anchor"]): Rect | null {
  if (typeof anchor === "function") return anchor();
  if (anchor && "current" in anchor) {
    const el = anchor.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  return anchor as Rect;
}

/**
 * 把一張 position: fixed 的卡片擺在錨點旁邊，並在視窗大小、捲動、螢幕鍵盤、卡片內容高度改變時重新擺放。
 * 用法：const f = useFloating({...}); <div ref={f.ref} style={f.style}>…</div>
 */
export function useFloating<T extends HTMLElement = HTMLDivElement>(opts: UseFloatingOptions) {
  const ref = useRef<T | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const sideRef = useRef<PlacedSide | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const place = useCallback(() => {
    const o = optsRef.current;
    const anchor = resolveAnchor(o.anchor);
    if (!anchor) return;
    const el = ref.current;
    const cap = o.maxHeight ?? Infinity;
    // 卡片自己的高度：內容被 maxHeight 截住時，用內容的完整高度（scrollHeight）判斷放不放得下
    const natural = el ? Math.max(el.offsetHeight, el.scrollHeight > el.clientHeight + 1 ? el.scrollHeight + (el.offsetHeight - el.clientHeight) : 0) : 0;
    const height = Math.min(cap, natural || o.estimateHeight || 320);
    const next = computePlacement({
      anchor,
      size: { width: o.width, height },
      viewport: usableViewport(o.avoid),
      prefer: o.prefer,
      gap: o.gap,
      margin: o.margin,
      minWidth: o.minWidth,
      minHeight: o.minHeight,
      align: o.align,
      stickySide: sideRef.current,
    });
    next.maxHeight = Math.min(next.maxHeight, cap);
    sideRef.current = next.side;
    setPlacement((prev) =>
      prev &&
      Math.abs(prev.left - next.left) < 0.5 &&
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.width - next.width) < 0.5 &&
      Math.abs(prev.maxHeight - next.maxHeight) < 0.5 &&
      prev.side === next.side
        ? prev
        : next,
    );
  }, []);

  const open = opts.open;
  const track = !!opts.track;
  useLayoutEffect(() => {
    if (!open) {
      sideRef.current = null;
      setPlacement(null);
      return;
    }
    place();
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (ref.current) {
      ro?.observe(ref.current);
      // 內容長高（例如 AI 邊寫邊長）：外層被 maxHeight 截住時大小不變，所以也看第一個子元素
      if (ref.current.firstElementChild) ro?.observe(ref.current.firstElementChild);
    }
    let trackRaf = 0;
    if (track) {
      const loop = () => {
        place();
        trackRaf = requestAnimationFrame(loop);
      };
      trackRaf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(trackRaf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      ro?.disconnect();
    };
  }, [open, track, place]);

  // 錨點或大小是從 props 來的：每次渲染後再對一次位（位置沒變就不會重新渲染）
  useLayoutEffect(() => {
    if (open) place();
  });

  // 第一次渲染（還沒量到）先用估計值算一次，卡片一出現就在畫面裡
  const initial = (): Placement | null => {
    const anchor = resolveAnchor(opts.anchor);
    if (!anchor) return null;
    return computePlacement({
      anchor,
      size: { width: opts.width, height: Math.min(opts.maxHeight ?? Infinity, opts.estimateHeight ?? 320) },
      viewport: usableViewport(opts.avoid),
      prefer: opts.prefer,
      gap: opts.gap,
      margin: opts.margin,
      minWidth: opts.minWidth,
      minHeight: opts.minHeight,
      align: opts.align,
    });
  };
  const p = placement ?? (open ? initial() : null);
  const style: CSSProperties = p
    ? {
        position: "fixed",
        left: p.left,
        top: p.top,
        width: p.width,
        maxHeight: Math.min(p.maxHeight, opts.maxHeight ?? Infinity),
        transformOrigin: `${p.origin.x}px ${p.origin.y}px`,
      }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };
  return { ref, style, placement: p, update: place };
}
