import { expect, test } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { reflowSlide } from '@/lib/study-classroom/slide-reflow';
import { LASER_RED, laserOffset, laserPoint, resolveAimRegion, resolveAimTarget, safeLaserColor } from '@/lib/study-classroom/slide-aim';

const text = (id: string, top: number, left: number, width = 400, height = 100, over: Record<string, unknown> = {}) => ({ rotate: 0, id, type: 'text', top, left, width, height, content: `<p>${id}</p>`, defaultFontName: 'x', defaultColor: '#000', ...over }) as unknown as PPTElement;
const shape = (id: string, top: number, left: number, width: number, height: number) => ({ rotate: 0, id, type: 'shape', top, left, width, height, viewBox: [1, 1], path: '', fixedRatio: false, fill: '#fff' }) as unknown as PPTElement;
const image = (id: string, top: number, left: number) => ({ rotate: 0, id, type: 'image', top, left, width: 300, height: 200, fixedRatio: true, src: 'u' }) as unknown as PPTElement;

const elements = [shape('card', 90, 20, 440, 140), text('a', 100, 40), text('b', 400, 40), image('fig', 120, 600), shape('deco', 520, 900, 40, 40), { rotate: 0, id: 'ln', type: 'line', top: 340, left: 40, width: 200, start: [0, 0], end: [1, 1] } as unknown as PPTElement];
const blocks = reflowSlide(elements);

test('aims straight at an element that became a block', () => {
  expect(resolveAimTarget(elements, blocks, 'a')).toBe('a');
  expect(resolveAimTarget(elements, blocks, 'fig')).toBe('fig');
});

test('aims at what sits on a dropped decoration, or the nearest block', () => {
  expect(resolveAimTarget(elements, blocks, 'card')).toBe('a');
  expect(resolveAimTarget(elements, blocks, 'ln')).toBe('b');
  expect(resolveAimTarget(elements, blocks, 'deco')).toBe('fig');
});

test('returns null for unknown targets and empty slides', () => {
  expect(resolveAimTarget(elements, blocks, 'nope')).toBeNull();
  expect(resolveAimTarget(elements, blocks, '')).toBeNull();
  expect(resolveAimTarget(elements, [], 'a')).toBeNull();
});

test('maps a canvas region onto the block it covers, as a percent of that block', () => {
  const hit = resolveAimRegion({ viewportSize: 1000, viewportRatio: 0.5625 }, blocks, { x: 75, y: (120 / 562.5) * 100, w: 15, h: (200 / 562.5) * 100 });
  expect(hit?.blockId).toBe('fig');
  expect(hit?.region.x).toBeCloseTo(50, 0);
  expect(hit?.region.w).toBeCloseTo(50, 0);
  expect(hit?.region.h).toBeCloseTo(100, 0);
});

test('a region over empty space falls back to the nearest block, whole', () => {
  const hit = resolveAimRegion({}, blocks, { x: 96, y: 88, w: 3, h: 3 });
  expect(hit).toMatchObject({ blockId: 'fig', region: { x: 0, y: 0, w: 100, h: 100 } });
});

test('a region that only grazes a block is clipped to the block', () => {
  const hit = resolveAimRegion({}, blocks, { x: 2, y: 80, w: 3, h: 3 });
  expect(hit?.blockId).toBe('b');
  expect(hit?.region.x).toBe(0);
  expect(hit?.region.w).toBeLessThan(100);
});

test('the laser is red unless the action names a plain color', () => {
  expect(LASER_RED).toBe('#ff1f2d');
  expect(safeLaserColor('#ff0000')).toBe('#ff0000');
  expect(safeLaserColor(' rgb(255, 40, 40) ')).toBe('rgb(255, 40, 40)');
  expect(safeLaserColor('hsl(0 90% 55% / .9)')).toBe('hsl(0 90% 55% / .9)');
  for (const bad of ['red;position:fixed', 'url(x)', 'javascript:1', '#', '', undefined, null, 5]) expect(safeLaserColor(bad)).toBe(LASER_RED);
});

test('the pointer sits in the margin beside the first line of text, and in the middle of figures', () => {
  expect(laserOffset('text', 300, 200)).toEqual({ x: 289, y: 28 });
  expect(laserOffset('text', 300, 30)).toEqual({ x: 289, y: 15 });
  expect(laserOffset('title', 300, 80)).toEqual({ x: 292, y: 22 });
  expect(laserOffset('image', 300, 200)).toEqual({ x: 150, y: 100 });
  expect(laserOffset('text', 4, 4).x).toBeGreaterThanOrEqual(8);
});

test('the pointer position is in reader content coordinates, so it stays on the block while scrolling', () => {
  const block = { left: 16, top: 300, width: 300, height: 120 };
  expect(laserPoint(block, { left: 0, top: 0, scrollLeft: 0, scrollTop: 0 }, 'text')).toEqual({ x: 305, y: 328 });
  expect(laserPoint({ ...block, top: 100 }, { left: 0, top: 0, scrollLeft: 0, scrollTop: 200 }, 'text')).toEqual({ x: 305, y: 328 });
});
