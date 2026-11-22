import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import type { Scene } from '@/lib/types/stage';
import { pendingCompleteSummary, readSceneQuizAnswers, summarizeScenes } from '@/lib/classroom/complete-summary';
import { pendingStudyCompleteSummary, studyCompleteSummaryForScenes, summarizeStudyScenes } from '../overlay/lib/study-classroom/completion';
import { StudyOutcomeNote } from '../overlay/components/study/StudyOutcomeNote';

const scene = (id: string, title: string, type = 'slide') => ({ id, title, stageId: 'stage', type, content: type === 'quiz' ? { type: 'quiz', questions: [{ id: id + '-q', type: 'single', options: [{ value: 'A', label: 'Wrong' }, { value: 'B', label: 'Correct' }], answer: ['B'] }] } : { type: 'slide', canvas: { elements: [] } } }) as Scene;
const course = [scene('ap', '先測：能量', 'quiz'), scene('bp', '先測：波', 'quiz'), scene('a', '能量'), scene('ar', '能量〔補強〕'), scene('ac', '檢核：能量', 'quiz'), scene('b', '波'), scene('bc', '檢核：波', 'quiz'), scene('end', '課後：字卡與模考')];
const reviewed = (id: string, correct: boolean | null = true) => ({ state: { phase: 'reviewed', answers: { [id + '-q']: 'B' }, results: [{ questionId: id + '-q', correct }] } });

test('final adaptive results exclude diagnostic pretests while retaining the entire course inventory', async () => {
  const load = vi.fn(async ({ sceneId }: { sceneId: string }) => {
    if (sceneId === 'ap' || sceneId === 'bp') throw Error('Diagnostic results must not be read or scored here');
    return reviewed(sceneId);
  });
  const summary = await summarizeStudyScenes(course, load);
  expect(summary.quiz).toEqual({ correct: 2, total: 2, pct: 100 });
  expect(load.mock.calls.map(([value]) => value.sceneId)).toEqual(['ac', 'bc']);
  expect(summary.countsByType).toEqual(pendingCompleteSummary(course).countsByType);
  expect(summary.study).toEqual({ checking: false, assessments: 2, reviewed: 2, unattempted: 0, pending: 0, unavailable: 0, ungraded: 0 });
});

test('missing or draft assessments and submitted results do not become failing or perfect scores', async () => {
  const scenes = [...course, scene('transfer', '應用遷移', 'quiz')];
  const summary = await summarizeStudyScenes(scenes, async ({ sceneId }) => sceneId === 'ac' ? {} : { state: { phase: sceneId === 'bc' ? 'draft' : 'submitted', answers: { [sceneId + '-q']: 'B' } } });
  expect(summary.quiz).toBeNull();
  expect(summary.study).toMatchObject({ reviewed: 0, unattempted: 2, pending: 1 });
  const note = renderToStaticMarkup(createElement(StudyOutcomeNote, { outcome: summary.study!, onRetry: () => {} }));
  expect(note).toContain('2 份檢核尚未完成'); expect(note).toContain('1 份作答結果仍待同步'); expect(note).toContain('不代表全部掌握');
  expect(note).toContain('重新讀取檢核結果');
});

test('unavailable results and ungraded answers remain explicit instead of counting as incorrect', async () => {
  const summary = await summarizeStudyScenes(course, async ({ sceneId }) => { if (sceneId === 'bc') throw Error('offline'); return reviewed(sceneId, null); });
  expect(summary.quiz).toBeNull();
  expect(summary.study).toMatchObject({ reviewed: 1, unavailable: 1, ungraded: 1, unattempted: 0 });
  const note = renderToStaticMarkup(createElement(StudyOutcomeNote, { outcome: summary.study! }));
  expect(note).toContain('結果暫時無法讀取'); expect(note).toContain('仍待比對參考答案或覆核');
});

test('only results for current assessment question ids enter the score', async () => {
  const summary = await summarizeStudyScenes(course, async ({ sceneId }) => sceneId === 'ac' ? { state: { phase: 'reviewed', answers: {}, results: [{ questionId: 'obsolete', correct: true }] } } : reviewed(sceneId, false));
  expect(summary.quiz).toEqual({ correct: 0, total: 1, pct: 0 });
  expect(summary.study?.ungraded).toBe(1);
});

test('a replaced scene snapshot never displays results from the previous course revision', () => {
  const old = pendingStudyCompleteSummary(course); old.quiz = { correct: 99, total: 100, pct: 99 };
  const changed = course.map(item => ({ ...item }));
  const summary = studyCompleteSummaryForScenes(changed, { scenes: course, summary: old });
  expect(summary.quiz).toBeNull(); expect(summary.study?.checking).toBe(true);
});

test('ordinary courses retain the official summary behavior, including legacy answer state', async () => {
  const scenes = [scene('q', '一般小測', 'quiz')];
  const load = async () => ({ state: { answers: { 'q-q': 'B' } } });
  expect(await summarizeStudyScenes(scenes, load)).toEqual(await summarizeScenes(scenes, id => readSceneQuizAnswers(scenes.find(scene => scene.id === id), load)));
});

test('malformed legacy scenes are unavailable and are not passed to the runtime loader', async () => {
  const scenes = course.map(item => item.id === 'ac' ? { ...item, stageId: undefined } : item) as Scene[];
  const load = vi.fn(async ({ sceneId }: { sceneId: string }) => reviewed(sceneId));
  const summary = await summarizeStudyScenes(scenes, load);
  expect(summary.study?.unavailable).toBe(1); expect(load.mock.calls.map(([value]) => value.sceneId)).toEqual(['bc']);
});
