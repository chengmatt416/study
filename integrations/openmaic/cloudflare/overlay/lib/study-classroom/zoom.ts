// Pinch, pan and double-tap zoom for a picture opened full screen. The picture is moved with a transform inside its own
// overlay, so the page itself is never zoomed (browser page zoom inside a fixed overlay leaves the whole classroom zoomed
// after the overlay closes). Positions are in CSS px, measured from the centre of the overlay box.

export interface ZoomView { scale: number; x: number; y: number }
export interface Size { w: number; h: number }
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
/** How far a pinch may go past the limits before it springs back on release. */
export const ZOOM_SLACK = 0.85;
export const DOUBLE_TAP_SCALE = 2.5;
export const IDENTITY: ZoomView = { scale: 1, x: 0, y: 0 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Zooms to `scale` keeping the picture point under `focus` under it, then moves by `pan` (fingers that moved while pinching). */
export function zoomAt(view: ZoomView, scale: number, focus: { x: number; y: number }, pan = { x: 0, y: 0 }): ZoomView {
  const k = scale / view.scale;
  return { scale, x: focus.x - (focus.x - view.x) * k + pan.x, y: focus.y - (focus.y - view.y) * k + pan.y };
}

/** The resting view: scale within limits, and the picture never pulled away from the edge it could still fill. */
export function settle(view: ZoomView, box: Size, picture: Size): ZoomView {
  const scale = clamp(view.scale, ZOOM_MIN, ZOOM_MAX);
  if (scale <= ZOOM_MIN + 0.01) return IDENTITY;
  const maxX = Math.max(0, (picture.w * scale - box.w) / 2);
  const maxY = Math.max(0, (picture.h * scale - box.h) / 2);
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

/** Scale while fingers are still down: a little give past the limits, so the edge is felt rather than hit. */
export const pinchScale = (start: number, ratio: number) => clamp(start * ratio, ZOOM_MIN * ZOOM_SLACK, ZOOM_MAX * 1.15);

/** Double tap: zoom in on the tapped point, or back out when already zoomed. */
export function doubleTap(view: ZoomView, focus: { x: number; y: number }, box: Size, picture: Size): ZoomView {
  return view.scale > 1.05 ? IDENTITY : settle(zoomAt(view, DOUBLE_TAP_SCALE, focus), box, picture);
}
