import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from '../../../../.openmaic/worker-core/node_modules/fake-indexeddb';
import { BrowserRuntimeStore } from '../../../../.openmaic/worker-core/node_modules/@openmaic/storage';
import { createQuizAttemptWriter, loadQuizAttemptState, recordQuizAttempt, type QuizAttemptRecordInput } from '@/lib/quiz/runtime';
import { retryStudyQuiz } from '../overlay/lib/study-classroom/quiz-retry';

beforeEach(() => { vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(() => { vi.unstubAllGlobals(); });
const base = { stageId: 'retry-course', sceneId: 'checkpoint' };
const answers = { q1: 'B' };
const results = [{ questionId: 'q1', correct: true, status: 'correct' as const, earned: 1 }];
function harness() {
  const store = new BrowserRuntimeStore({ indexedDB: new IDBFactory(), dbName: 'same-answer-' + crypto.randomUUID() });
  let tick = 0;
  const deps = { store, learnerKey: 'isolated-learner', now: () => new Date(1_800_000_000_000 + tick++).toISOString(), mintRecordId: () => crypto.randomUUID() };
  const load = (input: typeof base) => loadQuizAttemptState(input, deps);
  const write = (input: QuizAttemptRecordInput) => recordQuizAttempt(input, deps);
  const writer = createQuizAttemptWriter({ write });
  return { store, load, write, writer };
}

it('persists identical answers through three retakes after completed-view reloads', async () => {
  const { store, load, write, writer } = harness();
  const first = await load(base);
  await write({ ...base, attemptId: first.attemptId, phase: 'reviewed', answers, results });
  for (let retry = 1; retry <= 3; retry++) {
    const completedView = await load(base);
    const fresh = await retryStudyQuiz({ ...base, attemptId: completedView.attemptId }, writer, load);
    expect(fresh.state).toMatchObject({ status: 'active', phase: 'draft', answers: {} });
    expect(fresh.attemptId).toBe(fresh.state!.sessionId);
    const input = { ...base, attemptId: fresh.attemptId, answers };
    writer.scheduleDraft(input);
    await writer.recordPhase({ ...input, phase: 'submitted' });
    await writer.recordPhase({ ...input, phase: 'reviewed', results });
    expect((await load(base)).state).toMatchObject({ sessionId: fresh.attemptId, phase: 'reviewed', answers, results });
    expect((await store.listRecords(fresh.attemptId)).map(record => record.payload.phase)).toEqual(['draft', 'draft', 'submitted', 'reviewed']);
  }
  expect((await store.listSessions(base.stageId, 'isolated-learner')).every(session => session.status === 'completed')).toBe(true);
  expect(await store.listSessions(base.stageId, 'isolated-learner')).toHaveLength(4);
});

it('keeps an active child cursor after reload and preserves delayed-write protection on completed attempts', async () => {
  const { store, load, write, writer } = harness();
  const first = await load(base);
  await write({ ...base, attemptId: first.attemptId, phase: 'reviewed', answers, results });
  const fresh = await retryStudyQuiz({ ...base, attemptId: first.attemptId }, writer, load);
  await write({ ...base, attemptId: fresh.attemptId, phase: 'draft', answers });
  const reloaded = await load(base);
  expect(reloaded.attemptId).toBe(fresh.attemptId);
  await write({ ...base, attemptId: reloaded.attemptId, phase: 'submitted', answers });
  await write({ ...base, attemptId: reloaded.attemptId, phase: 'reviewed', answers, results });
  await write({ ...base, attemptId: first.attemptId, phase: 'draft', answers });
  expect((await load(base)).state).toMatchObject({ sessionId: fresh.attemptId, phase: 'reviewed', answers });
  expect(await store.listSessions(base.stageId, 'isolated-learner')).toHaveLength(2);
});

it('waits for the authoritative post-retry read before returning a new cursor', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const write = vi.fn().mockResolvedValue(undefined);
  const result = { attemptId: 'active-child', state: undefined };
  const load = vi.fn(async () => { await wait; return result; });
  let resolved = false;
  const reading = retryStudyQuiz({ ...base, attemptId: 'completed-root' }, { recordPhase: write }, load).then(value => { resolved = true; return value; });
  await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
  expect(resolved).toBe(false);
  release();
  await expect(reading).resolves.toBe(result);
});
