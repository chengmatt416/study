import { expect, test } from 'vitest';
import { doubleTap, IDENTITY, pinchScale, settle, zoomAt, ZOOM_MAX } from '@/lib/study-classroom/zoom';

const box = { w: 400, h: 800 }, picture = { w: 400, h: 300 };

test('the picture point under the fingers stays under them while zooming and moves with them', () => {
  const focus = { x: 100, y: -50 };
  const zoomed = zoomAt(IDENTITY, 2, focus);
  // Picture point under the focus before: focus itself (identity). After: scale * point + translation = focus.
  expect(2 * focus.x + zoomed.x).toBeCloseTo(focus.x);
  expect(2 * focus.y + zoomed.y).toBeCloseTo(focus.y);
  const panned = zoomAt(IDENTITY, 2, focus, { x: 30, y: 10 });
  expect(panned.x - zoomed.x).toBeCloseTo(30);
  expect(panned.y - zoomed.y).toBeCloseTo(10);
});

test('the resting view stays within the limits and never pulls the picture off an edge it can fill', () => {
  expect(settle({ scale: 0.8, x: 40, y: 40 }, box, picture)).toEqual(IDENTITY);
  expect(settle({ scale: 9, x: 0, y: 0 }, box, picture).scale).toBe(ZOOM_MAX);
  const far = settle({ scale: 2, x: 999, y: 999 }, box, picture);
  // 2x: 800 wide in a 400 box -> may move 200 either way; 600 tall in an 800 box -> stays centred vertically.
  expect(far).toEqual({ scale: 2, x: 200, y: 0 });
  expect(pinchScale(1, 0.5)).toBeGreaterThan(0.8);
  expect(pinchScale(4, 2)).toBeLessThanOrEqual(ZOOM_MAX * 1.15);
});

test('double tap zooms in on the tapped point and back out', () => {
  const inView = doubleTap(IDENTITY, { x: 120, y: 0 }, box, picture);
  expect(inView.scale).toBe(2.5);
  expect(inView.x).toBeLessThan(0);
  expect(doubleTap(inView, { x: 0, y: 0 }, box, picture)).toEqual(IDENTITY);
});
