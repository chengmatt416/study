'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PPTElement, Slide } from '@openmaic/dsl';
import { useInlineMath, useInnerHtml } from '@openmaic/renderer';
import { useResolvedSlide } from '@/components/slide-renderer/use-resolved-slide';
import { SCREEN_ELEMENT_ID_PREFIX } from '@/components/slide-renderer/element-dom';
import { useCanvasStore } from '@/lib/store/canvas';
import { useStageStore } from '@/lib/store/stage';
import { StudyInkCanvas } from './StudyInk';
import { NO_AIM, laserPoint, resolveAimRegion, resolveAimTarget, safeLaserColor, type AimView } from '@/lib/study-classroom/slide-aim';
import { plainText, reflowSlide, type ReflowBlock } from '@/lib/study-classroom/slide-reflow';
import { doubleTap, IDENTITY, pinchScale, settle, zoomAt, type ZoomView } from '@/lib/study-classroom/zoom';
import './classroom.css';

function Prose({ html, className = '' }: { html: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useInnerHtml(html);
  useInlineMath(ref, html);
  return <div ref={ref} data-inline-math-root="" className={`text ProseMirror-static study-reader-prose ${className}`} dangerouslySetInnerHTML={inner} />;
}

/** A figure that opens full screen on tap, where it can be pinched: slide pictures carry detail a phone column cannot show. */
function ZoomFigure({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return <figure className="study-reader-figure">
    <button type="button" className="study-reader-zoom" onClick={() => setOpen(true)} aria-label={`放大圖片${alt ? '：' + alt : ''}`}>
      <img src={src} alt={alt} loading="lazy" draggable={false} />
    </button>
    {open && typeof document !== 'undefined' && createPortal(<ZoomLightbox src={src} alt={alt} onClose={() => setOpen(false)} />, document.body)}
  </figure>;
}

/**
 * Full-screen picture with its own pinch, pan and double-tap zoom. The page is never zoomed: the overlay takes every touch
 * (touch-action: none) and moves only the picture. A tap on the dark area closes it when the picture is not zoomed in.
 */
function ZoomLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<ZoomView>(IDENTITY);
  const [animate, setAnimate] = useState(false);
  const live = useRef(view);
  live.current = view;
  useEffect(() => {
    const el = box.current, img = picture.current;
    if (!el || !img) return;
    const sizes = () => ({ box: { w: el.clientWidth, h: el.clientHeight }, picture: { w: img.offsetWidth, h: img.offsetHeight } });
    const centre = (x: number, y: number) => { const r = el.getBoundingClientRect(); return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 }; };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { start: ZoomView; dist: number; mid: { x: number; y: number } } | null = null;
    let pan: { start: ZoomView; x: number; y: number } | null = null;
    let moved = false, lastTap = 0, lastTapAt = { x: 0, y: 0 }, closeTimer = 0;
    const show = (next: ZoomView, smooth: boolean) => { setAnimate(smooth); setView(next); };
    const twoFingers = () => { const [a, b] = [...pointers.values()]; return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: centre((a.x + b.x) / 2, (a.y + b.y) / 2) }; };
    const down = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest('.study-lightbox-close')) return;
      el.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      window.clearTimeout(closeTimer);
      if (pointers.size === 2) { const t = twoFingers(); pinch = { start: live.current, ...t }; pan = null; moved = true; }
      else if (pointers.size === 1) { pan = { start: live.current, x: event.clientX, y: event.clientY }; moved = false; }
    };
    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const t = twoFingers();
        show(zoomAt(pinch.start, pinchScale(pinch.start.scale, t.dist / pinch.dist), pinch.mid, { x: t.mid.x - pinch.mid.x, y: t.mid.y - pinch.mid.y }), false);
      } else if (pan) {
        const dx = event.clientX - pan.x, dy = event.clientY - pan.y;
        if (Math.hypot(dx, dy) > 8) moved = true;
        if (moved && pan.start.scale > 1) { const s = sizes(); show(settle({ ...pan.start, x: pan.start.x + dx, y: pan.start.y + dy }, s.box, s.picture), false); }
      }
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      const s = sizes();
      if (pinch) {
        if (pointers.size < 2) {
          pinch = null;
          show(settle(live.current, s.box, s.picture), true);
          const [rest] = [...pointers.values()];
          pan = rest ? { start: settle(live.current, s.box, s.picture), x: rest.x, y: rest.y } : null;
        }
        return;
      }
      pan = null;
      if (moved || event.type === 'pointercancel') return;
      const now = performance.now();
      const at = centre(event.clientX, event.clientY);
      if (now - lastTap < 300 && Math.hypot(event.clientX - lastTapAt.x, event.clientY - lastTapAt.y) < 32) {
        lastTap = 0;
        show(doubleTap(live.current, at, s.box, s.picture), true);
        return;
      }
      lastTap = now; lastTapAt = { x: event.clientX, y: event.clientY };
      // A single tap on the dark area closes, once it is clear it was not the first half of a double tap.
      if (event.target === el && live.current.scale <= 1.01) closeTimer = window.setTimeout(onClose, 260);
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const s = sizes(), at = centre(event.clientX, event.clientY);
      const next = Math.min(5, Math.max(1, live.current.scale * Math.exp(-event.deltaY * 0.0025)));
      show(settle(zoomAt(live.current, next, at), s.box, s.picture), false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.clearTimeout(closeTimer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [onClose]);
  const zoomed = view.scale > 1.01;
  return <div ref={box} className="study-lightbox" role="dialog" aria-modal="true" aria-label="圖片放大檢視" data-zoomed={zoomed ? 'true' : undefined}>
    <img ref={picture} src={src} alt={alt} draggable={false} data-animate={animate ? 'true' : undefined}
      style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }} />
    <button type="button" className="study-lightbox-close" onClick={onClose} aria-label="關閉">×</button>
    {zoomed
      ? <button type="button" className="study-lightbox-reset" onClick={() => { setAnimate(true); setView(IDENTITY); }}>還原大小</button>
      : <p className="study-lightbox-hint" aria-hidden="true">雙指縮放・點兩下放大</p>}
  </div>;
}

