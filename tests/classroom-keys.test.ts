import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spaceContinues } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/dialogue';
import { STUDY_KIT_JS } from '../src/shared/module-kit';

// A stand-in for a DOM node: closest() answers true when the selector list names the element's own tag or role.
const target = (tag: string, role?: string) => ({ closest: (selector: string) => selector.split(',').map(part => part.trim()).some(part => part === tag || (role !== undefined && part === `[role=${role}]`)) ? {} as Element : null }) as unknown as EventTarget;
const press = (over: Partial<Parameters<typeof spaceContinues>[0]> = {}) => spaceContinues({ key: ' ', target: target('body'), ...over });

describe('Space continues the lesson', () => {
  it('moves on from the page itself', () => {
    expect(press()).toBe(true);
    expect(press({ target: null })).toBe(true);
  });

  it('leaves Space to fields, buttons, links, sliders and dialogs', () => {
    for (const tag of ['input', 'textarea', 'select', 'button', 'summary', 'label']) expect(press({ target: target(tag) }), tag).toBe(false);
    for (const role of ['button', 'slider', 'radio', 'checkbox', 'switch', 'tab', 'dialog', 'textbox']) expect(press({ target: target('div', role) }), role).toBe(false);
  });

  it('ignores other keys, held keys, shortcuts, composition and handled events', () => {
    expect(press({ key: 'Enter' })).toBe(false);
    expect(press({ repeat: true })).toBe(false);
    for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) expect(press({ [key]: true }), key).toBe(false);
    expect(press({ isComposing: true })).toBe(false);
    expect(press({ defaultPrevented: true })).toBe(false);
  });

  it('is wired into the lesson dock, from the page and from inside an interactive module', () => {
    const dock = readFileSync('integrations/openmaic/cloudflare/overlay/components/study/StudyLessonDock.tsx', 'utf8');
    expect(dock).toContain("spaceContinues(event)");
    expect(dock).toContain("window.addEventListener('keydown', onKey)");
    expect(dock).toMatch(/data\.source !== 'study-kit-key'/);
    expect(dock).toMatch(/frame\.contentWindow === event\.source/);
    expect(dock).toContain('空白鍵');
  });

  it('passes an unused Space press up from the module page, without taking it from controls', () => {
    expect(STUDY_KIT_JS).toContain("source:'study-kit-key'");
    expect(STUDY_KIT_JS).toMatch(/ev\.key!==' '/);
    expect(STUDY_KIT_JS).toContain('window.parent===window');
    for (const own of ['input', 'textarea', 'button', '[role=slider]', '[tabindex]']) expect(STUDY_KIT_JS).toContain(own);
  });
});
