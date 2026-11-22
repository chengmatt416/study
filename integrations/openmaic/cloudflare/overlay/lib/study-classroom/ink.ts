'use client';
// Writing on a page: pen, highlighter and eraser. Strokes are stored in thousandths of the page's width (and height, or
// width again for a scrolling page), so they stay on the same words whatever the screen size.
import { useSyncExternalStore } from 'react';

export type InkTool = 'pen' | 'highlighter' | 'eraser';
export type InkColor = 'ink' | 'red' | 'blue' | 'green' | 'yellow';
export interface Stroke { k: 'p' | 'h'; c: InkColor; w: number; p: number[] }

export const INK_COLORS: Record<InkColor, { light: string; dark: string; label: string }> = {
  ink: { light: '#0f172a', dark: '#f1f5f9', label: '黑' },
  red: { light: '#dc2626', dark: '#f87171', label: '紅' },
  blue: { light: '#2563eb', dark: '#60a5fa', label: '藍' },
  green: { light: '#16a34a', dark: '#4ade80', label: '綠' },
  yellow: { light: '#facc15', dark: '#fde047', label: '黃' },
};
export const INK_MAX_BYTES = 36000;
export const MAX_POINTS = 600;
export const PEN_WIDTH = 6;
export const HIGHLIGHTER_WIDTH = 34;
export const ERASER_RADIUS = 22;

const isColor = (value: unknown): value is InkColor => typeof value === 'string' && value in INK_COLORS;

/** Strokes read back from storage; anything that is not a well-formed stroke is dropped. */
export function parseStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];
  const strokes: Stroke[] = [];
  for (const item of value) {
    const stroke = item as Partial<Stroke> | null;
    if (!stroke || (stroke.k !== 'p' && stroke.k !== 'h') || !isColor(stroke.c) || typeof stroke.w !== 'number' || !Array.isArray(stroke.p)) continue;
    if (stroke.p.length < 2 || stroke.p.length > MAX_POINTS * 2 || stroke.p.length % 2 !== 0 || !stroke.p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= -50 && n <= 20000)) continue;
    strokes.push({ k: stroke.k, c: stroke.c, w: Math.min(80, Math.max(1, stroke.w)), p: stroke.p.map(n => Math.round(n)) });
  }
  return strokes;
}

/** Thins a drawn path: points closer than `min` thousandths to the last kept one are skipped, and the path is capped. */
export function decimate(points: readonly (readonly [number, number])[], min = 2.5): number[] {
  const out: number[] = [];
  let last: readonly [number, number] | null = null;
  points.forEach((point, index) => {
    const end = index === points.length - 1;
    if (last && !end && Math.hypot(point[0] - last[0], point[1] - last[1]) < min) return;
    out.push(Math.round(point[0]), Math.round(point[1])); last = point;
  });
  if (out.length === 2) out.push(out[0], out[1]); // a tap is a dot
  while (out.length > MAX_POINTS * 2) { // too long: keep every other point, always keeping the end
    const keep: number[] = [];
    for (let i = 0; i < out.length; i += 4) keep.push(out[i], out[i + 1]);
    keep.push(out[out.length - 2], out[out.length - 1]);
    out.length = 0; out.push(...keep);
  }
  return out;
}

export const strokeBytes = (strokes: readonly Stroke[]): number => JSON.stringify(strokes).length;
/** The newest strokes that fit in the size limit; older ones are dropped first. */
export function fitStrokes(strokes: readonly Stroke[], limit = INK_MAX_BYTES): Stroke[] {
  let kept = [...strokes];
  while (kept.length > 1 && strokeBytes(kept) > limit) kept = kept.slice(1);
  return kept;
}

/** Whether a point (in the same thousandths) is within `radius` of any segment of the stroke. */
export function hitsStroke(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const p = stroke.p;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1];
    const bx = i + 3 < p.length ? p[i + 2] : ax, by = i + 3 < p.length ? p[i + 3] : ay;
    const dx = bx - ax, dy = by - ay; const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= radius + stroke.w / 2) return true;
  }
  return false;
}

interface InkState { on: boolean; tool: InkTool; color: InkColor; counts: Record<string, number> }
let state: InkState = { on: false, tool: 'pen', color: 'ink', counts: {} };
const listeners = new Set<() => void>();
const publish = (next: Partial<InkState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
export const useStudyInk = (): InkState => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => state);
/** The current pen settings, read at the moment a stroke starts so a tool change is never one render late. */
export const inkState = (): InkState => state;
export function setInkOn(on: boolean) { if (state.on !== on) publish({ on }); }
export function setInkTool(tool: InkTool) { publish({ tool, on: true }); }
export function setInkColor(color: InkColor) { publish({ color, on: true, tool: state.tool === 'eraser' ? 'pen' : state.tool }); }
export function setInkCount(sceneId: string, count: number) { if (state.counts[sceneId] !== count) publish({ counts: { ...state.counts, [sceneId]: count } }); }

/** The page's writing layer registers what the toolbar can do to it. */
export interface InkHandle { undo: () => void; clear: () => void }
const handles = new Map<string, InkHandle>();
export function registerInk(sceneId: string, handle: InkHandle): () => void { handles.set(sceneId, handle); return () => { if (handles.get(sceneId) === handle) handles.delete(sceneId); }; }
export const inkUndo = (sceneId: string) => handles.get(sceneId)?.undo();
export const inkClear = (sceneId: string) => handles.get(sceneId)?.clear();
