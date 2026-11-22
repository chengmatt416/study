// PDF 檢視器
// - 單頁：連續捲動，虛擬化渲染；每頁佔用「固定大小的槽位」，頁面等比縮放置中 → 渲染時版面不會位移（不再跳動）
// - 雙頁：翻頁式跨頁（左右兩頁），滑動/方向鍵翻頁，不使用連續捲動
// - 標注層使用 PDF 座標系（跨裝置/縮放一致），工具仿 GoodNotes：鋼筆、螢光筆、擦子、形狀、文字螢光、便利貼
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { isPenActive } from "../../lib/inkGuard";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { pdfjs, type PDFDocumentProxy } from "./pdf";
import { splitInk } from "../../../shared/ink";
import { usePinchZoom } from "./usePinchZoom";
import { clampReadingPage, visibleReadingPage } from "./reading-page";

import { capturePointer } from "../../lib/pointerCapture";

export type Tool = "none" | "pen" | "highlighter" | "eraser" | "shape" | "text" | "sticky";
export type TextMode = "highlight" | "underline" | "strike";

export interface ToolSettings {
  pen: { color: string; width: number };
  highlighter: { color: string; width: number; straight: boolean };
  shape: { color: string };
  text: { color: string; mode: TextMode };
  sticky: { color: string };
  /** partial：一般橡皮擦（擦掉經過的部分）；stroke：整筆擦除 */
  eraser: { size: number; mode?: "partial" | "stroke" };
}

export interface Annotation {
  id: string;
  page: number;
  type: "highlight" | "underline" | "strike" | "ink" | "rect" | "note";
  data: { rects?: [number, number, number, number][]; points?: [number, number, number][]; width?: number; highlighter?: boolean; text?: string; x?: number; y?: number };
  color: string;
  visibility: "private" | "shared";
  mine: boolean;
  author?: string | null;
}

export interface ViewerHandle {
  scrollToPage: (page: number, smooth?: boolean) => void;
  turn: (dir: number) => void;
}

interface Props {
  doc: PDFDocumentProxy;
  initialPage?: number;
  scale: number;
  spread: boolean;
  slot: { w: number; h: number };
  tool: Tool;
  settings: ToolSettings;
  penOnly: boolean;
  textLayer: boolean;
  annotations: Annotation[];
  onCreate: (a: Omit<Annotation, "id" | "mine" | "visibility">) => void;
  onDelete: (id: string) => void;
  /** 一般橡皮擦：以剩餘片段取代原標注（一次拖曳＝一個復原步驟） */
  onReplace: (removed: Annotation[], added: Annotation[]) => void;
  onNoteOpen: (a: Annotation) => void;
  onPageChange: (page: number) => void;
  onTap?: () => void;
  /** 使用者縮放倍率（1 = 適寬/適頁）；提供 onZoomChange 才啟用捏合、Ctrl+滾輪、雙擊放大 */
  zoom?: number;
  onZoomChange?: (z: number) => void;
  /** 暫時旋轉（度，90 的倍數），依頁碼；不改變 PDF，也不影響標注座標 */
  rotations?: Record<number, number>;
}

const DPR_CAP = 2;
const GAP = 16;
/**
 * Pixels per page canvas. iOS Safari caps the total canvas memory of a tab and blanks canvases past it (the "flicker"
 * when zooming), so touch devices keep pages smaller; past the cap the page is drawn at a lower density, never blank.
 */
const maxCanvasPixels = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 5_000_000 : 16_000_000;
const releaseCanvas = (canvas: HTMLCanvasElement) => { canvas.width = 0; canvas.height = 0; };

