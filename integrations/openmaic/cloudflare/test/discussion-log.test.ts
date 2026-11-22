import { expect, test, vi } from 'vitest';
// The store lives in the Core checkout, so it must render with the Core's React, not the root project's.
import { createElement } from '@/node_modules/react';
import { renderToStaticMarkup } from '@/node_modules/react-dom/server.node.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { discussionLog, logMessageCount, type ChatLike } from '@/lib/study-classroom/discussion';

const stage = vi.hoisted(() => ({ chats: [] as unknown[], currentSceneId: 's1' as string | null }));
// Server rendering reads a zustand store's initial state, so the render tests use a plain stand-in for it.
vi.mock('@/lib/store/stage', () => ({ useStageStore: (selector: (state: typeof stage) => unknown) => selector(stage) }));
vi.mock('@/lib/study-classroom/phone', () => ({ useStudyPhone: () => true, useStudyKeyboardInset: () => undefined, STUDY_PHONE_QUERY: '' }));
const { StudyDiscussionLog } = await import('@/components/study/StudyDiscussionLog');

const text = (id: string, role: string, value: string, metadata: Record<string, unknown> = {}) => ({ id, role, parts: [{ type: 'text', text: value }], metadata });
const chats: ChatLike[] = [
  { id: 'lec', type: 'lecture', title: '講解', status: 'active', sceneId: 's1', createdAt: 1, messages: [text('l1', 'assistant', '這是老師的講解，不屬於討論')] },
  { id: 'qa1', type: 'qa', title: '提問', status: 'completed', sceneId: 's1', createdAt: 2, messages: [text('q1', 'user', '為什麼 F = ma？', { originalRole: 'user' }), text('q2', 'assistant', '因為合力讓物體產生加速度。', { originalRole: 'teacher', senderName: '王老師' })] },
  { id: 'd1', type: 'discussion', title: '動量守恆', status: 'active', sceneId: 's1', createdAt: 3, messages: [
    text('d1', 'assistant', '我覺得碰撞前後總動量相等。', { originalRole: 'agent', senderName: '小安', agentColor: '#2563eb' }),
    text('d2', 'assistant', '但是能量不一定守恆喔。', { originalRole: 'agent', senderName: '小宇', agentColor: 'javascript:alert(1)' }),
    { id: 'empty', role: 'assistant', parts: [{ type: 'tool-call' }], metadata: {} },
  ] },
  { id: 'other', type: 'qa', title: '別頁', status: 'completed', sceneId: 's2', createdAt: 4, messages: [text('o1', 'user', '另一頁的問題')] },
];

test('the transcript holds this scene’s questions and discussions in order, and nothing else', () => {
  const log = discussionLog(chats, 's1');
  expect(log.map(session => session.id)).toEqual(['qa1', 'd1']);
  expect(logMessageCount(log)).toBe(4);
  expect(log[0].messages.map(message => [message.role, message.name])).toEqual([['user', '你'], ['teacher', '王老師']]);
  expect(log[1].messages[0]).toMatchObject({ role: 'agent', name: '小安', color: '#2563eb' });
  expect(log[1].messages[1].color).toBeNull();
  expect(discussionLog(chats, 's2').map(session => session.id)).toEqual(['other']);
});

const render = (live: boolean, streaming = false) => renderToStaticMarkup(createElement(StudyDiscussionLog, { live, streaming }));
test('renders the whole conversation as a scrollable log with names, dividers and the newest last', () => {
  Object.assign(stage, { chats, currentSceneId: 's1' });
  const html = render(true, true);
  expect(html).toContain('role="log"');
  for (const part of ['為什麼', '王老師', '小安', '我覺得碰撞前後總動量相等', '但是能量不一定守恆喔', '提問', '討論：動量守恆 · 進行中']) expect(html).toContain(part);
  expect(html).not.toContain('不屬於討論');
  expect(html).not.toContain('另一頁的問題');
  expect(html).not.toContain('javascript:alert');
  expect(html.indexOf('為什麼')).toBeLessThan(html.indexOf('小宇'));
  expect(html).toContain('data-role="user"');
});

test('says what to do when nothing has been said yet', () => {
  Object.assign(stage, { chats: [], currentSceneId: 's1' });
  expect(render(false)).toContain('在下面輸入問題');
  expect(render(true)).toContain('大家馬上就會發言');
});

test('writes a phone preview of the sheet for a visual check', () => {
  if (!process.env.READER_PREVIEW_DIR) return;
  Object.assign(stage, { chats, currentSceneId: 's1' });
  const css = readFileSync(new URL('../overlay/components/study/classroom.css', import.meta.url), 'utf8');
  const sheet = `<div class="study-classroom"><div class="study-discussion"><div class="study-discussion-bar"><span class="study-discussion-grabber"></span><span class="study-discussion-title">提問與討論</span><span class="study-discussion-live" data-streaming="true"><i></i>發言中</span><button type="button">先看課程</button></div>${render(true, true)}<div data-testid="roundtable-region"><div></div><div class="flex-1 flex"><div class="flex-1"><div class="rounded-[2.5rem]" style="position:relative;min-height:40px"><div data-testid="roundtable-non-presentation-input-stage" style="position:absolute;left:8px;right:8px;bottom:8px"><div style="display:flex;gap:8px;padding:6px 6px 6px 14px;border:1px solid #e4e4e7;border-radius:18px;background:#fff"><textarea rows="1" style="flex:1;border:0;outline:0;resize:none;font:16px system-ui" placeholder="輸入你的問題或想法"></textarea><button style="min-width:44px;min-height:44px;border:0;border-radius:14px;background:#0a0a0a;color:#fff">送出</button></div></div></div></div></div></div></div></div></div>`;
  const pill = `<section class="study-lesson-dock study-classroom" style="position:fixed;left:0;right:0;bottom:0"><button type="button" class="study-discussion-pill" data-unread="true"><span class="study-discussion-pill-dot" data-live="true"></span><span class="study-discussion-pill-text"><b>回到討論</b><span>大家正在發言</span></span><i class="study-unread">2</i></button><div class="study-lesson-context"><a class="study-wordmark">STUDY</a></div><div class="study-dialogue-row"><div class="study-dialogue-content"><div class="study-dialogue-text">合力等於質量乘以加速度，所以質量越大越難加速。</div></div><button class="study-dialogue-continue" data-state="discussion"><span>回到討論</span></button></div></section>`;
  const head = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#fafafa}button{border:0;font:inherit;color:inherit}${css}</style></head><body>`;
  writeFileSync(process.env.READER_PREVIEW_DIR + '/discussion-sheet.html', head + sheet + '</body></html>');
  writeFileSync(process.env.READER_PREVIEW_DIR + '/discussion-pill.html', head + '<main style="padding:24px 16px"><h1 style="font-family:serif">牛頓第二定律</h1><p>老師正在講解這一頁。</p></main>' + pill + '</body></html>');
});
