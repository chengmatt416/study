import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsOperation } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/dialogue';
import { signalFromKitEvent } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/kit-events';
import { POINTING_RULES, MODULE_KIT_GUIDE, MODULE_KIT_PROMPT } from '../src/shared/module-kit-guide';
import { STUDY_KIT_CSS, STUDY_KIT_JS } from '../src/shared/module-kit';

const root = join(__dirname, '..', 'integrations/openmaic/cloudflare');
const patch = readFileSync(join(root, 'patch-classroom.mjs'), 'utf8');
const dock = readFileSync(join(root, 'overlay/components/study/StudyLessonDock.tsx'), 'utf8');

describe('操作引導與提問討論', () => {
  it('認得要學生動手的句子，不把一般說明當成操作', () => {
    for (const sentence of ['現在請你把錐形瓶拖到滴定管下方。', '換你按住旋塞放液。', '試著調整透鏡的位置。', '接下來請操作天平歸零。'] ) expect(needsOperation(sentence), sentence).toBe(true);
    for (const sentence of ['滴定的終點是指示劑變色。', '體積等於放入後水位減去放入前水位。', '這個反應放出熱量。']) expect(needsOperation(sentence), sentence).toBe(false);
  });

  it('模組的聚光燈與雷射點會停在目標上，學生操作後消失並回報 operate', () => {
    expect(STUDY_KIT_JS).toContain("emit('operate'");
    expect(STUDY_KIT_JS).toMatch(/d\.type==='HIGHLIGHT_ELEMENT'&&d\.target\)operate\(/);
    expect(STUDY_KIT_JS).toMatch(/d\.type==='ANNOTATE_ELEMENT'&&d\.target\)operate\(/);
    for (const part of ['.sk-spot', '.sk-laser', '.sk-ann::before', 'prefers-reduced-motion']) expect(STUDY_KIT_CSS, part).toContain(part);
    expect(signalFromKitEvent({ kind: 'operate' }, 'c1')).toBeNull();
  });

  it('聚光燈的目標在看不到的分頁裡時不畫暗幕，目標占滿畫面時只畫框', () => {
    expect(STUDY_KIT_JS).toContain('getClientRects().length>0');
    expect(STUDY_KIT_JS).toContain("n.style.display=shown?'':'none'");
    expect(STUDY_KIT_JS).toContain('sk-spot-wide');
    // A target inside another tab or step is brought into view before the cue is drawn.
    expect(STUDY_KIT_JS).toContain('function revealTarget(el)');
    expect(STUDY_KIT_JS).toContain('operate(target,text){var el=$(target);if(!el)return;hintClear();revealTarget(el);');
    expect(STUDY_KIT_JS).toContain("define('sk-tabs'");
    expect(STUDY_KIT_JS.match(/e\.__goto=function/g)).toHaveLength(2);
    expect(STUDY_KIT_CSS).toMatch(/\.sk-spot\.sk-spot-wide\{box-shadow:0 0 0 2px/);
  });

  it('播放器：講解列顯示「換你操作」，學生可找虛擬同學討論，討論面板不重複老師的講解', () => {
    expect(dock).toContain('換你操作');
    expect(dock).toContain('找虛擬同學討論');
    expect(dock).toContain('needsOperation(sentence)');
    expect(patch).toContain("setStudyOperate(payload.content)");
    expect(patch).toContain('onStartPeerDiscussion={() =>');
    expect(patch).toContain('handleDiscussionSSE(currentScene.title');
    expect(patch).toContain('studyLectureOnly');
    expect(patch).toMatch(/studyLectureOnly \? null/);
  });

  it('提示詞要求先指再講、操作句一定有指示，並列出器材的子目標 selector', () => {
    expect(MODULE_KIT_PROMPT).toContain(POINTING_RULES);
    expect(MODULE_KIT_GUIDE).toContain(POINTING_RULES);
    for (const part of ['spotlight', 'laser', 'widget_highlight', '[data-id="bur"] [data-hot="cock"]', '換你操作', '提問與討論面板只留給學生發問']) expect(POINTING_RULES, part).toContain(part);
  });
});