export const PdfViewer = forwardRef<ViewerHandle, Props>(function PdfViewer(props, ref) {
  const { doc, scale, spread, slot, zoom = 1, onZoomChange, initialPage = 1 } = props;
  const firstPage = clampReadingPage(initialPage, doc.numPages);
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  usePinchZoom(container, content, { zoom, onZoomChange, renderScale: scale, view: spread ? "spread" : "single" });
  const [viewportHeight, setViewportHeight] = useState(0);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setViewportHeight(element.clientHeight);
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, [spread]);
  const zoomed = zoom > 1.02;
  const [visible, setVisible] = useState<Set<number>>(() => new Set([firstPage - 1, firstPage, firstPage + 1]));
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const current = useRef(firstPage);
  // 雙頁模式：目前跨頁的左頁（1 為封面單頁，之後 2-3、4-5…）
  const [spreadStart, setSpreadStart] = useState(() => firstPage <= 1 ? 1 : firstPage % 2 === 0 ? firstPage : firstPage - 1);
  const [dir, setDir] = useState(1);
  // 雙頁翻頁按鈕：平常隱藏，滑動/移動指標/觸控時短暫顯示
  const [navShown, setNavShown] = useState(false);
  const navTimer = useRef<number>(0);
  const navHover = useRef(false);
  const pokeNav = useCallback(() => {
    setNavShown(true);
    window.clearTimeout(navTimer.current);
    navTimer.current = window.setTimeout(() => !navHover.current && setNavShown(false), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(navTimer.current), []);
  const slotW = slot.w * scale;
  const slotH = slot.h * scale;

  const spreadOf = useCallback((p: number) => (p <= 1 ? 1 : p % 2 === 0 ? p : p - 1), []);
  const turn = useCallback(
    (d: number) => {
      setSpreadStart((s) => {
        const next = d > 0 ? (s === 1 ? 2 : s + 2) : s <= 2 ? 1 : s - 2;
        if (next < 1 || next > doc.numPages) return s;
        setDir(d);
        return next;
      });
    },
    [doc.numPages],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(page, smooth) {
        if (spread) {
          const s = spreadOf(page);
          setDir(s >= spreadStart ? 1 : -1);
          setSpreadStart(s);
          return;
        }
        // 槽位固定大小 → 直接計算位置，不必等頁面渲染
        container.current?.scrollTo({ top: (page - 1) * (slotH + GAP), behavior: smooth ? "smooth" : "auto" });
      },
      turn,
    }),
    [spread, spreadOf, spreadStart, slotH, turn],
  );

  // 切換單/雙頁時保留目前頁：在任何捲動事件改寫目前頁之前記下它，版面（倍率）穩定前每次排版都重新定位，期間忽略捲動
  const viewTarget = useRef<number | null>(null);
  const lastSpread = useRef(spread);
  if (lastSpread.current !== spread) { lastSpread.current = spread; viewTarget.current = current.current; }
  const viewTimer = useRef(0);
  useLayoutEffect(() => {
    const page = viewTarget.current;
    if (page === null) return;
    if (spread) setSpreadStart(spreadOf(page));
    else if (container.current) container.current.scrollTop = (page - 1) * (slotH + GAP);
    window.clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => { viewTarget.current = null; current.current = page; }, 250);
  }, [spread, slotH, spreadOf]);
  useEffect(() => () => window.clearTimeout(viewTimer.current), []);

  useEffect(() => {
    if (!spread) return;
    current.current = spreadStart;
    props.onPageChange(spreadStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadStart, spread]);

  // 單頁模式：可視頁偵測 + 目前頁（以捲動位置直接計算，與渲染無關）
  useEffect(() => {
    if (spread) return;
    const root = container.current;
    if (!root) return;
    let active = true;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          if (!active) return prev;
          const next = new Set(prev);
          for (const e of entries) {
            const p = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(p);
            else next.delete(p);
          }
          return next;
        });
      },
      { root, rootMargin: "120% 0px" },
    );
    pageEls.current.forEach((el) => io.observe(el));
    const onScroll = () => {
      if (!active || viewTarget.current !== null) return;
      const page = visibleReadingPage(root.scrollTop, root.clientHeight, slotH, GAP, doc.numPages);
      if (page !== current.current) {
        current.current = page;
        props.onPageChange(page);
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      active = false;
      io.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, spread, slotH]);

  if (spread) {
    const pages = spreadStart === 1 ? [1] : [spreadStart, spreadStart + 1].filter((p) => p <= doc.numPages);
    return (
      <div className="relative h-full" onPointerMove={pokeNav} onPointerDown={pokeNav} onWheel={pokeNav} onScroll={pokeNav} onKeyDown={pokeNav}>
      <div ref={container} data-ink-zone="" className="h-full overflow-auto overscroll-contain bg-ink-100 [touch-action:pan-x_pan-y] dark:bg-ink-950" onClick={(e) => e.target === e.currentTarget && props.onTap?.()}>
      <div ref={content} className="grid min-h-full w-max min-w-full place-items-center p-4" onClick={(e) => e.target === e.currentTarget && props.onTap?.()}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={spreadStart}
            custom={dir}
            className="flex gap-0.5"
            initial={{ opacity: 0, x: dir * 90, rotateY: dir * -10 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            exit={{ opacity: 0, x: dir * -90, rotateY: dir * 10 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            style={{ transformPerspective: 1800 }}
            drag={props.tool === "none" && !zoomed ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDrag={pokeNav}
            onDragEnd={(_, info) => {
              if (info.offset.x < -80 || info.velocity.x < -500) turn(1);
              else if (info.offset.x > 80 || info.velocity.x > 500) turn(-1);
            }}
          >
            {pages.map((p) => (
              <div key={p} className="pdf-page" style={{ width: slotW, height: slotH }}>
                <PdfPage {...props} pageNumber={p} />
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      </div>
        <SpreadNav label="上一頁" side="left" visible={navShown} hover={navHover} onPoke={pokeNav} disabled={spreadStart === 1} onClick={() => turn(-1)} />
        <SpreadNav label="下一頁" side="right" visible={navShown} hover={navHover} onPoke={pokeNav} disabled={spreadStart + (spreadStart === 1 ? 1 : 2) > doc.numPages} onClick={() => turn(1)} />
      </div>
    );
  }

  return (
    <div ref={container} data-ink-zone="" className="relative h-full overflow-auto overscroll-contain bg-ink-100 [overflow-anchor:none] [touch-action:pan-x_pan-y] dark:bg-ink-950" onClick={(e) => e.target === e.currentTarget && props.onTap?.()}>
      <div ref={content} className="flex w-max min-w-full flex-col items-center px-2" style={{ gap: GAP, paddingTop: GAP, paddingBottom: Math.max(GAP, viewportHeight - slotH + GAP) }} onClick={(e) => e.target === e.currentTarget && props.onTap?.()}>
        {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((p) => (
          <div
            key={p}
            data-page={p}
            ref={(el) => {
              if (el) pageEls.current.set(p, el);
              else pageEls.current.delete(p);
            }}
            className="pdf-page shrink-0"
            style={{ width: slotW, height: slotH }}
          >
            {visible.has(p) ? <PdfPage {...props} pageNumber={p} /> : <div className="grid h-full place-items-center text-sm text-slate-300">{p}</div>}
          </div>
        ))}
      </div>
    </div>
  );
});

function SpreadNav({
  side,
  disabled,
  onClick,
  label,
  visible,
  hover,
  onPoke,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
  label: string;
  visible: boolean;
  hover: { current: boolean };
  onPoke: () => void;
}) {
  const shown = visible && !disabled;
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        onClick();
        onPoke();
        e.stopPropagation();
      }}
      onMouseEnter={() => (hover.current = true)}
      onMouseLeave={() => {
        hover.current = false;
        onPoke();
      }}
      onFocus={onPoke}
      tabIndex={disabled ? -1 : 0}
      className={clsx(
        "absolute top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-ink-900 shadow-lg backdrop-blur transition-all duration-300 hover:scale-105 focus-visible:opacity-100 dark:bg-white/10 dark:text-white",
        side === "left" ? "left-3" : "right-3",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        shown ? "translate-x-0" : side === "left" ? "-translate-x-2" : "translate-x-2",
      )}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {side === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );
}

interface PageProps extends Props {
  pageNumber: number;
}

/** 單一頁面：在槽位內等比縮放置中渲染（頁面大小不同也不會改變版面高度） */
const PdfPage = memo(function PdfPage({ doc, pageNumber, scale, slot, textLayer, rotations, ...rest }: PageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // 記住該頁原始 PDF 尺寸；scale/slot 變動時同步重算 fit，避免 pinch 放手瞬間縮回一幀再跳回
  const [baseSize, setBaseSize] = useState<{ doc: PDFDocumentProxy; pageNumber: number; w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const rotation = (((rotations?.[pageNumber] ?? 0) % 360) + 360) % 360;
  const sideways = rotation % 180 !== 0;
  const activeBase = baseSize && baseSize.doc === doc && baseSize.pageNumber === pageNumber ? baseSize : null;
  const fit = activeBase
    ? (() => {
        const bw = sideways ? activeBase.h : activeBase.w;
        const bh = sideways ? activeBase.w : activeBase.h;
        return { w: activeBase.w, h: activeBase.h, s: scale * Math.min(slot.w / bw, slot.h / bh) };
      })()
    : null;

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<pdfjs.PDFPageProxy["render"]> | null = null;
    let tl: pdfjs.TextLayer | null = null;
    setError(null);
    void (async () => {
      const page = await doc.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const base = page.getViewport({ scale: 1 });
      setBaseSize((prev) =>
        prev && prev.doc === doc && prev.pageNumber === pageNumber && prev.w === base.width && prev.h === base.height
          ? prev
          : { doc, pageNumber, w: base.width, h: base.height },
      );
      // 旋轉 90/270 度時，以旋轉後的寬高放進槽位
      const bw = sideways ? base.height : base.width;
      const bh = sideways ? base.width : base.height;
      const s = scale * Math.min(slot.w / bw, slot.h / bh);
      const viewport = page.getViewport({ scale: s });
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP, Math.sqrt(maxCanvasPixels() / Math.max(1, viewport.width * viewport.height)));
      const offscreen = document.createElement("canvas");
      offscreen.width = Math.max(1, Math.floor(viewport.width * dpr));
      offscreen.height = Math.max(1, Math.floor(viewport.height * dpr));
      task = page.render({ canvas: offscreen, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await task.promise;
        if (cancelled) return;
        // 在畫面外的 canvas 畫好後才一次換上，舊畫面靠 h-full w-full 同步拉伸撐著：縮放時不會閃爍或縮回
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.getContext("2d")?.drawImage(offscreen, 0, 0);
      } finally {
        releaseCanvas(offscreen);
      }
      const textContainer = textRef.current;
      if (cancelled || !textLayer || !textContainer) return;
      textContainer.replaceChildren();
      textContainer.style.setProperty("--scale-factor", String(s));
      tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textContainer, viewport });
      await tl.render().catch(() => undefined);
    })().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "無法讀取這一頁"); });
    return () => {
      cancelled = true;
      task?.cancel();
      tl?.cancel();
    };
  }, [doc, pageNumber, scale, slot.w, slot.h, textLayer, sideways, attempt]);

  // iOS Safari frees canvas memory only when the canvas is resized to 0: release it when the page leaves the screen.
  useEffect(() => () => { if (canvasRef.current) releaseCanvas(canvasRef.current); }, []);

  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden" onClick={() => { if (rest.tool === "none" && !window.getSelection()?.toString()) rest.onTap?.(); }}>
      <div
        className="relative bg-white transition-transform duration-300 ease-out"
        style={fit ? { width: fit.w * fit.s, height: fit.h * fit.s, transform: rotation ? `rotate(${rotation}deg)` : undefined } : { width: "100%", height: "100%" }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {textLayer && <div ref={textRef} className={clsx("pdf-text-layer", rest.tool !== "text" && rest.tool !== "none" && "pointer-events-none")} data-page={pageNumber} />}
        {fit && <AnnotationLayer {...rest} pageNumber={pageNumber} size={fit} />}
      </div>
      {error && <div className="absolute inset-0 z-20 grid content-center justify-items-center gap-3 bg-white/95 p-4 text-center text-sm text-slate-700" role="alert"><p>第 {pageNumber} 頁讀取失敗：{error}</p><button className="min-h-11 rounded-xl border border-slate-300 px-4 focus-visible:outline-2" onClick={event => { event.stopPropagation(); setAttempt(value => value + 1); }}>重新載入第 {pageNumber} 頁</button></div>}
    </div>
  );
});

