import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isStudyPanelLocked, lockStudyPanel, shouldUnlockPanel, unlockStudyPanel } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/lock';
import { STUDY_KIT_CSS, STUDY_KIT_JS } from '../src/shared/module-kit';
import { STUDY_LAB_JS } from '../src/shared/module-lab';

const root = 'integrations/openmaic/cloudflare/';
const read = (file: string) => readFileSync(root + file, 'utf8');

describe('the interactive panel is locked until the dialogue says to operate it', () => {
  it('locks a registered scene and opens it once, for good', () => {
    lockStudyPanel('lock-a', false); expect(isStudyPanelLocked('lock-a')).toBe(true);
    lockStudyPanel('lock-a', true); expect(isStudyPanelLocked('lock-a')).toBe(true);
    unlockStudyPanel('lock-a'); expect(isStudyPanelLocked('lock-a')).toBe(false);
    lockStudyPanel('lock-a', true); expect(isStudyPanelLocked('lock-a')).toBe(false);
  });

  it('opens when the teacher says to operate it, when the dialogue is over, or when there is no dialogue to wait for', () => {
    expect(shouldUnlockPanel({ completed: false, cue: false, hasDialogue: true })).toBe(false);
    expect(shouldUnlockPanel({ completed: false, cue: true, hasDialogue: true })).toBe(true);
    expect(shouldUnlockPanel({ completed: true, cue: false, hasDialogue: true })).toBe(true);
    expect(shouldUnlockPanel({ completed: false, cue: false, hasDialogue: false })).toBe(true);
  });

  it('is wired from the dock to the panel host: registered on interactive scenes, drawn over the frame, which is made inert', () => {
    const dock = read('overlay/components/study/StudyLessonDock.tsx');
    expect(dock).toContain("sceneType === 'interactive'");
    expect(dock).toContain('lockStudyPanel(sceneId, started)');
    expect(dock).toContain('unlockStudyPanel(sceneId)');
    const patch = read('patch-classroom.mjs');
    expect(patch).toContain('<StudyPanelLock sceneId={sceneId} />');
    expect(patch).toContain('inert={studyLock ? true : undefined}');
    const overlay = read('overlay/components/study/StudyPanelLock.tsx');
    expect(overlay).toContain('先自己試試');
    expect(overlay).toContain('開始學習');
    expect(read('overlay/components/study/classroom.css')).toMatch(/\.study-panel-lock\[data-locked="true"\] \{[^}]*pointer-events: auto/);
  });
});

describe('the classroom remembers where the learner was', () => {
  it('resumes the last scene, saves scene changes, and restores saved module state when a module reports ready', () => {
    const progress = read('overlay/lib/study-classroom/progress.ts');
    expect(progress).toContain('/api/openmaic/live/progress');
    expect(progress).toContain('store.setCurrentSceneId(target)');
    expect(progress).toContain('saveStudyScene(currentId, index)');
    expect(progress).toContain("window.addEventListener('pagehide'");
    expect(read('overlay/components/study/StudyClassroomHost.tsx')).toContain('useStudyResume()');
    const bridge = read('overlay/lib/study-classroom/adaptive.ts');
    expect(bridge).toContain("progress.source === 'study-kit-state'");
    expect(bridge).toContain("type: 'STUDY_KIT_RESTORE'");
    expect(bridge).toContain('sceneOfFrame(event.source)');
  });

  it('has the kit announce itself, report changes, and accept only the parent’s restore', () => {
    expect(STUDY_KIT_JS).toContain("source:'study-kit-state'");
    expect(STUDY_KIT_JS).toContain('ready:true');
    expect(STUDY_KIT_JS).toContain("d.type==='STUDY_KIT_RESTORE'");
    expect(STUDY_KIT_JS).toContain('ev.source===window.parent');
    expect(STUDY_KIT_JS).toContain('function snapshot()');
    expect(STUDY_KIT_JS).toContain('function restore(state)');
    // A restore must not count as the learner's own activity.
    expect(STUDY_KIT_JS).toContain('if(!restoring)stats.controls++');
  });

  it('can restore every question type without re-answering it', () => {
    for (const tag of ['sk-choice', 'sk-numeric', 'sk-order', 'sk-match', 'sk-sort', 'sk-label', 'sk-pick', 'sk-fill', 'sk-balance', 'sk-tune']) {
      const body = STUDY_KIT_JS.slice(STUDY_KIT_JS.indexOf("define('" + tag + "'"));
      const end = body.indexOf('\ndefine(', 10) > 0 ? body.indexOf('\ndefine(', 10) : body.length;
      expect(body.slice(0, end), tag).toMatch(/e\.__solve=|e\.__restore=/);
    }
    for (const tag of ['sk-steps', 'sk-tabs', 'sk-reveal', 'sk-hints']) expect(STUDY_KIT_JS.slice(STUDY_KIT_JS.indexOf("define('" + tag + "'"))).toContain('e.__restore=');
  });
});

