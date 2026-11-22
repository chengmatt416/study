import { afterEach, describe, expect, it, vi } from "vitest";

const inkState = { penActive: false, writingMode: false };
vi.mock("../src/web/lib/inkGuard", () => ({
  isPenActive: () => inkState.penActive,
  isWritingMode: () => inkState.writingMode,
  // 防誤觸沒有丟掉任何接觸：所有觸控都算數
  presentTouches: (list: ArrayLike<Touch>) => Array.from(list),
}));

import { bindPinchZoom, MAX_ZOOM, MIN_ZOOM, type PageAnchor } from "../src/web/features/reader/usePinchZoom";

type ListenerEntry = { fn: EventListener; options?: AddEventListenerOptions };

class FakeTarget {
  listeners = new Map<string, ListenerEntry[]>();

  addEventListener(type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    const handler = typeof fn === "function" ? fn : fn.handleEvent.bind(fn);
    const list = this.listeners.get(type) ?? [];
    list.push({ fn: handler, options: typeof options === "boolean" ? { capture: options } : options });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: EventListenerOrEventListenerObject) {
    const handler = typeof fn === "function" ? fn : fn.handleEvent.bind(fn);
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(type, list.filter((item) => item.fn !== handler));
  }

  dispatchEvent(event: { type: string; cancelable?: boolean; defaultPrevented?: boolean; preventDefault?: () => void }) {
    if (event.defaultPrevented === undefined) event.defaultPrevented = false;
    if (!event.preventDefault) {
      event.preventDefault = () => {
        if (event.cancelable !== false) event.defaultPrevented = true;
      };
    }
    for (const { fn } of [...(this.listeners.get(event.type) ?? [])]) {
      fn(event as unknown as Event);
    }
    return !event.defaultPrevented;
  }
}

function createFakePage(top = 0, width = 360, height = 500) {
  return {
    style: { transform: "", transformOrigin: "" },
    dataset: {} as Record<string, string>,
    getBoundingClientRect: () => ({ left: 10, top, width, height, right: 10 + width, bottom: top + height }),
  };
}

function createHarness(initialZoom = 1, supportsTouch = true) {
  const fakeWindow = new FakeTarget() as FakeTarget & {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
  fakeWindow.setTimeout = globalThis.setTimeout.bind(globalThis);
  fakeWindow.clearTimeout = globalThis.clearTimeout.bind(globalThis);
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal(
    "CustomEvent",
    class MockCustomEvent {
      type: string;
      detail: unknown;
      cancelable = false;
      defaultPrevented = false;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
      preventDefault() {}
    },
  );

  const page = createFakePage();
  const content = { querySelectorAll: () => [page] };
  const container = Object.assign(new FakeTarget(), {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 380,
    clientHeight: 700,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 380, height: 700, right: 380, bottom: 700 }),
  });

  let zoom = initialZoom;
  const zooms: number[] = [];
  const pinchStartEvents: string[] = [];
  container.addEventListener("reader-pinch-start", (e) => pinchStartEvents.push(e.type));

  const pending = { current: null as { anchor: PageAnchor | null; at: { fx: number; fy: number } } | null };
  const previewed = { current: [] as HTMLElement[] };
  const settleTimer = { current: 0 };
  const clearPreview = () => {
    for (const el of previewed.current) {
      el.style.transform = "";
      el.style.transformOrigin = "";
      delete el.dataset.zoomOrigin;
    }
    previewed.current = [];
  };

  const cleanup = bindPinchZoom(container as unknown as HTMLElement, {
    getZoom: () => zoom,
    onZoomChange: (next) => {
      zoom = next;
      zooms.push(next);
      // 模擬 React commit 完成後清除 pending 與 preview
      pending.current = null;
      clearPreview();
    },
    getContent: () => content as unknown as HTMLElement,
    pending,
    previewed,
    settleTimer,
    clearPreview,
    remember: () => {},
    supportsTouch,
  });

  return { container, fakeWindow, page, zooms, pinchStartEvents, pending, previewed, clearPreview, cleanup, getZoom: () => zoom };
}

function touchList(points: Array<{ x: number; y: number; touchType?: string }>) {
  return points.map((p, i) => ({ identifier: i + 1, clientX: p.x, clientY: p.y, touchType: p.touchType }));
}

function makeTarget(selectorMatch = false) {
  return { closest: () => (selectorMatch ? {} : null) };
}

afterEach(() => {
  inkState.penActive = false;
  inkState.writingMode = false;
  vi.useRealTimers();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
});

