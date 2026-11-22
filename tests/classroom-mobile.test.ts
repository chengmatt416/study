import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keyboardInset } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/phone';

const root = join(__dirname, '..', 'integrations/openmaic/cloudflare');
const css = readFileSync(join(root, 'overlay/components/study/classroom.css'), 'utf8');
const patch = readFileSync(join(root, 'patch-classroom.mjs'), 'utf8');
const app = readFileSync(join(__dirname, '..', 'src/web/styles.css'), 'utf8');

describe('phone classroom', () => {
  it('reads slides in a reflowed reader on phones only, through the Core mobile query', () => {
    for (const text of ["useMobileLayout } from '@/lib/adaptive/adaptive-provider'", 'phone ? <StudySlideReader slide={scene.content.canvas} /> : <SlideRenderer mode={mode} />', '[scene, mode, phone]']) expect(patch).toContain(text);
  });

  it('falls back past unpicked variants and scopes notes to their scene', () => {
    expect(patch).toContain('(await studyAdaptiveTarget(currentSceneId)) ?? studyFallbackTarget(currentSceneId)');
  });

  it('matches the main app tokens: shadows, gradient, radii, press and easing', () => {
    for (const shadow of ['--shadow-soft: 0 1px 3px 0 rgb(0 0 0 / 0.03), 0 6px 16px -4px rgb(0 0 0 / 0.05)', '--shadow-glow: 0 8px 24px -6px rgb(0 0 0 / 0.22)']) expect(app).toContain(shadow);
    for (const token of ['--s-soft: 0 1px 3px 0 rgb(0 0 0 / .03), 0 6px 16px -4px rgb(0 0 0 / .05)', '--s-glow: 0 8px 24px -6px rgb(0 0 0 / .22)', '--s-from: #0a0a0a; --s-to: #3f3f46', 'cubic-bezier(.22, 1, .36, 1)', 'scale(.97)', 'rgb(255 255 255 / .15)', '--s-r-btn: 16px', '--s-r-card: 24px']) expect(css).toContain(token);
  });

  it('gives the phone dock large targets, a sheet-style detail panel and no overflow', () => {
    expect(css).toContain('@media (max-width: 700px), (max-height: 500px) and (pointer: coarse)');
    expect(css).toMatch(/\.study-lesson-navigation button \{ width: 44px; height: 44px; \}/);
    expect(css).toMatch(/\.study-dialogue-actions button \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.study-dialogue-detail \{ position: absolute;/);
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toMatch(/\.study-reader img[^{]*\{|\.study-reader-figure img[^{]*\{[^}]*max-width: 100%/);
  });

  it('is well formed CSS, and the laser is a red layered pointer that stops animating for reduced motion', () => {
    let depth = 0, min = 0;
    for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) { if (char === '{') depth++; if (char === '}') min = Math.min(min, --depth); }
    expect([depth, min]).toEqual([0, 0]);
    for (const part of ['.study-laser-core', '.study-laser-halo', '.study-laser-ring-2', 'study-laser-pop', 'study-laser-ripple', 'study-laser-breathe', '--laser', '#ff1f2d']) expect(css).toContain(part);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*\.study-laser-ring \{ animation: none; \}/);
    // The reader caps every child at its container's width; the laser's zero-size layer must be exempt or the dot collapses.
    expect(css).toMatch(/\.study-reader \.study-laser-layer \*[^{]*\{ max-width: none; \}/);
  });

  it('turns ask-and-discuss into a bottom sheet on phones, with a close button and readable inputs', () => {
    expect(patch).toContain("'transition-opacity duration-300 study-discussion'");
    expect(patch).toContain('study-discussion-bar');
    for (const part of ['.study-discussion { position: fixed;', 'border-radius: 28px 28px 0 0', 'height: min(86dvh, 720px, calc(100dvh - var(--study-kb, 0px) - 8px))', '[data-testid="roundtable-region"] { flex: none; height: auto !important', '> .flex-1.flex > :not(.flex-1) { display: none; }', 'font-size: 16px !important', 'safe-area-inset-bottom']) expect(css).toContain(part);
    expect(css).toMatch(/study-discussion-bar button \{ min-height: 44px;/);
  });

  it('keeps the phone question box open, readable and above the keyboard', () => {
    for (const part of ["useStudyPhone } from '@/lib/study-classroom/phone'", 'if (studyPhone && !isInputOpen && !isVoiceOpen) setIsInputOpen(true);', '(isInputOpen || isVoiceOpen) && !studyPhone ? 0.4 : 1', 'autoFocus={!studyPhone}', '(studyPhone || !isInputOpen) && !isVoiceOpen;']) expect(patch).toContain(part);
    for (const part of ['bottom: var(--study-kb, 0px)', '.group\\/bubble { display: none !important; }', 'roundtable-non-presentation-input-stage"] > div { width: 100% !important; max-width: none !important', 'padding: 10px 10px 72px !important', 'overflow-x: auto']) expect(css).toContain(part);
    expect(css).toMatch(/roundtable-non-presentation-input-stage"\] button \{ min-width: 44px; min-height: 44px; \}/);
  });

  it('measures only a real keyboard as covering the sheet', () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 740, offsetTop: 0 })).toBe(0); // collapsing browser toolbar
    expect(keyboardInset(800, { height: 480, offsetTop: 0 })).toBe(320);
    expect(keyboardInset(800, { height: 480, offsetTop: 40 })).toBe(280); // page scrolled to reveal the field
  });

  it('warms the next two slides so they open instantly', () => {
    expect(patch).toContain('<StudyScenePrefetch />');
    expect(readFileSync(join(root, 'overlay/components/study/StudyScenePrefetch.tsx'), 'utf8')).toMatch(/slice\(index \+ 1, index \+ 3\)/);
  });

  it('shows results at once and saves behind them, and offers "I don\'t know" on pretests and checkpoints', () => {
    for (const part of ["setPhase('reviewing');\\n    recordStudyQuiz(sceneId, questions, ordered, answers);", 'savingRef.current = save()', 'await savingRef.current.catch(() => undefined);', 'const studyShown = studyQuestionsFor(sceneId, questions);', "{studyShown.map((q, i) => {", 'opt.value !== STUDY_UNSURE', 'onChange(toggleChoice(selected, optValue));']) expect(patch).toContain(part);
  });

  it('has a loading screen in the same language, with steps, tips and a skeleton of the classroom', () => {
    for (const part of ['.study-load-steps', '.study-load-tip', '.study-load-preview', '.study-load-shimmer', 'study-pop', '.study-load *']) expect(css).toContain(part);
    expect(css).toMatch(/\.study-load-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('respects reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/study-reader-item \{ animation: none; \}/);
  });
});
