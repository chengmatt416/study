import type { ClientBox } from '@/lib/edit/visible-client-rect';
import { fitGenUiViewport } from '@/lib/interactive/logical-viewport';

// Responsive generated documents need the real viewport so their media
// queries and touch targets work. Fixed-size legacy scenes retain their scale.
export function fitStudyInteractiveViewport(slot: ClientBox, html = '') {
  // A page built from the module kit is responsive without a media query of its own: the kit's stylesheet, injected
  // after this source is read, carries the phone layout, and the kit guide tells authors not to write CSS.
  const responsive = /<meta\b[^>]*\bname\s*=\s*['"]viewport['"][^>]*>/i.test(html)
    && (/@media[^{}]*(?:max-width|min-width|\bwidth\s*[<>=])/i.test(html) || /<sk-[a-z]/.test(html));
  if (responsive && slot.width > 0 && slot.width < 700 && slot.height > 0) return { box: slot, scale: 1 };
  return fitGenUiViewport(slot);
}
