'use client';
import { useCallback, useEffect, useRef } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { saveStudyModule, savedModuleState } from '@/lib/study-classroom/progress';
import { ERASER_RADIUS, HIGHLIGHTER_WIDTH, INK_COLORS, PEN_WIDTH, decimate, fitStrokes, hitsStroke, inkState, parseStrokes, registerInk, setInkCount, setInkOn, useStudyInk, type Stroke } from '@/lib/study-classroom/ink';
import './classroom.css';

/** How tall a scrolling page's content is, not counting the writing layer itself (which would keep it from ever shrinking). */
function contentHeight(parent: HTMLElement, layer: HTMLElement | null): number {
  let bottom = 0;
  for (const child of Array.from(parent.children) as HTMLElement[]) if (child !== layer) bottom = Math.max(bottom, child.offsetTop + child.offsetHeight);
  return Math.max(parent.clientHeight, bottom + (parseFloat(getComputedStyle(parent).paddingBottom) || 0));
}
const isDark = () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/**
 * A writing layer over a page. `box` covers its parent exactly; `content` covers a scrolling parent's whole scrollable height
 * (the phone slide reader), so what is written stays beside the words it was written next to.
 */
export function StudyInkCanvas({ sceneId, mode = 'box' }: { sceneId: string; mode?: 'box' | 'content' }) {
  const ink = useStudyInk();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const path = useRef<[number, number][]>([]);
  const drawing = useRef<{ id: number; erasing: boolean } | null>(null);
  const penSeen = useRef(false);
  const frame = useRef(0);
  const touches = useRef(new Map<number, number>());
  const key = 'ink:' + sceneId;

  const size = useCallback(() => {
    const node = canvas.current; const parent = node?.parentElement; if (!node || !parent) return { w: 1, h: 1 };
    const w = parent.clientWidth || 1; const h = mode === 'content' ? contentHeight(parent, node) : parent.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (node.width !== Math.round(w * dpr) || node.height !== Math.round(h * dpr)) {
      node.width = Math.round(w * dpr); node.height = Math.round(h * dpr);
      node.style.width = w + 'px'; node.style.height = h + 'px';
    }
    return { w, h };
  }, [mode]);

  const render = useCallback(() => {
    const node = canvas.current; const context = node?.getContext('2d'); if (!node || !context) return;
    const { w, h } = size();
    const dpr = node.width / w; context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h);
    const scale = Math.min(900, Math.max(320, w)) / 1000; const dark = isDark();
    const yOf = (v: number) => (mode === 'content' ? (v / 1000) * w : (v / 1000) * h);
    for (const stroke of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      const color = INK_COLORS[stroke.c][dark ? 'dark' : 'light'];
      context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = stroke.w * scale; context.strokeStyle = color; context.fillStyle = color;
      context.globalAlpha = stroke.k === 'h' ? 0.4 : 1; context.globalCompositeOperation = stroke.k === 'h' ? (dark ? 'screen' : 'multiply') : 'source-over';
      const p = stroke.p;
      if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) { context.beginPath(); context.arc((p[0] / 1000) * w, yOf(p[1]), (stroke.w * scale) / 2, 0, Math.PI * 2); context.fill(); continue; }
      context.beginPath(); context.moveTo((p[0] / 1000) * w, yOf(p[1]));
      for (let i = 2; i + 1 < p.length; i += 2) { // smooth through the midpoints
        const mx = ((p[i - 2] + p[i]) / 2 / 1000) * w, my = yOf((p[i - 1] + p[i + 1]) / 2);
        context.quadraticCurveTo((p[i - 2] / 1000) * w, yOf(p[i - 1]), mx, my);
      }
      context.lineTo((p[p.length - 2] / 1000) * w, yOf(p[p.length - 1])); context.stroke();
    }
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  }, [mode, size]);
  const schedule = useCallback(() => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(render); }, [render]);

  const save = useCallback(() => {
    strokes.current = fitStrokes(strokes.current);
    setInkCount(sceneId, strokes.current.length); schedule();
    saveStudyModule(key, strokes.current.length ? { s: strokes.current } : null);
  }, [key, sceneId, schedule]);

  // Load what was written here before.
  useEffect(() => {
    let alive = true;
    strokes.current = []; setInkCount(sceneId, 0); schedule();
    void savedModuleState(key).then(state => { if (!alive) return; strokes.current = parseStrokes((state as { s?: unknown } | null)?.s); setInkCount(sceneId, strokes.current.length); schedule(); });
    return () => { alive = false; };
  }, [key, sceneId, schedule]);

  useEffect(() => registerInk(sceneId, {
    undo: () => { if (strokes.current.length) { strokes.current = strokes.current.slice(0, -1); save(); } },
    clear: () => { if (strokes.current.length) { strokes.current = []; save(); } },
  }), [sceneId, save]);

  // Follow the page: resizes, images loading in a scrolling page, a light or dark theme.
  useEffect(() => {
    const parent = canvas.current?.parentElement; if (!parent) return;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(parent); if (mode === 'content') Array.from(parent.children).forEach(child => { if (child !== canvas.current) observer?.observe(child); });
    parent.addEventListener('load', schedule, true);
    const theme = new MutationObserver(schedule); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    schedule();
    return () => { observer?.disconnect(); theme.disconnect(); parent.removeEventListener('load', schedule, true); cancelAnimationFrame(frame.current); };
  }, [mode, schedule]);

  const point = (event: React.PointerEvent): [number, number] => {
    const box = canvas.current!.getBoundingClientRect(); const w = box.width || 1; const h = box.height || 1;
    return [((event.clientX - box.left) / w) * 1000, mode === 'content' ? ((event.clientY - box.top) / w) * 1000 : ((event.clientY - box.top) / h) * 1000];
  };
  const erase = (x: number, y: number) => {
    const before = strokes.current.length;
    strokes.current = strokes.current.filter(stroke => !hitsStroke(stroke, x, y, ERASER_RADIUS / ((canvas.current?.getBoundingClientRect().width || 400) / 1000)));
    if (strokes.current.length !== before) { setInkCount(sceneId, strokes.current.length); schedule(); }
  };
  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!inkState().on || drawing.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.pointerType === 'pen') penSeen.current = true;
    else if (event.pointerType === 'touch' && penSeen.current) return; // a resting palm is not writing
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, event.clientY);
      // A second finger scrolls the page instead of writing on it.
      if (touches.current.size > 1) { drawing.current = null; current.current = null; path.current = []; schedule(); return; }
    }
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const erasing = inkState().tool === 'eraser'; drawing.current = { id: event.pointerId, erasing };
    const [x, y] = point(event);
    if (erasing) { erase(x, y); return; }
    path.current = [[x, y]];
    current.current = { k: inkState().tool === 'highlighter' ? 'h' : 'p', c: inkState().color, w: inkState().tool === 'highlighter' ? HIGHLIGHTER_WIDTH : PEN_WIDTH, p: decimate(path.current) };
    schedule();
  };
  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (touches.current.size > 1) {
      const previous = touches.current.get(event.pointerId);
      if (previous !== undefined && event.pointerId === Math.min(...touches.current.keys())) canvas.current?.parentElement?.scrollBy({ top: previous - event.clientY });
      if (previous !== undefined) touches.current.set(event.pointerId, event.clientY);
      return;
    }
    if (!drawing.current || drawing.current.id !== event.pointerId) return;
    const native = event.nativeEvent; const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const box = canvas.current!.getBoundingClientRect(); const w = box.width || 1; const h = box.height || 1;
    for (const item of events.length ? events : [native]) {
      const x = ((item.clientX - box.left) / w) * 1000; const y = mode === 'content' ? ((item.clientY - box.top) / w) * 1000 : ((item.clientY - box.top) / h) * 1000;
      if (drawing.current.erasing) erase(x, y); else path.current.push([x, y]);
    }
    if (current.current) { current.current = { ...current.current, p: decimate(path.current) }; schedule(); }
  };
  const onUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    touches.current.delete(event.pointerId);
    if (!drawing.current || drawing.current.id !== event.pointerId) return;
    const erased = drawing.current.erasing; drawing.current = null;
    if (!erased && current.current) strokes.current = [...strokes.current, { ...current.current, p: decimate(path.current) }];
    current.current = null; path.current = []; save();
  };

  // Esc puts the pen down; Ctrl/⌘+Z takes back the last stroke.
  useEffect(() => {
    if (!ink.on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setInkOn(false); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); strokes.current = strokes.current.slice(0, -1); save(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [ink.on, save]);

  // Keep the page's own scene in step with the store when the learner moves on while writing.
  const currentScene = useStageStore(state => state.currentSceneId);
  const active = currentScene === sceneId;
  return <canvas ref={canvas} className="study-ink" data-mode={mode} data-on={ink.on && active ? 'true' : 'false'} data-tool={ink.tool}
    aria-hidden="true" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />;
}
