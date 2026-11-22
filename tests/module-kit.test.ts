import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { STUDY_MOTION } from '../src/shared/motion';
import { STUDY_LAB_CSS, STUDY_LAB_JS } from '../src/shared/module-lab';
import { MODULE_KIT_VERSION, STUDY_KIT_CSS, STUDY_KIT_JS, hasStudyKit, studyKitHead } from '../src/shared/module-kit';
import { CHAPTER_FLOW, COURSE_CLOSING, FEEDBACK_RULES, INTERACTION_RULES, LAB_CATALOG, MODULE_KIT_EXAMPLE, MODULE_KIT_GUIDE, MODULE_KIT_PROMPT, PRETEST_RULES, ROUTING_CONVENTION, TEACH_FIRST_RULE } from '../src/shared/module-kit-guide';
import { buildServer } from '../src/worker/mcp/server';
import { buildCourseMap, difficultyOf, misconceptionOf, parseTitle } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/course-map';
import { signalFromKitEvent } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/kit-events';

const defined = [...STUDY_KIT_JS.matchAll(/define\('(sk-[a-z]+)'/g)].map(match => match[1]);
const passive = ['sk-split', 'sk-stack', 'sk-controls', 'sk-option', 'sk-hint', 'sk-explain', 'sk-wrong', 'sk-item', 'sk-pair', 'sk-step', 'sk-tab', 'sk-col', 'sk-lab', 'sk-item', 'sk-bucket', 'sk-card', 'sk-term', 'sk-blank', 'sk-text', 'sk-tr', 'sk-point', 'sk-flash', 'sk-hit', 'sk-miss'];

describe('module kit', () => {
  it('ships valid script and style that are safe to inline in a page', () => {
    expect(() => new Script(STUDY_KIT_JS)).not.toThrow();
    for (const source of [STUDY_KIT_JS, STUDY_KIT_CSS]) expect(source).not.toMatch(/`|\$\{/);
    const head = studyKitHead();
    expect(head.match(/<\/script/gi)).toHaveLength(1);
    expect(head).toContain(MODULE_KIT_VERSION);
    expect(STUDY_KIT_JS).not.toMatch(/\beval\(|new Function|fetch\(|XMLHttpRequest|localStorage|importScripts/);
  });

  it('injects only into pages that use the kit', () => {
    expect(hasStudyKit('<body><sk-module></sk-module></body>')).toBe(true);
    expect(hasStudyKit('<script>StudyKit.set("a",1)</script>')).toBe(true);
    expect(hasStudyKit('<body><div class="task">plain</div></body>')).toBe(false);
  });

  it('documents every component the kit defines, and only those', () => {
    expect(defined.length).toBeGreaterThanOrEqual(15);
    for (const tag of [...defined, ...passive]) expect(MODULE_KIT_GUIDE, tag).toContain(tag);
    const known = new Set([...defined, ...passive, 'sk-observe']);
    for (const text of [MODULE_KIT_GUIDE, MODULE_KIT_PROMPT, MODULE_KIT_EXAMPLE]) for (const [, tag] of text.matchAll(/<(sk-[a-z]+)/g)) expect(known.has(tag), tag).toBe(true);
  });

  it('keeps the in-prompt guide small, and carries the design, motion and feedback rules', () => {
    expect(MODULE_KIT_PROMPT.length).toBeLessThan(7200);
    expect(MODULE_KIT_PROMPT).toContain(FEEDBACK_RULES);
    expect(MODULE_KIT_GUIDE).toMatch(/160ms[\s\S]*260ms[\s\S]*460ms[\s\S]*380ms/);
    expect(MODULE_KIT_GUIDE).toContain('#fafafa');
    expect(MODULE_KIT_GUIDE).toContain('減少動態');
    expect(MODULE_KIT_GUIDE).toContain('widget-config');
    expect(MODULE_KIT_GUIDE).toContain(ROUTING_CONVENTION);
    expect(MODULE_KIT_EXAMPLE.length).toBeLessThan(3000);
    expect(MODULE_KIT_GUIDE).toContain(`study-kit/v1`);
    expect(MODULE_KIT_VERSION).toBe('study-kit/v1');
  });

  it('pretests ask for foundation, core and hard questions tagged by id; everything is explained before it is practised', () => {
    for (const word of ['__d1', '__d2', '__d3', '5 到 6 題', '難題', '我不會', '〔精簡〕']) expect(PRETEST_RULES, word).toContain(word);
    for (const word of ['先講解', '例題', '不可讓學生第一次在題目裡遇到新公式', '重點回顧', '先測', '互動模組']) expect(TEACH_FIRST_RULE, word).toContain(word);
    expect(MODULE_KIT_GUIDE).toContain(PRETEST_RULES);
    expect(MODULE_KIT_GUIDE).toContain(TEACH_FIRST_RULE);
    expect(ROUTING_CONVENTION).toContain('__d3');
    expect(CHAPTER_FLOW).toContain('5 到 6 題');
    expect(CHAPTER_FLOW).toContain('重點回顧');
    expect(difficultyOf('q4__d3__m_forgot-sign')).toBe(3);
    expect(difficultyOf('q1__d1')).toBe(1);
    expect(difficultyOf('q2__m_sign')).toBeNull();
    expect(difficultyOf('q3__d9')).toBeNull();
    expect(misconceptionOf('q4__d3__m_forgot-sign')).toBe('forgot-sign');
  });

  it('tells the chatbot the chapter flow: explain, operate, review, reinforce, retest, then flashcards and a mock exam', () => {
    for (const text of [MODULE_KIT_GUIDE, MODULE_KIT_PROMPT]) for (const part of [CHAPTER_FLOW, INTERACTION_RULES, COURSE_CLOSING]) expect(text).toContain(part);
    for (const word of ['講解', '操作', '覆核', '補強', '復測', '先測全部答對', '考試陷阱提醒', '難題練習與解析', '課後：字卡與模考']) expect(CHAPTER_FLOW + COURSE_CLOSING, word).toContain(word);
    expect(COURSE_CLOSING).toContain('/decks');
    expect(COURSE_CLOSING).toContain('/exams');
    expect(ROUTING_CONVENTION).toContain('課後：字卡與模考');
    const closing = parseTitle('課後：字卡與模考');
    expect(buildCourseMap([['a', '章名', 'slide'], ['b', '先測：章名', 'quiz'], ['c', closing.key, 'interactive']].map(([id, title, type]) => ({ id, title, type })))).toMatchObject({ active: true, roles: { b: { role: 'pretest' } } });
  });

  it('asks for operable apparatus in science, problems in math, and no pile of sliders', () => {
    expect(INTERACTION_RULES).toContain('滑桿不是預設控制項');
    expect(INTERACTION_RULES).not.toMatch(/最多 \d+ 個 sk-slider|禁止滑桿/);
    expect(INTERACTION_RULES).toMatch(/科學[\s\S]*操作內建的虛擬器材[\s\S]*不要自己畫器材 SVG[\s\S]*sk-record[\s\S]*sk-numeric/);
    expect(INTERACTION_RULES).toMatch(/數學＝做題，不做實驗/);
    expect(MODULE_KIT_EXAMPLE).not.toContain('<sk-slider');
    expect(MODULE_KIT_EXAMPLE).toContain('<sk-record');
    expect(MODULE_KIT_EXAMPLE).toContain('<sk-lab');
    expect(MODULE_KIT_EXAMPLE).not.toMatch(/<svg|<script>/);
    expect(STUDY_KIT_JS).toContain("define('sk-record'");
    expect(MODULE_KIT_GUIDE).toContain('StudyKit.records');
  });

  it('ships every virtual apparatus the guide documents, and the lab only loads on pages that use it', () => {
    const kinds = [...new Set([...STUDY_LAB_JS.matchAll(/KINDS\.([a-z]+)=function/g)].map(m => m[1]).concat(['beaker', 'flask', 'cylinder', 'testtube']))].filter(kind => kind !== 'probe');
    expect(kinds.length).toBeGreaterThanOrEqual(19);
    for (const kind of kinds) { expect(LAB_CATALOG, kind).toContain(kind); expect(MODULE_KIT_PROMPT, kind).toContain(kind); }
    expect(() => new Script(STUDY_LAB_JS)).not.toThrow();
    for (const source of [STUDY_LAB_JS, STUDY_LAB_CSS]) expect(source).not.toMatch(/`|\$\{/);
    expect(STUDY_LAB_JS).not.toMatch(/\beval\(|new Function|fetch\(|XMLHttpRequest|localStorage|importScripts/);
    expect(studyKitHead('<sk-module></sk-module>')).not.toContain('study-lab');
    const labHead = studyKitHead('<sk-lab><sk-item kind="beaker"></sk-item></sk-lab>');
    expect(labHead).toContain(STUDY_LAB_CSS.slice(0, 40));
    expect(labHead.match(/<\/script/gi)).toHaveLength(2);
    expect(labHead.indexOf('window.StudyKit={')).toBeLessThan(labHead.indexOf("K.define('sk-lab'"));
  });

  it('has more question types than choice and number: sort, label, pick, fill, balance, match, order, knob and tune', () => {
    for (const tag of ['sk-sort', 'sk-label', 'sk-pick', 'sk-fill', 'sk-balance', 'sk-knob', 'sk-tune', 'sk-match', 'sk-order']) {
      expect(STUDY_KIT_JS, tag).toContain("define('" + tag + "'");
      expect(MODULE_KIT_GUIDE, tag).toContain(tag);
      expect(MODULE_KIT_PROMPT, tag).toContain(tag);
    }
    expect(INTERACTION_RULES).toMatch(/至少用 3 種不同題型/);
    expect(STUDY_KIT_JS).toContain('unbalanced-equation');
    expect(STUDY_KIT_JS).toContain('not-lowest-terms');
    expect(STUDY_KIT_JS).toContain("var QS='sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune,sk-graph,sk-table,sk-mark,sk-reflect'");
    for (const rule of ['.sk-chip', '.sk-ghost', '.sk-pin', '.sk-dial']) expect(STUDY_KIT_CSS, rule).toContain(rule);
    expect(STUDY_KIT_JS).not.toMatch(/\beval\(|new Function|fetch\(|localStorage/);
  });

  it('adds graph, table, mark, reflect and flashcards, worked examples done together, and a way out for a stuck learner', () => {
    for (const tag of ['sk-graph', 'sk-table', 'sk-mark', 'sk-reflect', 'sk-flashcards']) { expect(defined).toContain(tag); expect(MODULE_KIT_PROMPT).toContain(tag); }
    // New question types count toward progress and the page summary like the others.
    expect(STUDY_KIT_JS).toMatch(/var QS='[^']*sk-graph,sk-table,sk-mark,sk-reflect'/);
    expect(STUDY_KIT_JS).toContain("e.hasAttribute('gated')");
    expect(MODULE_KIT_PROMPT).toContain('gated');
    // Two misses offer the answer; it is reported as a hint, and the guide asks for an explanation worth reading.
    expect(STUDY_KIT_JS).toContain("card.__miss>=2&&card.__solve");
    expect(STUDY_KIT_JS).toContain("emit('hint',{id:slug(card.id||card.__key||'q'),level:3})");
    expect(FEEDBACK_RULES).toContain('看解答');
    // A wrong-answer box grows with its text: the count badge style of the same name must not size it.
    expect(STUDY_KIT_CSS).toMatch(/\.sk-fb\.sk-no\{height:auto/);
    // The mark on an answer is drawn like a pen stroke, and is simply there when motion is reduced.
    expect(STUDY_KIT_JS).toContain("(ok?PEN_OK:PEN_NO)");
    expect(STUDY_KIT_CSS).toMatch(/\.sk-pen path\{[^}]*stroke-dashoffset:1;opacity:0;animation:sk-pen/);
    // (The kit's reduced-motion rule ends every animation in 1ms, and this one ends on the finished mark.)
    expect(STUDY_KIT_CSS).toMatch(/@keyframes sk-pen\{from\{opacity:1;stroke-dashoffset:1\}to\{opacity:1;stroke-dashoffset:0\}\}/);
    // Hovering a filled button must not swap its dark background for the plain hover fill, which left white text on white.
    expect(STUDY_KIT_CSS).toContain('.sk-btn:hover:not(:disabled):not(.sk-primary):not([aria-checked=true]){background:var(--sk-card-solid)}');
    // The mark component must not reuse the teacher spotlight's class.
    expect(STUDY_KIT_JS).not.toMatch(/classList\.add\('sk-spot'\)/);
  });

  it('uses the same colors and motion timings the app and kit CSS share', () => {
    for (const token of ['#fafafa', '#0f172a', '#0a0a0a', '#3f3f46', '--sk-soft:0 1px 3px 0 rgb(0 0 0/.03)', '--sk-glow:0 8px 24px -6px rgb(0 0 0/.22)', 'scale(.97)', 'rgb(255 255 255/.15)']) expect(STUDY_KIT_CSS).toContain(token);
    for (const ms of ['160ms', '260ms', '460ms']) expect(STUDY_KIT_CSS).toContain(ms);
    expect(STUDY_KIT_CSS).toContain('prefers-reduced-motion');
    expect(STUDY_KIT_CSS).toContain('cubic-bezier(.22,1,.36,1)');
  });

  it('uses the main app motion timings and easing from one source', () => {
    const ms = (value: number) => Math.round(value * 1000) + 'ms';
    expect(STUDY_KIT_CSS).toContain('--sk-control:' + ms(STUDY_MOTION.feedback));
    expect(STUDY_KIT_CSS).toContain('--sk-command:' + ms(STUDY_MOTION.instruction));
    expect(STUDY_KIT_CSS).toContain('--sk-reveal:' + ms(STUDY_MOTION.reveal));
    expect(STUDY_KIT_CSS).toContain('--sk-ease:cubic-bezier(' + STUDY_MOTION.ease.join(',').replace(/0\./g, '.') + ')');
  });

  it('gives every question the same polished feel: result marks, a shake on a miss, gliding moves, and nothing that outlasts reduced motion', () => {
    for (const piece of ['data-state', 'function shake', 'function flip', 'function nudge', 'function solved', "toast('✓"]) expect(STUDY_KIT_JS, piece).toContain(piece);
    for (const piece of ['@keyframes sk-shake', '@keyframes sk-pop', '.sk-armed', '.sk-over', '.sk-opt.sk-right:has(input)', '.sk-solved']) expect(STUDY_KIT_CSS, piece).toContain(piece);
    expect(STUDY_KIT_JS).not.toContain("fb.className='sk-fb';fb.hidden=false;fb.textContent=");
    expect(STUDY_KIT_JS).toMatch(/function flip\(root,fn\)\{\s*if\(reduce/);
    expect(STUDY_KIT_CSS.slice(STUDY_KIT_CSS.lastIndexOf('prefers-reduced-motion:reduce'))).toContain('.sk-shake');
    for (const tag of ['sk-sort', 'sk-fill', 'sk-balance']) expect(STUDY_KIT_CSS).toMatch(new RegExp(tag + '[^{]*\\{padding:18px'));
  });

  it('lays out on a phone: one column, pinned visual, one screen per page, large targets', () => {
    expect(STUDY_KIT_CSS).toContain('@media (max-width:700px)');
    expect(STUDY_KIT_CSS).toMatch(/sk-split sk-figure,sk-split sk-plot\{order:-1;position:sticky/);
    expect(STUDY_KIT_CSS).toContain('sk-split>sk-stack{display:contents}');
    expect(STUDY_KIT_CSS).toMatch(/sk-tabs>\.sk-tabbar\{margin-bottom:8px;position:sticky/);
    expect(STUDY_KIT_CSS).toContain('.sk-btn:active:not(:disabled){transform:scale(.97)}');
    expect(STUDY_KIT_JS).toContain("define('sk-tabs'");
    expect(MODULE_KIT_GUIDE).toContain('手機一屏原則');
    expect(MODULE_KIT_PROMPT).toContain('手機一屏原則');
  });

  it('keeps the routing naming convention in step with what the player parses', () => {
    expect(parseTitle('先測：章名')).toEqual({ role: 'pretest', key: '章名' });
    expect(parseTitle('檢核：章名')).toEqual({ role: 'checkpoint', key: '章名' });
    expect(parseTitle('章名〔補強〕')).toMatchObject({ variant: 'remedial' });
    expect(parseTitle('章名〔精簡〕')).toMatchObject({ variant: 'quick' });
    expect(parseTitle('章名〔延伸〕')).toMatchObject({ variant: 'enrich' });
    for (const title of ['先測：章名', '檢核：章名', '章名〔補強〕', '章名〔精簡〕', '章名〔延伸〕']) expect(ROUTING_CONVENTION).toContain(title);
    const scenes = [['a', '章名', 'slide'], ['b', '先測：章名', 'quiz'], ['c', '章名〔補強〕', 'interactive'], ['d', '檢核：章名', 'quiz']].map(([id, title, type]) => ({ id, title, type }));
    expect(buildCourseMap(scenes)).toMatchObject({ active: true, chapters: [{ id: 'a', checkpoint: 'd', variants: { remedial: 'c' } }] });
  });

  it('maps kit feedback events to routing signals and rejects anything else', () => {
    expect(signalFromKitEvent({ kind: 'answer', correct: false, misconception: 'angle-90-max' }, 'c1')).toEqual({ concept: 'c1', kind: 'question', correct: false, misconception: 'angle-90-max' });
    expect(signalFromKitEvent({ kind: 'answer', correct: true, misconception: 'ignored' }, 'c1')).toMatchObject({ correct: true, misconception: null });
    expect(signalFromKitEvent({ kind: 'observe', observed: 'misconception', tag: 'tries-vertical' }, 'c1')).toMatchObject({ kind: 'question', correct: false, misconception: 'tries-vertical' });
    expect(signalFromKitEvent({ kind: 'observe', observed: 'evidence', tag: 'found-optimal-angle' }, 'c1')).toMatchObject({ correct: true, misconception: null });
    expect(signalFromKitEvent({ kind: 'hint', id: 'h1', level: 2 }, 'c1')).toEqual({ concept: 'c1', kind: 'hint' });
    expect(signalFromKitEvent({ kind: 'retry' }, 'c1')).toEqual({ concept: 'c1', kind: 'retry' });
    expect(signalFromKitEvent({ kind: 'step', ms: 1500 }, 'c1')).toEqual({ concept: 'c1', kind: 'step', value: 1500 });
    expect(signalFromKitEvent({ kind: 'summary', ms: -1 }, 'c1')).toMatchObject({ kind: 'module', value: null });
    expect(signalFromKitEvent({ kind: 'summary', ms: 42000, controls: 7 }, 'c1')).toEqual({ concept: 'c1', kind: 'module', value: 42000, ops: 7 });
    for (const bad of [null, 'x', {}, { kind: 'answer' }, { kind: 'observe', observed: 'evidence' }, { kind: 'observe', observed: 'other', tag: 'a' }, { kind: 'exec' }, { kind: 'answer', correct: false, misconception: 'bad id!' }]) {
      const signal = signalFromKitEvent(bad, 'c1');
      expect(signal === null || signal.misconception == null, JSON.stringify(bad)).toBe(true);
    }
  });

  it('is served to chatbots through MCP', async () => {
    const user = { id: 'u', email: 'u@test.example', name: 'U', avatar_url: null, role: 'member' as const };
    const server = buildServer({ env: {} as Env, ctx: { waitUntil: () => {} } as ExecutionContext, user, scopes: ['study:read'], origin: 'https://study.test' });
    const client = new Client({ name: 'kit-test', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const tool = (await client.listTools()).tools.find(item => item.name === 'get_module_kit');
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const text = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { type: string; text: string }[]).find(item => item.type === 'text')!.text;
      expect(text(await client.callTool({ name: 'get_module_kit', arguments: {} }))).toBe(MODULE_KIT_GUIDE);
      expect(text(await client.callTool({ name: 'get_module_kit', arguments: { section: 'feedback' } }))).toBe(FEEDBACK_RULES);
      expect(text(await client.callTool({ name: 'get_module_kit', arguments: { section: 'routing' } }))).toBe(ROUTING_CONVENTION);
      expect((await client.getInstructions()) ?? '').toContain('get_module_kit');
    } finally { await client.close(); await server.close(); }
  });
});