function Block({ block }: { block: ReflowBlock }) {
  const element = block.element as PPTElement;
  switch (block.kind) {
    case 'title': return <div role="heading" aria-level={2} className="study-reader-title"><Prose html={block.html ?? ''} /></div>;
    case 'subtitle': return <div role="heading" aria-level={3} className="study-reader-subtitle"><Prose html={block.html ?? ''} /></div>;
    case 'text': return <Prose html={block.html ?? ''} className="study-reader-text" />;
    case 'image': {
      if (element.type !== 'image' || !element.src) return null;
      return <ZoomFigure src={element.src} alt={element.name ?? ''} />;
    }
    case 'table': {
      if (element.type !== 'table') return null;
      return <div className="study-reader-table"><table><tbody>{element.data.map((row, y) => <tr key={y}>{row.map(cell => cell.colspan === 0 || cell.rowspan === 0 ? null : <td key={cell.id} colSpan={cell.colspan} rowSpan={cell.rowspan}><Prose html={cell.text} /></td>)}</tr>)}</tbody></table></div>;
    }
    case 'latex': {
      if (element.type !== 'latex') return null;
      return element.html ? <div className="study-reader-latex" dangerouslySetInnerHTML={{ __html: element.html }} /> : <pre className="study-reader-code">{element.latex}</pre>;
    }
    case 'code': {
      if (element.type !== 'code') return null;
      return <pre className="study-reader-code" aria-label={element.fileName ?? element.language}>{element.lines.map(line => plainText(line.content)).join('\n')}</pre>;
    }
    case 'video': {
      if (element.type !== 'video' || !element.src) return null;
      return <video className="study-reader-video" src={element.src} poster={element.poster} controls playsInline preload="metadata" />;
    }
    case 'chart': return <p className="study-reader-note" role="note">這張圖表請轉成橫向或在較大的螢幕查看。</p>;
    default: return null;
  }
}

type LaserState = { x: number; y: number; color: string; out: boolean };

/** The red laser dot: glowing core, breathing bloom, two ripples and a short trail that lags behind when it moves. */
export function LaserLayer({ x, y, color, out }: LaserState) {
  return <span className="study-laser-layer" aria-hidden="true" data-out={out ? 'true' : undefined} style={{ '--laser': color, '--lx': `${x}px`, '--ly': `${y}px` } as React.CSSProperties}>
    <span className="study-laser-tail" data-n="3" /><span className="study-laser-tail" data-n="2" /><span className="study-laser-tail" data-n="1" />
    <span className="study-laser-dot"><span className="study-laser-body"><i className="study-laser-halo" /><i className="study-laser-ring" /><i className="study-laser-ring study-laser-ring-2" /><i className="study-laser-core" /></span></span>
  </span>;
}

