import { describe, expect, it } from 'vitest';
import { clampReadingPage, initialReadingPage, visibleReadingPage } from '../src/web/features/reader/reading-page';

describe('reader initial page and explicit links', () => {
  it('uses the saved place unless the link explicitly chooses a PDF or printed page', () => {
    expect(initialReadingPage(new URLSearchParams(), 37, 4, 80)).toBe(37);
    expect(initialReadingPage(new URLSearchParams('page=12'), 37, 4, 80)).toBe(12);
    expect(initialReadingPage(new URLSearchParams('printed=12'), 37, 4, 80)).toBe(16);
    expect(initialReadingPage(new URLSearchParams('page=3&printed=5'), 37, -2, 80)).toBe(3);
  });
  it('never passes nonfinite, fractional or out-of-range page indices to the viewer', () => {
    for (const value of [NaN, Infinity, -Infinity, -2, 0]) expect(clampReadingPage(value, 6)).toBe(1);
    expect(initialReadingPage(new URLSearchParams('page=999'), 37, 0, 6)).toBe(6);
    expect(initialReadingPage(new URLSearchParams('printed=nope'), 37, 2, 6)).toBe(1);
    expect(clampReadingPage(3.9, 6)).toBe(3);
    expect(initialReadingPage(new URLSearchParams(), null, 0, 6)).toBe(1);
  });
  it('keeps the selected page current when several short landscape pages fit in a tall viewport', () => {
    expect(visibleReadingPage(2 * (240 + 16), 900, 240, 16, 6)).toBe(3);
    expect(visibleReadingPage(5 * (240 + 16), 900, 240, 16, 6)).toBe(6);
    expect(visibleReadingPage(2 * (800 + 16), 900, 800, 16, 6)).toBe(3);
    expect(visibleReadingPage(-500, 900, 240, 16, 6)).toBe(1);
  });
});
