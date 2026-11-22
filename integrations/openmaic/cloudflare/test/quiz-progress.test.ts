import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/store/stage', () => ({ useStageStore: { getState: () => ({ scenes: [
  { id: 'pre-energy', title: '先測：能量', type: 'quiz' }, { id: 'pre-wave', title: '先測：波', type: 'quiz' },
  { id: 'energy', title: '能量', type: 'slide' }, { id: 'energy-check', title: '檢核：能量', type: 'quiz' },
  { id: 'wave', title: '波', type: 'slide' }, { id: 'wave-check', title: '檢核：波', type: 'quiz' },
] }) } }));
vi.mock('@/lib/study-classroom/operate', () => ({ clearStudyOperate: vi.fn() }));
vi.mock('../overlay/lib/study-classroom/progress', () => ({ saveStudyModule: vi.fn(), savedModuleState: vi.fn(), sceneOfFrame: vi.fn() }));
const read = () => import('../overlay/lib/study-classroom/adaptive');

describe('quiz completion after hydration and retakes', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true }))); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('restores a reviewed attempt for immediate continuation without duplicating its saved assessment signals', async () => {
    const adaptive = await read();
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(false);
    adaptive.setStudyQuizGraded('pre-energy', true);
    adaptive.setStudyQuizGraded('pre-energy', true);
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(true);
    await adaptive.flushStudySignals(); await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the matching marker for a new attempt and restores it if a retry fails', async () => {
    const adaptive = await read();
    adaptive.setStudyQuizGraded('pre-energy', true);
    adaptive.setStudyQuizGraded('pre-wave', false);
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(true);
    adaptive.setStudyQuizGraded('pre-energy', false);
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(false);
    adaptive.setStudyQuizGraded('pre-energy', true);
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(true);
    adaptive.setStudyQuizGraded('pre-wave', true);
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(false);
    expect(adaptive.isStudyQuizGraded('pre-wave')).toBe(true);
    await adaptive.flushStudySignals(); expect(fetch).not.toHaveBeenCalled();
  });

  it('continues recording fresh quiz submissions exactly once', async () => {
    const adaptive = await read();
    adaptive.recordStudyQuiz('pre-energy', [{ id: 'q1' }], [{ correct: true }], { q1: 'B' });
    expect(adaptive.isStudyQuizGraded('pre-energy')).toBe(true);
    await adaptive.flushStudySignals(); await vi.advanceTimersByTimeAsync(5000);
    // A pretest is now followed by a routing request (each pretest leads into its own chapter); the answers still travel once.
    const sent = vi.mocked(fetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)) as { signals?: unknown[] }).filter(body => body.signals?.length);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ signals: [{ concept: 'energy', kind: 'pretest', correct: true }] });
  });

});
