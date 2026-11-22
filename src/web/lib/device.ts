import { useSyncExternalStore } from "react";

export type DeviceClass = "phone" | "tablet" | "desktop";

/**
 * 裝置分類（決定使用哪一套版型）：
 * - phone：寬度 < 640
 * - tablet：640–1199，或任何觸控為主（pointer: coarse）的大螢幕（iPad 橫向 1366 也算平板）
 * - desktop：≥ 1200 且為滑鼠（pointer: fine）
 */
function compute(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (w < 640) return "phone";
  if (w < 1200 || coarse) return "tablet";
  return "desktop";
}

let current = compute();
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  const update = () => {
    const next = compute();
    if (next !== current) {
      current = next;
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("resize", update);
  window.matchMedia("(pointer: coarse)").addEventListener("change", update);
}

export function useDevice(): DeviceClass {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
    () => "desktop",
  );
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
/** LINE / Facebook / Instagram 等內建瀏覽器：Google 會拒絕在其中登入 */
export const inAppBrowser = (): "line" | "fb" | "ig" | "other" | null => {
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua)) return "line";
  if (/FBAN|FBAV/i.test(ua)) return "fb";
  if (/Instagram/i.test(ua)) return "ig";
  if (/; wv\)|WebView|MicroMessenger/i.test(ua)) return "other";
  return null;
};
