import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { INK_MAX_BYTES, MAX_POINTS, decimate, fitStrokes, hitsStroke, parseStrokes, strokeBytes, type Stroke } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/ink';

const root = 'integrations/openmaic/cloudflare/';
const read = (file: string) => readFileSync(root + file, 'utf8');
const stroke = (over: Partial<Stroke> = {}): Stroke => ({ k: 'p', c: 'ink', w: 6, p: [0, 0, 100, 100], ...over });

describe('handwriting strokes', () => {
  it('thins a drawn path, keeps its end, turns a tap into a dot, and caps its length', () => {
    expect(decimate([[0, 0], [0.5, 0.5], [1, 1], [10, 10]])).toEqual([0, 0, 10, 10]);
    expect(decimate([[5, 5]])).toEqual([5, 5, 5, 5]);
    const long = decimate(Array.from({ length: 5000 }, (_, i) => [i * 3, i % 7] as [number, number]));
    expect(long.length).toBeLessThanOrEqual(MAX_POINTS * 2 + 4);
    expect(long.slice(-2)).toEqual([4999 * 3, 4999 % 7]);
  });

  it('reads back only well-formed strokes from storage', () => {
    expect(parseStrokes([stroke(), { k: 'x' }, null, stroke({ c: 'purple' as never }), stroke({ p: [1, 2, 3] }), stroke({ p: [1, 'a', 3, 4] as never }), 'text'])).toEqual([stroke()]);
    expect(parseStrokes(undefined)).toEqual([]);
    expect(parseStrokes([stroke({ w: 9999 })])[0].w).toBe(80);
    expect(parseStrokes([stroke({ p: Array(MAX_POINTS * 2 + 2).fill(1) })])).toEqual([]);
  });

  it('drops the oldest strokes first when a page has too many to save', () => {
    const many = Array.from({ length: 400 }, (_, i) => stroke({ p: Array.from({ length: 200 }, (_, j) => (i + j) % 1000) }));
    const kept = fitStrokes(many);
    expect(strokeBytes(kept)).toBeLessThanOrEqual(INK_MAX_BYTES);
    expect(kept.at(-1)).toBe(many.at(-1));
    expect(kept.length).toBeLessThan(many.length);
    expect(fitStrokes([stroke()])).toHaveLength(1);
  });

  it('erases a stroke the eraser touches, and only that one', () => {
    const diagonal = stroke({ p: [0, 0, 500, 500] });
    expect(hitsStroke(diagonal, 250, 250, 5)).toBe(true);
    expect(hitsStroke(diagonal, 250, 270, 5)).toBe(false);
    expect(hitsStroke(diagonal, 250, 270, 30)).toBe(true);
    expect(hitsStroke(stroke({ p: [100, 100, 100, 100] }), 103, 100, 2)).toBe(true);
  });
});

describe('writing on the page is wired in', () => {
  it('has a pen button on slides and interactive modules, and the tools float above the dock while it is on', () => {
    const dock = read('overlay/components/study/StudyLessonDock.tsx');
    expect(dock).toContain("sceneType === 'slide' || sceneType === 'interactive'");
    expect(dock).toContain('寫字');
    expect(dock).toContain('<StudyInkBar sceneId={sceneId} />');
    expect(dock).toContain('setInkOn(false)');
    const bar = read('overlay/components/study/StudyInkBar.tsx');
    for (const part of ['螢光筆', '橡皮擦', '復原上一筆', '再按一次清除這一頁所有筆跡', '完成']) expect(bar, part).toContain(part);
  });

  it('puts the pen layer on desktop slides, over the interactive frame, and inside the scrolling phone reader', () => {
    const patch = read('patch-classroom.mjs');
    expect(patch).toContain("scene.type === 'slide' && !phone && <StudyInkCanvas sceneId={scene.id} />");
    expect(patch).toContain('<StudyInkCanvas sceneId={sceneId} />\\n      {showRuntimeError');
    const reader = read('overlay/components/study/StudySlideReader.tsx');
    expect(reader).toContain('<StudyInkCanvas sceneId={sceneId} mode="content" />');
    expect(reader).toContain('{overlay}');
  });

  it('only takes the pointer while writing, ignores a resting palm, scrolls with a second finger, and saves under the page’s own key', () => {
    const canvas = read('overlay/components/study/StudyInk.tsx');
    expect(canvas).toContain("'ink:' + sceneId");
    expect(canvas).toContain('penSeen');
    expect(canvas).toContain('touches.current.size > 1');
    expect(canvas).toContain('getCoalescedEvents');
    const css = read('overlay/components/study/classroom.css');
    expect(css).toMatch(/\.study-ink \{[^}]*pointer-events: none;/);
    expect(css).toMatch(/\.study-ink\[data-on="true"\] \{ pointer-events: auto; touch-action: none;/);
    expect(read('overlay/lib/study-classroom/progress.ts')).toContain("!sceneId.startsWith('ink:')");
  });
});
