import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/store/stage', () => ({ useStageStore: Object.assign(() => undefined, { getState: () => ({ scenes: [], currentSceneId: null }) }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

describe('browser progress persistence across interruptions', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(1000);
    storage = new Map();
    vi.stubGlobal('location', { pathname: '/classroom/progress' });
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  const read = () => import('../overlay/lib/study-classroom/progress');
  const server = (owner = 'learner') => ({ owner_id: owner, classroom_id: 'progress', scene_id: 'scene-1', scene_index: 0, modules: {}, updated_at: 100 });
  const cache = (owner = 'learner') => JSON.parse(storage.get('study-progress-v2:' + owner + ':/classroom/progress') ?? '{}');

  it('automatically retries non-OK saves and acknowledges only after success', async () => {
    let fail = true;
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json(server());
      writes.push(JSON.parse(String(init.body)));
      return Response.json({ ok: !fail }, { status: fail ? 503 : 200 });
    }));
    const progress = await read(); await progress.loadStudyProgress();
    progress.saveStudyModule('lab', { mass: 4 });
    await progress.flushStudyProgress();
    expect(cache().pending.modules.lab.state).toEqual({ mass: 4 });
    fail = false; await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([{ owner_id: 'learner', classroom_id: 'progress', module: { scene_id: 'lab', state: { mass: 4 } } }, { owner_id: 'learner', classroom_id: 'progress', module: { scene_id: 'lab', state: { mass: 4 } } }]);
    expect(cache().pending.modules).toEqual({});
  });

  it('restores an unsent module after reload without losing it to an older server snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? Response.json({}, { status: 500 }) : Response.json(server())));
    const first = await read(); await first.loadStudyProgress();
    first.saveStudyScene('scene-2', 1); first.saveStudyModule('lab', { mass: 9 }); first.saveStudyModule('ink:scene-2', null);
    await first.flushStudyProgress();
    vi.clearAllTimers(); vi.resetModules(); vi.stubGlobal('window', new EventTarget());
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json(server());
      writes.push(JSON.parse(String(init.body))); return Response.json({ ok: true });
    }));
    const resumed = await read();
    expect(await resumed.loadStudyProgress()).toMatchObject({ scene_id: 'scene-2', modules: { lab: { state: { mass: 9 } } } });
    expect(await resumed.savedModuleState('lab')).toEqual({ mass: 9 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writes).toEqual([{ scene_id: 'scene-2', scene_index: 1, owner_id: 'learner', classroom_id: 'progress' }, { module: { scene_id: 'lab', state: { mass: 9 } }, owner_id: 'learner', classroom_id: 'progress' }, { module: { scene_id: 'ink:scene-2', state: null }, owner_id: 'learner', classroom_id: 'progress' }]);
    expect(cache().pending).toEqual({ scene: null, modules: {} });
  });

  it('serializes overlapping flushes so a delayed earlier write cannot overwrite a later edit', async () => {
    let release!: (response: Response) => void;
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json(server());
      writes.push(JSON.parse(String(init.body)));
      return writes.length === 1 ? new Promise<Response>(resolve => { release = resolve; }) : Response.json({ ok: true });
    }));
    const progress = await read(); await progress.loadStudyProgress();
    progress.saveStudyModule('lab', { mass: 4 });
    const first = progress.flushStudyProgress(); await Promise.resolve();
    progress.saveStudyModule('lab', { mass: 9 });
    const second = progress.flushStudyProgress(); expect(second).toBe(first);
    release(Response.json({ ok: true })); await first;
    expect(writes).toEqual([{ module: { scene_id: 'lab', state: { mass: 4 } }, owner_id: 'learner', classroom_id: 'progress' }, { module: { scene_id: 'lab', state: { mass: 9 } }, owner_id: 'learner', classroom_id: 'progress' }]);
    expect(cache().pending.modules).toEqual({});
  });

  it('authenticates the owner before loading local changes and leaves other accounts untouched', async () => {
    storage.set('study-progress-v2:first:/classroom/progress', JSON.stringify({ v: 2, owner_id: 'first', pending: { scene: { id: 'private-scene', index: 2, at: 1000 }, modules: { private: { at: 1000, state: { answer: 'private' } } } } }));
    const fetch = vi.fn(async () => Response.json(server('second'))); vi.stubGlobal('fetch', fetch);
    const progress = await read();
    expect(await progress.loadStudyProgress()).toMatchObject({ owner_id: 'second', scene_id: 'scene-1', modules: {} });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache('first').pending.scene.id).toBe('private-scene');
  });

  it('can retry a failed initial read rather than caching the failed result for the whole lesson', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 })).mockResolvedValueOnce(Response.json(server())); vi.stubGlobal('fetch', fetch);
    const progress = await read();
    expect((await progress.loadStudyProgress()).owner_id).toBeUndefined();
    expect((await progress.loadStudyProgress()).owner_id).toBe('learner');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not restore or send progress when another tab has switched the classroom cookie', async () => {
    storage.set('study-progress-v2:learner:/classroom/progress', JSON.stringify({ v: 2, owner_id: 'learner', pending: { scene: null, modules: { unsent: { at: 1000, state: { answer: 'keep' } } } } }));
    const fetch = vi.fn(async () => Response.json({ ...server(), classroom_id: 'another-course', modules: { foreign: { at: 999, state: { answer: 'other-course' } } } }));
    vi.stubGlobal('fetch', fetch);
    const progress = await read();
    expect((await progress.loadStudyProgress()).owner_id).toBeUndefined();
    expect(await progress.savedModuleState('foreign')).toBeNull();
    progress.saveStudyModule('local', { answer: 'this-course' });
    await progress.flushStudyProgress(); await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch.mock.calls.every(([, init]) => init?.method !== 'PUT')).toBe(true);
    expect(cache().pending.modules.unsent.state).toEqual({ answer: 'keep' });
  });

  it.each([401, 403, 409])('preserves the outbox after PUT %i and retries only after authentication recovers', async status => {
    let fail = true;
    const writes: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Response.json(server());
      writes.push(JSON.parse(String(init.body)));
      return Response.json({}, { status: fail ? status : 200 });
    }));
    const progress = await read(); await progress.loadStudyProgress();
    progress.saveStudyModule('first', { answer: 1 });
    await progress.flushStudyProgress();
    progress.saveStudyModule('second', { answer: 2 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writes).toHaveLength(1);
    expect(cache().pending.modules).toMatchObject({ first: { state: { answer: 1 } }, second: { state: { answer: 2 } } });
    fail = false; window.dispatchEvent(new Event('online')); await progress.flushStudyProgress();
    expect(writes).toEqual([
      { owner_id: 'learner', classroom_id: 'progress', module: { scene_id: 'first', state: { answer: 1 } } },
      { owner_id: 'learner', classroom_id: 'progress', module: { scene_id: 'first', state: { answer: 1 } } },
      { owner_id: 'learner', classroom_id: 'progress', module: { scene_id: 'second', state: { answer: 2 } } },
    ]);
    expect(cache().pending.modules).toEqual({});
  });

  it('keeps queued edits when a renewed progress read is unauthenticated', async () => {
    let failRead = false;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? Response.json({}, { status: 503 }) : failRead ? Response.json({}, { status: 401 }) : Response.json(server()));
    vi.stubGlobal('fetch', fetch);
    const progress = await read(); await progress.loadStudyProgress();
    progress.saveStudyModule('lab', { mass: 9 }); await progress.flushStudyProgress();
    failRead = true; window.dispatchEvent(new Event('online')); await progress.flushStudyProgress();
    expect(cache().pending.modules.lab.state).toEqual({ mass: 9 });
    const calls = fetch.mock.calls.length; await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
});