describe('reset is a polished control', () => {
  it('turns its arrow, asks twice before wiping the lab bench, and rebuilds the bench with a fade', () => {
    expect(STUDY_KIT_JS).toContain('function resetBtn(label,fn,confirm)');
    expect(STUDY_KIT_JS).toContain('再按一次確認');
    expect(STUDY_KIT_JS).toContain('resetButton:resetBtn');
    expect(STUDY_KIT_CSS).toContain('@keyframes sk-rotate');
    expect(STUDY_KIT_CSS).toContain('.sk-reset.sk-confirm');
    expect(STUDY_KIT_CSS).toContain('sk-lab.lab-rebuilt .lab-svg');
    expect(STUDY_LAB_JS).toContain("K.resetButton('重設實驗桌'");
    expect(STUDY_LAB_JS).toContain("el.classList.add('lab-rebuilt')");
  });

  it('is offered on every drag, sort, order and build question', () => {
    expect((STUDY_KIT_JS.match(/resetBtn\('重來'/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
});

describe('the phone slide reader and its aiming', () => {
  const css = read('overlay/components/study/classroom.css');
  const reader = read('overlay/components/study/StudySlideReader.tsx');
  it('keeps the spotlight and laser up until the learner moves on, instead of five seconds', () => {
    const patch = read('patch-classroom.mjs');
    expect(patch).toContain('Math.max(EFFECT_AUTO_CLEAR_MS, 10 * 60 * 1000)');
    expect(patch).toMatch(/this\.actionEngine\.clearEffects\(\);\n\s+this\.processNext\(\);/);
  });

  it('says where the teacher is pointing when it is out of sight, and offers the way back', () => {
    expect(reader).toContain('老師正在說明這');
    expect(reader).toContain("place=\"top\"");
    expect(reader).toContain("place=\"bottom\"");
    expect(css).toMatch(/\.study-aim-hint-wrap \{ position: sticky;/);
  });

  it('is designed for a phone: roomy type, thumb-sized controls, a zoomable figure, scroll-hinted tables, safe areas', () => {
    expect(css).toMatch(/\.study-reader \{ padding: 22px 16px calc\(32px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toContain('.study-lightbox');
    // The picture zooms inside its own overlay; browser page zoom would leave the whole classroom zoomed after closing.
    expect(css).toMatch(/\.study-lightbox \{[^}]*touch-action: none/);
    expect(css).toMatch(/\.study-reader-table \{ background: linear-gradient/);
    expect(css).toMatch(/\.study-aim-hint \{[^}]*min-height: 44px/);
    expect(reader).toContain('ZoomFigure');
  });

  it('dims everything but the spotlit block clearly, without scaling it out of place', () => {
    expect(css).toMatch(/opacity: calc\(1 - var\(--aim-dim, \.5\) \* \.9\)/);
    expect(css).not.toMatch(/data-aim="target"\][^{]*\{ transform: scale/);
  });
});
