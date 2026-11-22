import { describe, expect, it, vi } from 'vitest';
import { enterClassroomQuietly, LAUNCH_STEPS, runClassroomLaunch, warmClassroom, type LaunchSession } from '../src/web/features/openmaic/classroom-launch';
import { waitMessage } from '../src/web/features/openmaic/ClassroomLaunchProgress';
import { CLASSROOM_TIPS, tipAt } from '../src/shared/classroom-tips';

const session: LaunchSession = { action: '/api/study-mcp/session', ticket: 't', classroom_id: 'room 1' };
const redirect = () => ({ type: 'opaqueredirect', status: 0, ok: false }) as Response;

describe('opening a classroom', () => {
  it('sets the session, reads the lesson once and reports each real step', async () => {
    const steps: number[] = []; const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => { calls.push(`${init?.method ?? 'GET'} ${url}`); return url.startsWith('/api/stages/') ? ({ body: { cancel: async () => {} } } as unknown as Response) : redirect(); }) as unknown as typeof fetch;
    expect(await enterClassroomQuietly(session, step => steps.push(step), fetchImpl)).toBe(true);
    expect(steps).toEqual([3, 4]);
    expect(calls).toEqual(['POST /api/study-mcp/session', 'GET /api/stages/room%201']);
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1];
    expect(init.redirect).toBe('manual');
    expect(String(init.body)).toBe('ticket=t');
  });

  it('falls back to a normal form post when the session cannot be set quietly', async () => {
    const steps: number[] = [];
    expect(await enterClassroomQuietly(session, step => steps.push(step), (async () => { throw new TypeError('network'); }) as unknown as typeof fetch)).toBe(false);
    expect(steps).toEqual([]);
  });

  it('keeps authentication and server failures on the current lesson page for retry', async () => {
    for (const status of [401, 403, 503]) {
      const fetchImpl = vi.fn(async () => ({ type: 'basic', status, ok: false }) as Response) as unknown as typeof fetch;
      await expect(enterClassroomQuietly(session, () => {}, fetchImpl)).rejects.toThrow(status < 500 ? '登入已失效' : '暫時無法連線');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it('still enters when only the warm-up read fails', async () => {
    const steps: number[] = [];
    const fetchImpl = (async (url: string) => { if (url.startsWith('/api/stages/')) throw new Error('slow'); return redirect(); }) as unknown as typeof fetch;
    expect(await enterClassroomQuietly(session, step => steps.push(step), fetchImpl)).toBe(true);
    expect(steps).toEqual([3, 4]);
  });

  it('warms the classroom without ever failing the page', async () => {
    const post = vi.fn(async () => { throw new Error('offline'); });
    await expect(warmClassroom('note', post)).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledWith('/api/openmaic/warm', { note_slug: 'note' });
  });

  it('does not navigate or submit a form when a cancelled session request finishes late', async () => {
    const abort = new AbortController();
    let resolve!: (value: LaunchSession) => void;
    const pending = new Promise<LaunchSession>(done => { resolve = done; });
    const actions = { prepare: vi.fn(async () => {}), navigate: vi.fn(), form: vi.fn() };
    const opened = runClassroomLaunch(() => pending, () => {}, abort.signal, actions);
    const rejected = expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); resolve(session); await rejected;
    expect(actions.prepare).not.toHaveBeenCalled();
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.form).not.toHaveBeenCalled();
  });

  it('stops after cancellation during resource preparation even when preparation cannot abort', async () => {
    const abort = new AbortController();
    const actions = { prepare: vi.fn(async () => { abort.abort(); }), enter: vi.fn(async () => true), navigate: vi.fn(), form: vi.fn() };
    await expect(runClassroomLaunch(async () => session, () => {}, abort.signal, actions)).rejects.toMatchObject({ name: 'AbortError' });
    expect(actions.enter).not.toHaveBeenCalled(); expect(actions.navigate).not.toHaveBeenCalled(); expect(actions.form).not.toHaveBeenCalled();
  });

  it('does not navigate when the route changed before the outgoing view finishes unmounting', async () => {
    const abort = new AbortController();
    let current = true;
    const actions = { prepare: async () => { current = false; }, isCurrent: () => current, enter: vi.fn(async () => true), navigate: vi.fn(), form: vi.fn() };
    await expect(runClassroomLaunch(async () => session, () => {}, abort.signal, actions)).rejects.toMatchObject({ name: 'AbortError' });
    expect(actions.enter).not.toHaveBeenCalled(); expect(actions.navigate).not.toHaveBeenCalled(); expect(actions.form).not.toHaveBeenCalled();
  });

  it('does not navigate or fall back after cancellation while the classroom is warming', async () => {
    const abort = new AbortController(), steps: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('/api/stages/')) { abort.abort(); return new Response('{}'); }
      return redirect();
    }) as unknown as typeof fetch;
    const actions = { prepare: async () => {}, enter: (value: LaunchSession, update: (step: number) => void, _fetch: typeof fetch, signal?: AbortSignal) => enterClassroomQuietly(value, update, fetchImpl, signal), navigate: vi.fn(), form: vi.fn() };
    await expect(runClassroomLaunch(async () => session, step => steps.push(step), abort.signal, actions)).rejects.toMatchObject({ name: 'AbortError' });
    expect(steps).toEqual([1, 2, 3]);
    expect(actions.navigate).not.toHaveBeenCalled(); expect(actions.form).not.toHaveBeenCalled();
  });
});

describe('what the learner is told while waiting', () => {
  it('lists the real steps in order', () => {
    expect([...LAUNCH_STEPS]).toEqual(['確認課堂', '準備學習環境', '連線到課堂', '載入教材', '開始學習']);
  });

  it('is honest about the first open being slow, and calm when it takes longer', () => {
    expect(waitMessage(1)).toContain('正在準備');
    expect(waitMessage(10)).toMatch(/第一次開啟/);
    expect(waitMessage(40)).toMatch(/取消/);
    expect(waitMessage(10)).not.toMatch(/%|[0-9].*秒/);
  });

  it('rotates tips and wraps around', () => {
    expect(CLASSROOM_TIPS.length).toBeGreaterThanOrEqual(5);
    expect(tipAt(0)).toBe(CLASSROOM_TIPS[0]);
    expect(tipAt(CLASSROOM_TIPS.length)).toBe(CLASSROOM_TIPS[0]);
    expect(tipAt(-1)).toBe(CLASSROOM_TIPS.at(-1));
    expect(CLASSROOM_TIPS.some(tip => tip.includes('我不會'))).toBe(true);
  });
});