type Draft =
  | { kind: "ink"; points: [number, number, number][] }
  | { kind: "shape"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "sticky"; x: number; y: number }
  | null;

function AnnotationLayer({
  pageNumber,
  size,
  tool,
  settings,
  penOnly,
  annotations,
  onCreate,
  onDelete,
  onReplace,
  onNoteOpen,
}: Omit<PageProps, "doc" | "scale" | "slot" | "textLayer"> & { size: { w: number; h: number; s: number } }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [eraserAt, setEraserAt] = useState<[number, number] | null>(null);
  const erased = useRef(new Set<string>());
  const pointers = useRef(new Set<number>());
  const activePointer = useRef<number | null>(null);
  const captured = useRef<Element | null>(null);
  // 一般橡皮擦拖曳中的暫存：原標注 id → 擦除後剩下的片段
  const working = useRef<Map<string, Annotation[]> | null>(null);
  const [, rerender] = useState(0);

  const cancelStroke = useCallback(() => {
    const id = activePointer.current;
    const cap = captured.current;
    activePointer.current = null;
    captured.current = null;
    if (id !== null && cap) {
      try {
        if (cap.hasPointerCapture?.(id)) cap.releasePointerCapture(id);
      } catch {
        // 已釋放則忽略
      }
    }
    setDraft(null);
    setEraserAt(null);
    erased.current.clear();
    if (working.current) {
      working.current = null;
      rerender((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const zone = svgRef.current?.closest("[data-ink-zone]");
    const onPinch = () => cancelStroke();
    const dropPointer = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
    };
    zone?.addEventListener("reader-pinch-start", onPinch);
    window.addEventListener("pointerup", dropPointer);
    window.addEventListener("pointercancel", dropPointer);
    return () => {
      zone?.removeEventListener("reader-pinch-start", onPinch);
      window.removeEventListener("pointerup", dropPointer);
      window.removeEventListener("pointercancel", dropPointer);
    };
  }, [cancelStroke]);
  const pageAnns = annotations.filter((a) => a.page === pageNumber);
  const list = working.current ? [...pageAnns.filter((a) => !working.current!.has(a.id)), ...[...working.current.values()].flat()] : pageAnns;
  const interactive = tool === "pen" || tool === "highlighter" || tool === "shape" || tool === "sticky" || tool === "eraser";

  const toPdf = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (m) {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      return [p.x, p.y] as const;
    }
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * size.w, ((e.clientY - r.top) / r.height) * size.h] as const;
  };

  const eraseAt = (x: number, y: number) => {
    const radius = settings.eraser.size / size.s; // 擦子大小以螢幕像素計
    if (settings.eraser.mode === "stroke") {
      for (const a of pageAnns) {
        if (!a.mine || erased.current.has(a.id)) continue;
        if (hit(a, x, y, radius)) {
          erased.current.add(a.id);
          onDelete(a.id);
        }
      }
      return;
    }
    const next = new Map(working.current ?? []);
    let changed = false;
    for (const orig of pageAnns) {
      if (!orig.mine) continue;
      const pieces = next.get(orig.id) ?? [orig];
      let touched = false;
      const out = pieces.flatMap((pc) => {
        if (!hit(pc, x, y, radius)) return [pc];
        touched = true;
        return erasePiece(pc, x, y, radius);
      });
      if (touched) {
        next.set(orig.id, out.map((pc, i) => ({ ...pc, id: `${orig.id}~${Date.now().toString(36)}${i}` })));
        changed = true;
      }
    }
    if (changed) {
      working.current = next;
      rerender((n) => n + 1);
    }
  };

  const commitErase = () => {
    const w = working.current;
    working.current = null;
    if (!w?.size) return;
    const removed: Annotation[] = [];
    const added: Annotation[] = [];
    for (const [id, pieces] of w) {
      const orig = pageAnns.find((a) => a.id === id);
      if (!orig) continue;
      removed.push(orig);
      for (const pc of pieces) added.push({ ...pc, id: crypto.randomUUID() });
    }
    onReplace(removed, added);
    rerender((n) => n + 1);
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    if ((penOnly || isPenActive()) && e.pointerType === "touch") return; // 只用觸控筆／筆正在寫：手指（手掌）不畫也不動作
    pointers.current.add(e.pointerId);
    if (pointers.current.size > 1) {
      // 雙指手勢時取消剛起筆的草稿，交給容器做縮放／平移
      cancelStroke();
      return;
    }
    e.preventDefault();
    const target = e.target as Element;
    try {
      capturePointer(target, e.pointerId);
      captured.current = target;
    } catch {
      captured.current = null;
    }
    activePointer.current = e.pointerId;
    const [x, y] = toPdf(e);
    if (tool === "pen" || tool === "highlighter") setDraft({ kind: "ink", points: [[x, y, e.pressure || 0.5]] });
    else if (tool === "shape") setDraft({ kind: "shape", x0: x, y0: y, x1: x, y1: y });
    else if (tool === "eraser") {
      erased.current = new Set();
      setEraserAt([x, y]);
      eraseAt(x, y);
    } else if (tool === "sticky") {
      setDraft({ kind: "sticky", x, y });
    }
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if ((penOnly || isPenActive()) && e.pointerType === "touch") return;
    if (pointers.current.size > 1) return;
    if (tool === "eraser") {
      if (activePointer.current !== null && activePointer.current !== e.pointerId) return;
      const [x, y] = toPdf(e);
      setEraserAt([x, y]);
      if (activePointer.current === e.pointerId && (e.buttons || e.pointerType !== "mouse")) eraseAt(x, y);
      return;
    }
    if (activePointer.current !== e.pointerId || !draft || draft.kind === "sticky") return;
    const [x, y] = toPdf(e);
    if (draft.kind === "ink") {
      const pts =
        tool === "highlighter" && settings.highlighter.straight
          ? [draft.points[0], [x, y, 0.5] as [number, number, number]]
          : [...draft.points, [x, y, e.pressure || 0.5] as [number, number, number]];
      setDraft({ kind: "ink", points: pts });
    } else setDraft({ ...draft, x1: x, y1: y });
  };
  const up = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    captured.current = null;
    if (tool === "eraser") {
      erased.current = new Set();
      commitErase();
      return;
    }
    if (!draft) return;
    if (draft.kind === "ink" && draft.points.length > 1) {
      const hl = tool === "highlighter";
      onCreate({
        page: pageNumber,
        type: "ink",
        data: { points: simplify(draft.points), width: hl ? settings.highlighter.width : settings.pen.width, highlighter: hl || undefined },
        color: hl ? settings.highlighter.color : settings.pen.color,
      });
    } else if (draft.kind === "shape") {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      if (w > 3 && h > 3) onCreate({ page: pageNumber, type: "rect", data: { rects: [[x, y, w, h]] }, color: settings.shape.color });
    } else if (draft.kind === "sticky") {
      onCreate({ page: pageNumber, type: "note", data: { x: draft.x, y: draft.y }, color: settings.sticky.color });
    }
    setDraft(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size.w} ${size.h}`}
      className={clsx("absolute inset-0 z-10 h-full w-full", interactive ? (tool === "eraser" ? "cursor-none" : "cursor-crosshair") : "pointer-events-none")}
      data-ink={interactive ? "" : undefined}
      style={{ touchAction: interactive && !penOnly ? "none" : "auto", WebkitTouchCallout: "none", userSelect: interactive ? "none" : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setEraserAt(null)}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        if (activePointer.current !== e.pointerId) return;
        activePointer.current = null;
        captured.current = null;
        setDraft(null);
        if (tool === "eraser") commitErase();
      }}
    >
      {list.map((a) => (
        <g
          key={a.id}
          opacity={a.mine ? 1 : 0.75}
          role={a.type === "note" ? "button" : undefined}
          aria-label={a.type === "note" ? `便利貼：${a.data.text ?? ""}` : undefined}
          tabIndex={a.type === "note" && tool !== "eraser" ? 0 : undefined}
          className={clsx(a.type === "note" && "pointer-events-auto cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900")}
          onKeyDown={event => { if (a.type === "note" && tool !== "eraser" && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); onNoteOpen(a); } }}
          onClick={(e) => {
            if (a.type === "note" && tool !== "eraser") {
              e.stopPropagation();
              onNoteOpen(a);
            }
          }}
        >
          {a.type === "highlight" && a.data.rects?.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={1.5} fill={a.color} opacity={0.4} style={{ mixBlendMode: "multiply" }} />)}
          {a.type === "rect" && a.data.rects?.map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={2} fill={a.color} fillOpacity={0.18} stroke={a.color} strokeWidth={1.4} />)}
          {a.type === "underline" && a.data.rects?.map((r, i) => <line key={i} x1={r[0]} x2={r[0] + r[2]} y1={r[1] + r[3]} y2={r[1] + r[3]} stroke={a.color} strokeWidth={1.6} strokeLinecap="round" />)}
          {a.type === "strike" && a.data.rects?.map((r, i) => <line key={i} x1={r[0]} x2={r[0] + r[2]} y1={r[1] + r[3] / 2} y2={r[1] + r[3] / 2} stroke={a.color} strokeWidth={1.3} strokeLinecap="round" />)}
          {a.type === "ink" && a.data.points && <InkPath points={a.data.points} color={a.color} width={a.data.width ?? 2} highlighter={!!a.data.highlighter} />}
          {a.type === "note" && (
            <g transform={`translate(${a.data.x},${a.data.y})`}>
              <rect x={-Math.max(10, 22 / size.s)} y={-Math.max(10, 22 / size.s)} width={Math.max(20, 44 / size.s)} height={Math.max(20, 44 / size.s)} fill="transparent" />
              <rect x={-10} y={-10} width={20} height={20} rx={4} fill={a.color} stroke="#0a0a0a" strokeOpacity={0.15} />
              <path d="M-5 -3 H5 M-5 1 H5 M-5 5 H2" stroke="#0a0a0a" strokeOpacity={0.55} strokeWidth={1.4} strokeLinecap="round" />
              <title>{(a.author ? `${a.author}：` : "") + (a.data.text ?? "")}</title>
            </g>
          )}
        </g>
      ))}
      {draft?.kind === "ink" && (
        <InkPath
          points={draft.points}
          color={tool === "highlighter" ? settings.highlighter.color : settings.pen.color}
          width={tool === "highlighter" ? settings.highlighter.width : settings.pen.width}
          highlighter={tool === "highlighter"}
        />
      )}
      {draft?.kind === "shape" && (
        <rect x={Math.min(draft.x0, draft.x1)} y={Math.min(draft.y0, draft.y1)} width={Math.abs(draft.x1 - draft.x0)} height={Math.abs(draft.y1 - draft.y0)} rx={2} fill={settings.shape.color} fillOpacity={0.18} stroke={settings.shape.color} strokeWidth={1.4} strokeDasharray="4 3" />
      )}
      {tool === "eraser" && eraserAt && <circle cx={eraserAt[0]} cy={eraserAt[1]} r={settings.eraser.size / size.s} fill="rgb(255 255 255 / .5)" stroke="#0a0a0a" strokeOpacity={0.5} strokeWidth={1 / size.s} />}
    </svg>
  );
}

function InkPath({ points, color, width, highlighter }: { points: [number, number, number][]; color: string; width: number; highlighter: boolean }) {
  if (highlighter)
    return <path d={inkPath(points)} fill="none" stroke={color} strokeOpacity={0.38} strokeWidth={width} strokeLinecap="butt" strokeLinejoin="round" style={{ mixBlendMode: "multiply" }} />;
  return <path d={inkPath(points)} fill="none" stroke={color} strokeWidth={width * (0.55 + avgPressure(points) * 0.9)} strokeLinecap="round" strokeLinejoin="round" />;
}

function hit(a: Annotation, x: number, y: number, r: number): boolean {
  if (a.data.points) {
    const w = (a.data.width ?? 2) / 2 + r;
    const pts = a.data.points;
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - x, pts[i][1] - y) <= w) return true;
      if (i > 0 && distToSeg(x, y, pts[i - 1], pts[i]) <= w) return true;
    }
    return false;
  }
  if (a.data.rects) return a.data.rects.some(([rx, ry, rw, rh]) => x >= rx - r && x <= rx + rw + r && y >= ry - r && y <= ry + rh + r);
  if (a.type === "note") return Math.hypot((a.data.x ?? 0) - x, (a.data.y ?? 0) - y) <= 10 + r;
  return false;
}

/** 一般橡皮擦：回傳擦除後剩餘的片段（筆跡切斷、螢光區塊左右裁切；框與便利貼整個移除） */
function erasePiece(a: Annotation, x: number, y: number, r: number): Annotation[] {
  if (a.type === "ink" && a.data.points) {
    return splitInk(a.data.points, a.data.width ?? 2, x, y, r).map((points) => ({ ...a, data: { ...a.data, points } }));
  }
  if ((a.type === "highlight" || a.type === "underline" || a.type === "strike") && a.data.rects) {
    const rects = a.data.rects.flatMap(([rx, ry, rw, rh]): [number, number, number, number][] => {
      // 圓形擦子與矩形不相交 → 保留
      const cx = Math.max(rx, Math.min(x, rx + rw));
      const cy = Math.max(ry, Math.min(y, ry + rh));
      if (Math.hypot(cx - x, cy - y) > r) return [[rx, ry, rw, rh]];
      const out: [number, number, number, number][] = [];
      const leftW = x - r - rx;
      const rightX = x + r;
      if (leftW > 0.8) out.push([rx, ry, +leftW.toFixed(2), rh]);
      if (rx + rw - rightX > 0.8) out.push([+rightX.toFixed(2), ry, +(rx + rw - rightX).toFixed(2), rh]);
      return out;
    });
    return rects.length ? [{ ...a, data: { ...a.data, rects } }] : [];
  }
  return [];
}

function distToSeg(px: number, py: number, a: [number, number, number], b: [number, number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function inkPath(points: [number, number, number][]): string {
  if (!points.length) return "";
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    d += ` Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`;
  }
  const last = points[points.length - 1];
  return d + ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
}

const avgPressure = (p: [number, number, number][]) => p.reduce((s, x) => s + x[2], 0) / p.length || 0.5;

/** 去除過近的點，減少儲存量 */
function simplify(points: [number, number, number][], min = 0.8): [number, number, number][] {
  const out = [points[0]];
  for (const p of points.slice(1)) {
    const l = out[out.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= min) out.push([+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)]);
  }
  if (out.length === 1 && points.length > 1) out.push(points[points.length - 1]);
  return out;
}

/** 從目前的文字選取範圍建立 highlight/underline/strike 的矩形（PDF 座標） */
export function selectionToRects(): { page: number; rects: [number, number, number, number][] } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const layer = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest(".pdf-text-layer") as HTMLElement | null;
  if (!layer) return null;
  const pageEl = layer.parentElement!;
  const svg = pageEl.querySelector("svg");
  const m = svg?.getScreenCTM();
  if (!svg || !m) return null;
  const inv = m.inverse();
  // 把每個選取框的四個角換回 PDF 座標（頁面旋轉時仍正確）
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => {
      const pts = [
        [r.left, r.top],
        [r.right, r.top],
        [r.left, r.bottom],
        [r.right, r.bottom],
      ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(inv));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0] as [number, number, number, number];
    });
  if (!rects.length) return null;
  return { page: Number(layer.dataset.page), rects: mergeRects(rects) };
}

function mergeRects(rects: [number, number, number, number][]) {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: [number, number, number, number][] = [];
  for (const r of sorted) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[1] - r[1]) < r[3] * 0.5 && r[0] <= l[0] + l[2] + 2) {
      const right = Math.max(l[0] + l[2], r[0] + r[2]);
      l[2] = right - l[0];
      l[3] = Math.max(l[3], r[3]);
    } else out.push([...r]);
  }
  return out.map((r) => r.map((v) => +v.toFixed(2)) as [number, number, number, number]);
}
