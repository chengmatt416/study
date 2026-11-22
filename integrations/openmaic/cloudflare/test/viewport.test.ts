import { expect, test } from 'vitest';
import { fitStudyInteractiveViewport } from '@/lib/study-classroom/viewport';
const html = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>@media (max-width:650px){main{display:block}}</style>';
test('responsive generated scenes use native mobile dimensions without scaling down controls', () => {
  const box = { left: 12, top: 80, width: 366, height: 480 };
  expect(fitStudyInteractiveViewport(box, html)).toEqual({ box, scale: 1 });
});
test('fixed layouts and desktop scenes retain official logical viewport geometry', () => {
  const mobile = { left: 0, top: 0, width: 320, height: 360 };
  expect(fitStudyInteractiveViewport(mobile, '<main style="width:1280px">Fixed</main>')).toMatchObject({ scale: .25, box: { width: 320, height: 180 } });
  expect(fitStudyInteractiveViewport({ left: 0, top: 0, width: 1280, height: 720 }, html)).toMatchObject({ scale: 1, box: { width: 1280, height: 720 } });
});
test('a module built from the kit uses the real phone width without writing its own media query', () => {
  const box = { left: 0, top: 80, width: 375, height: 480 };
  const kit = '<meta name="viewport" content="width=device-width,initial-scale=1"><sk-module heading="排水法"><sk-lab></sk-lab></sk-module>';
  expect(fitStudyInteractiveViewport(box, kit)).toEqual({ box, scale: 1 });
  expect(fitStudyInteractiveViewport(box, '<sk-module heading="沒有 viewport"></sk-module>').scale).toBeLessThan(1);
});
