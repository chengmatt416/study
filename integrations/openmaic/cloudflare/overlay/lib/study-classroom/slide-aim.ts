// Aiming for the phone reader. Spotlight, laser and highlight actions name an element of the 1000px slide canvas,
// but the reader shows a reflowed column in which some elements have no block (decoration) and positions are gone.
// These pure functions map an action's target onto a reader block, and a canvas region onto a spot inside a block.
import type { PPTElement } from '@openmaic/dsl';
import type { ReflowBlock } from './slide-reflow';

export interface AimGeometry { x: number; y: number; w: number; h: number; centerX?: number; centerY?: number }
export interface AimRegion { x: number; y: number; w: number; h: number }
type Box = { left: number; top: number; width: number; height: number };

const boxOf = (element: PPTElement): Box => ({ left: element.left, top: element.top, width: element.width, height: 'height' in element ? element.height : 0 });
const centerOf = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
const distance = (a: Box, b: Box) => { const p = centerOf(a), q = centerOf(b); return Math.hypot(p.x - q.x, p.y - q.y); };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

function nearestBlock(blocks: readonly ReflowBlock[], box: Box): ReflowBlock | null {
  let best: ReflowBlock | null = null; let score = Infinity;
  for (const block of blocks) { const d = distance(boxOf(block.element), box); if (d < score) { score = d; best = block; } }
  return best;
}

/** The reader block an element-targeted action should land on, or null when nothing on the slide matches. */
export function resolveAimTarget(elements: readonly PPTElement[], blocks: readonly ReflowBlock[], elementId: string): string | null {
  if (!elementId || !blocks.length) return null;
  if (blocks.some(block => block.id === elementId)) return elementId;
  const element = elements.find(item => item.id === elementId);
  if (!element) return null;
  const box = boxOf(element);
  // A dropped element (a decorative shape behind a text, a line, a background) aims at what sits on it.
  const covering = blocks.filter(block => overlap(boxOf(block.element), box) > 0).sort((a, b) => overlap(boxOf(b.element), box) - overlap(boxOf(a.element), box))[0];
  return (covering ?? nearestBlock(blocks, box))?.id ?? null;
}

/** A canvas region (percent of the slide) as a block plus the part of that block it covers (percent of the block). */
export function resolveAimRegion(canvas: { viewportSize?: number; viewportRatio?: number }, blocks: readonly ReflowBlock[], geometry: AimGeometry): { blockId: string; region: AimRegion } | null {
  if (!blocks.length) return null;
  const width = canvas.viewportSize ?? 1000; const height = width * (canvas.viewportRatio ?? 0.5625);
  const region: Box = { left: (geometry.x / 100) * width, top: (geometry.y / 100) * height, width: (geometry.w / 100) * width, height: (geometry.h / 100) * height };
  let best: ReflowBlock | null = null; let area = 0;
  for (const block of blocks) { const a = overlap(boxOf(block.element), region); if (a > area) { area = a; best = block; } }
  if (!best || area <= 0) { const near = nearestBlock(blocks, region); return near ? { blockId: near.id, region: { x: 0, y: 0, w: 100, h: 100 } } : null; }
  const box = boxOf(best.element);
  const left = Math.max(region.left, box.left), top = Math.max(region.top, box.top);
  const right = Math.min(region.left + region.width, box.left + box.width), bottom = Math.min(region.top + region.height, box.top + box.height);
  const pct = (value: number, total: number) => Math.round(Math.min(100, Math.max(0, (value / (total || 1)) * 100)) * 10) / 10;
  return { blockId: best.id, region: { x: pct(left - box.left, box.width), y: pct(top - box.top, box.height), w: pct(right - left, box.width), h: pct(bottom - top, box.height) } };
}

const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/-]{3,40}\))$/i;
export const LASER_RED = '#ff1f2d';
/** The laser color from the action, or red. Only plain color syntax is let through into a style attribute. */
export function safeLaserColor(color: unknown): string {
  return typeof color === 'string' && COLOR.test(color.trim()) ? color.trim() : LASER_RED;
}

/** Where the pointer sits on a block, in px from the block's top left: in the margin beside the first line of text, the middle of anything else. */
export function laserOffset(kind: ReflowBlock['kind'], width: number, height: number): { x: number; y: number } {
  if (kind === 'title') return { x: Math.max(8, width - 8), y: 22 };
  if (kind === 'subtitle') return { x: Math.max(8, width - 8), y: 18 };
  if (kind === 'text') return { x: Math.max(8, width - 11), y: Math.min(28, Math.max(10, height / 2)) };
  return { x: width / 2, y: height / 2 };
}

/** The pointer position inside the scrolling reader (content coordinates), from the block's and the reader's boxes and scroll. */
export function laserPoint(block: { left: number; top: number; width: number; height: number }, reader: { left: number; top: number; scrollLeft: number; scrollTop: number }, kind: ReflowBlock['kind']): { x: number; y: number } {
  const at = laserOffset(kind, block.width, block.height);
  return { x: Math.round(block.left - reader.left + reader.scrollLeft + at.x), y: Math.round(block.top - reader.top + reader.scrollTop + at.y) };
}

export interface AimView {
  /** Block to spotlight, how strongly the rest dims (0-1), how long the change takes, and an optional spot inside the block. */
  spotlight?: { blockId: string; dim: number; ms: number; region?: AimRegion };
  laser?: { blockId: string; color?: string };
  highlight: string[];
}
export const NO_AIM: AimView = { highlight: [] };