describe("bindPinchZoom (iPhone & touch pinch)", () => {
  it("registers non-passive touch & Safari gesture listeners and blocks native Safari gesture zoom", () => {
    const h = createHarness();
    expect(h.container.listeners.get("touchstart")?.[0]?.options?.passive).toBe(false);
    expect(h.container.listeners.get("touchmove")?.[0]?.options?.passive).toBe(false);
    expect(h.container.listeners.get("gesturestart")?.[0]?.options?.passive).toBe(false);

    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      const evt = { type, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      h.container.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(true);
    }
    h.cleanup();
  });

  it("handles two-finger TouchEvent pinch, compensates scroll offset during preview, emits reader-pinch-start, and commits zoom", () => {
    const h = createHarness(1);
    const startEvt = {
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 100, y: 200 }, { x: 200, y: 200 }]),
      changedTouches: touchList([{ x: 200, y: 200 }]),
      target: makeTarget(false),
    };
    expect(h.container.dispatchEvent(startEvt)).toBe(false);
    expect(h.pinchStartEvents).toEqual(["reader-pinch-start"]);

    // 模擬捏合中 scrollLeft/scrollTop 因容器慣性或回彈位移，preivew 應補回 dsx/dsy
    h.container.scrollLeft = 12;
    h.container.scrollTop = -8;
    const moveEvt = {
      type: "touchmove",
      cancelable: true,
      touches: touchList([{ x: 50, y: 210 }, { x: 250, y: 210 }]),
      changedTouches: touchList([{ x: 50, y: 210 }, { x: 250, y: 210 }]),
      target: makeTarget(false),
    };
    expect(h.container.dispatchEvent(moveEvt)).toBe(false);
    expect(h.page.style.transform).toBe("translate(12px, 2px) scale(2)");
    expect(h.page.dataset.zoomOrigin).toBe("140px 200px");

    h.container.dispatchEvent({
      type: "touchend",
      cancelable: true,
      touches: touchList([{ x: 50, y: 210 }]),
      changedTouches: touchList([{ x: 250, y: 210 }]),
      target: makeTarget(false),
    });
    expect(h.zooms).toEqual([2]);
    // commit 後應清理 zoomOrigin，避免下次放大沿用舊起點
    expect(h.page.dataset.zoomOrigin).toBeUndefined();
    expect(h.page.style.transform).toBe("");
    h.cleanup();
  });

  it("handles staggered 1->2 finger touchstart and 2->1->0 lift without triggering phantom double-tap zoom", () => {
    vi.useFakeTimers();
    const h = createHarness(1);
    const target = makeTarget(false);

    // 第 1 指先落下，第 2 指隔 40ms 落下
    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 140, y: 220 }]),
      changedTouches: touchList([{ x: 140, y: 220 }]),
      target,
    });
    vi.advanceTimersByTime(40);
    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 140, y: 220 }, { x: 220, y: 220 }]),
      changedTouches: touchList([{ x: 220, y: 220 }]),
      target,
    });
    expect(h.pinchStartEvents).toEqual(["reader-pinch-start"]);

    h.container.dispatchEvent({
      type: "touchmove",
      cancelable: true,
      touches: touchList([{ x: 120, y: 220 }, { x: 240, y: 220 }]),
      changedTouches: touchList([{ x: 120, y: 220 }, { x: 240, y: 220 }]),
      target,
    });
    // 放開其中一指 -> 提交 1.5x；再放開最後一指不應被當成 tap 導致雙擊縮放
    h.container.dispatchEvent({
      type: "touchend",
      cancelable: true,
      touches: touchList([{ x: 120, y: 220 }]),
      changedTouches: touchList([{ x: 240, y: 220 }]),
      target,
    });
    expect(h.zooms).toEqual([1.5]);

    vi.advanceTimersByTime(50);
    h.container.dispatchEvent({
      type: "touchend",
      cancelable: true,
      touches: touchList([]),
      changedTouches: touchList([{ x: 120, y: 220 }]),
      target,
    });
    // 緊接著再點一次也不應誤觸雙擊縮回 1x
    vi.advanceTimersByTime(80);
    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 120, y: 220 }]),
      changedTouches: touchList([{ x: 120, y: 220 }]),
      target,
    });
    h.container.dispatchEvent({
      type: "touchend",
      cancelable: true,
      touches: touchList([]),
      changedTouches: touchList([{ x: 120, y: 220 }]),
      target,
    });
    expect(h.zooms).toEqual([1.5]);
    h.cleanup();
  });

  it("supports double-tap zoom on blank area and ignores double-tap on interactive ink/button elements", () => {
    vi.useFakeTimers();
    const h = createHarness(1);

    const tapOnce = (target: { closest: () => unknown }, x = 180, y = 260) => {
      h.container.dispatchEvent({
        type: "touchstart",
        cancelable: true,
        touches: touchList([{ x, y }]),
        changedTouches: touchList([{ x, y }]),
        target,
      });
      vi.advanceTimersByTime(40);
      h.container.dispatchEvent({
        type: "touchend",
        cancelable: true,
        touches: touchList([]),
        changedTouches: touchList([{ x, y }]),
        target,
      });
    };

    // 在 [data-ink] 或按鈕上雙擊不縮放
    tapOnce(makeTarget(true));
    vi.advanceTimersByTime(80);
    tapOnce(makeTarget(true));
    expect(h.zooms).toEqual([]);

    // 在一般頁面上雙擊：1 -> 2 -> 1
    tapOnce(makeTarget(false));
    vi.advanceTimersByTime(80);
    tapOnce(makeTarget(false));
    expect(h.zooms).toEqual([2]);

    vi.advanceTimersByTime(400);
    tapOnce(makeTarget(false));
    vi.advanceTimersByTime(80);
    tapOnce(makeTarget(false));
    expect(h.zooms).toEqual([2, 1]);
    h.cleanup();
  });

  it("ignores stylus touch and writingMode, and clears active preview if stylus interrupts pinch", () => {
    const h = createHarness(1);
    const target = makeTarget(false);

    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 100, y: 200 }, { x: 200, y: 200 }]),
      changedTouches: touchList([{ x: 200, y: 200 }]),
      target,
    });
    h.container.dispatchEvent({
      type: "touchmove",
      cancelable: true,
      touches: touchList([{ x: 50, y: 200 }, { x: 250, y: 200 }]),
      changedTouches: touchList([{ x: 50, y: 200 }]),
      target,
    });
    expect(h.page.style.transform).not.toBe("");

    // Apple Pencil 碰觸時應清掉進行中的預覽且不提交縮放
    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 50, y: 200 }, { x: 250, y: 200 }, { x: 150, y: 150, touchType: "stylus" }]),
      changedTouches: touchList([{ x: 150, y: 150, touchType: "stylus" }]),
      target,
    });
    expect(h.page.style.transform).toBe("");
    expect(h.zooms).toEqual([]);

    inkState.writingMode = true;
    h.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 100, y: 200 }, { x: 200, y: 200 }]),
      changedTouches: touchList([{ x: 200, y: 200 }]),
      target,
    });
    expect(h.pinchStartEvents).toHaveLength(1);
    h.cleanup();
  });

  it("ignores wheel zoom while touch pinch is active and uses window pointer listeners in non-touch fallback", () => {
    vi.useFakeTimers();
    const hTouch = createHarness(1, true);
    hTouch.container.dispatchEvent({
      type: "touchstart",
      cancelable: true,
      touches: touchList([{ x: 100, y: 200 }, { x: 200, y: 200 }]),
      changedTouches: touchList([{ x: 200, y: 200 }]),
      target: makeTarget(false),
    });
    hTouch.container.dispatchEvent({ type: "wheel", cancelable: true, ctrlKey: true, clientX: 150, clientY: 200, deltaY: -100 });
    vi.advanceTimersByTime(200);
    expect(hTouch.zooms).toEqual([]);
    hTouch.cleanup();

    const hPtr = createHarness(1, false);
    hPtr.container.dispatchEvent({ type: "pointerdown", pointerType: "touch", pointerId: 1, clientX: 100, clientY: 200, target: makeTarget(false) });
    hPtr.container.dispatchEvent({ type: "pointerdown", pointerType: "touch", pointerId: 2, clientX: 200, clientY: 200, target: makeTarget(false) });
    expect(hPtr.pinchStartEvents).toEqual(["reader-pinch-start"]);
    hPtr.fakeWindow.dispatchEvent({ type: "pointermove", pointerId: 1, clientX: 50, clientY: 200 });
    hPtr.fakeWindow.dispatchEvent({ type: "pointermove", pointerId: 2, clientX: 250, clientY: 200 });
    hPtr.fakeWindow.dispatchEvent({ type: "pointerup", pointerId: 2 });
    expect(hPtr.zooms).toEqual([2]);
    // 超過 MAX_ZOOM / 低於 MIN_ZOOM 會 clamp
    hPtr.fakeWindow.dispatchEvent({ type: "pointerup", pointerId: 1 });
    expect(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, hPtr.getZoom()))).toBe(2);
    hPtr.cleanup();
  });
});