/** Follows the aimed block inside the scrolling reader, glides between blocks, and fades out when the action ends. */
function LaserPointer({ laser, blocks, rootRef }: { laser?: AimView['laser']; blocks: ReflowBlock[]; rootRef: RefObject<HTMLElement | null> }) {
  const [state, setState] = useState<LaserState | null>(null);
  const blockId = laser?.blockId; const color = safeLaserColor(laser?.color);
  const kind = blockId ? blocks.find(block => block.id === blockId)?.kind : undefined;
  useLayoutEffect(() => {
    if (!blockId || !kind) { setState(previous => (previous ? { ...previous, out: true } : previous)); return; }
    const root = rootRef.current; const node = document.getElementById(SCREEN_ELEMENT_ID_PREFIX + blockId);
    if (!root || !node) return;
    const place = () => {
      const box = node.getBoundingClientRect(); const view = root.getBoundingClientRect();
      setState({ ...laserPoint(box, { left: view.left, top: view.top, scrollLeft: root.scrollLeft, scrollTop: root.scrollTop }, kind), color, out: false });
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    observer?.observe(node); observer?.observe(root);
    return () => observer?.disconnect();
  }, [blockId, kind, color, rootRef]);
  const leaving = state?.out;
  useEffect(() => { if (!leaving) return; const timer = setTimeout(() => setState(null), 320); return () => clearTimeout(timer); }, [leaving]);
  return state ? <LaserLayer {...state} /> : null;
}

const KIND_LABEL: Record<string, string> = { title: '標題', subtitle: '副標題', text: '文字', image: '圖片', table: '表格', latex: '算式', code: '程式碼', video: '影片', chart: '圖表' };

/** When the aimed block is out of sight (the learner scrolled away, or it is below the fold), say so and offer the way back. */
function AimHint({ focus, kind, rootRef, place }: { focus: string; kind: string | undefined; rootRef: RefObject<HTMLElement | null>; place: 'top' | 'bottom' }) {
  const [side, setSide] = useState<'above' | 'below' | null>(null);
  useEffect(() => {
    const root = rootRef.current; const node = focus ? document.getElementById(SCREEN_ELEMENT_ID_PREFIX + focus) : null;
    if (!root || !node) { setSide(null); return; }
    const check = () => {
      const target = node.getBoundingClientRect(); const view = root.getBoundingClientRect();
      setSide(target.bottom < view.top + 8 ? 'above' : target.top > view.bottom - 8 ? 'below' : null);
    };
    check();
    root.addEventListener('scroll', check, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    observer?.observe(root); observer?.observe(node);
    return () => { root.removeEventListener('scroll', check); observer?.disconnect(); };
  }, [focus, rootRef]);
  const back = useCallback(() => {
    const node = focus ? document.getElementById(SCREEN_ELEMENT_ID_PREFIX + focus) : null;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [focus]);
  if (side !== (place === 'top' ? 'above' : 'below')) return null;
  return <div className="study-aim-hint-wrap" data-place={place}>
    <button type="button" className="study-aim-hint" onClick={back}>
      <span aria-hidden="true">{place === 'top' ? '↑' : '↓'}</span>老師正在說明這{kind ? KIND_LABEL[kind] ?? '裡' : '裡'}
    </button>
  </div>;
}

/** Presentational part, used with an already resolved slide. `aim` says what the teacher is pointing at. */
export function StudySlideReaderView({ slide, aim = NO_AIM, overlay = null }: { slide: Slide; aim?: AimView; overlay?: React.ReactNode }) {
  const blocks = reflowSlide(slide.elements);
  const rootRef = useRef<HTMLElement>(null);
  const focus = aim.spotlight?.blockId ?? aim.laser?.blockId ?? aim.highlight[0] ?? '';
  // Aiming has to bring the target to the learner: scroll it into a comfortable spot unless it is already there.
  useEffect(() => {
    const root = rootRef.current; const node = focus ? document.getElementById(SCREEN_ELEMENT_ID_PREFIX + focus) : null;
    if (!root || !node) return;
    const target = node.getBoundingClientRect(); const view = root.getBoundingClientRect(); const margin = 24;
    if (target.top >= view.top + margin && target.bottom <= view.bottom - margin) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: target.height > view.height * 0.8 ? 'start' : 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [focus]);
  const spot = aim.spotlight;
  const label = focus ? blocks.find(block => block.id === focus) : undefined;
  return <article ref={rootRef} className="study-reader" aria-label="投影片內容" data-aim={spot ? 'spot' : undefined}
    style={{ ...(spot ? { '--aim-dim': spot.dim, '--aim-ms': `${spot.ms}ms` } : {}), ...(aim.laser ? { '--laser': safeLaserColor(aim.laser.color) } : {}) } as React.CSSProperties}>
    {focus && <AimHint focus={focus} kind={label?.kind} rootRef={rootRef} place="top" />}
    {blocks.map((block, index) => {
      const state = spot?.blockId === block.id || aim.laser?.blockId === block.id ? (spot?.blockId === block.id ? 'target' : 'pointed') : aim.highlight.includes(block.id) ? 'highlight' : undefined;
      const region = spot?.blockId === block.id ? spot.region : undefined;
      return <div key={block.id} id={SCREEN_ELEMENT_ID_PREFIX + block.id} style={{ '--i': index } as React.CSSProperties} className="study-reader-item" data-aim={state}>
        <Block block={block} />
        {region && <span className="study-aim-clip" aria-hidden="true"><span className="study-aim-region" style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }} /></span>}
      </div>;
    })}
    {!blocks.length && <p className="study-reader-note" role="note">這一頁沒有可顯示的文字，請看上方的講解或繼續下一頁。</p>}
    <LaserPointer laser={aim.laser} blocks={blocks} rootRef={rootRef} />
    {overlay}
    {focus && <AimHint focus={focus} kind={label?.kind} rootRef={rootRef} place="bottom" />}
    <span role="status" className="study-sr-only">{label?.html ? `聚焦：${plainText(label.html).slice(0, 30)}` : focus ? '聚焦：圖片或表格' : ''}</span>
  </article>;
}

/** Reads the teacher's spotlight, laser and highlight actions from the canvas store and aims them at reader blocks. */
export function StudySlideReader({ slide }: { slide: Slide }) {
  const resolved = useResolvedSlide(slide);
  const spotlightId = useCanvasStore.use.spotlightElementId();
  const spotlightOptions = useCanvasStore.use.spotlightOptions();
  const spotlightMode = useCanvasStore.use.spotlightMode();
  const geometry = useCanvasStore.use.spotlightPercentageGeometry();
  const laserId = useCanvasStore.use.laserElementId();
  const laserOptions = useCanvasStore.use.laserOptions();
  const highlighted = useCanvasStore.use.highlightedElementIds();
  const aim = useMemo<AimView>(() => {
    const blocks = reflowSlide(resolved.elements);
    const view: AimView = { highlight: [...new Set(highlighted.map(id => resolveAimTarget(resolved.elements, blocks, id)).filter((id): id is string => !!id))] };
    if (spotlightOptions && (spotlightId || (spotlightMode === 'percentage' && geometry))) {
      const hit = spotlightMode === 'percentage' && geometry ? resolveAimRegion(resolved, blocks, geometry) : null;
      const blockId = hit?.blockId ?? resolveAimTarget(resolved.elements, blocks, spotlightId);
      if (blockId) view.spotlight = { blockId, dim: Math.min(1, Math.max(0, spotlightOptions.dimness ?? 0.5)), ms: spotlightOptions.transition ?? 300, ...(hit && (hit.region.w < 100 || hit.region.h < 100) ? { region: hit.region } : {}) };
    }
    const laserBlock = laserId ? resolveAimTarget(resolved.elements, blocks, laserId) : null;
    if (laserBlock) view.laser = { blockId: laserBlock, color: laserOptions?.color };
    return view;
  }, [resolved, spotlightId, spotlightOptions, spotlightMode, geometry, laserId, laserOptions, highlighted]);
  const sceneId = useStageStore(state => state.currentSceneId);
  return <StudySlideReaderView slide={resolved} aim={aim} overlay={sceneId ? <StudyInkCanvas sceneId={sceneId} mode="content" /> : null} />;
}
