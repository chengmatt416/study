import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { cachedChanges, mergePendingProgress, ProgressQueue, type ProgressBody, type SavedProgress } from '../integrations/openmaic/cloudflare/overlay/lib/study-classroom/progress-sync';
import { signOpenMaicTicket } from '../src/shared/openmaic-transport';
import live from '../src/worker/routes/live-ai';
import { testDatabase } from './helpers/d1';

describe('learner progress outbox', () => {
  it('retains failed scene/module saves and persists an explicit clear across reload', async () => {
    const queue = new ProgressQueue();
    queue.saveScene('scene-2', 1, 100);
    queue.saveModule('lab', { mass: 4 }, 101);
    queue.saveModule('ink:scene-2', null, 102);
    expect(await queue.flush(async () => false)).toBe(false);
    expect(queue.size).toBe(3);
    const cache = JSON.parse(JSON.stringify({ v: 2, owner_id: 'learner', pending: queue.snapshot() }));
    const reloaded = new ProgressQueue(cachedChanges(cache, 'learner'));
    const sent: ProgressBody[] = [];
    expect(await reloaded.flush(async body => { sent.push(body); return true; })).toBe(true);
    expect(sent[0]).toEqual({ scene_id: 'scene-2', scene_index: 1 });
    expect(sent.slice(1)).toEqual(expect.arrayContaining([{ module: { scene_id: 'lab', state: { mass: 4 } } }, { module: { scene_id: 'ink:scene-2', state: null } }]));
    expect(sent).toHaveLength(3);
    expect(reloaded.size).toBe(0);
  });

  it('does not lose a newer edit when an earlier network request completes', async () => {
    const queue = new ProgressQueue();
    queue.saveScene('scene-1', 0, 100);
    let release!: (value: boolean) => void;
    const sent: ProgressBody[] = [];
    const send = vi.fn((body: ProgressBody) => {
      sent.push(body);
      return sent.length === 1 ? new Promise<boolean>(resolve => { release = resolve; }) : Promise.resolve(true);
    });
    const first = queue.flush(send);
    queue.saveScene('scene-3', 2, 100); // same millisecond still represents a different edit
    queue.saveModule('lab', { mass: 2 }, 100);
    expect(queue.flush(send)).toBe(first);
    release(true);
    expect(await first).toBe(true);
    expect(sent).toEqual([{ scene_id: 'scene-1', scene_index: 0 }, { module: { scene_id: 'lab', state: { mass: 2 } } }, { scene_id: 'scene-3', scene_index: 2 }]);
    expect(queue.size).toBe(0);
  });

  it('retries only unsaved changes after a partial write failure', async () => {
    const queue = new ProgressQueue();
    queue.saveScene('scene-2', 1, 10);
    queue.saveModule('lab', { mass: 4 }, 11);
    const first = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('offline'));
    expect(await queue.flush(first)).toBe(false);
    expect(queue.snapshot()).toEqual({ scene: null, modules: { lab: { at: 11, state: { mass: 4 } } } });
    queue.saveModule('lab', { mass: 9 }, 12);
    const retry = vi.fn().mockResolvedValue(true);
    expect(await queue.flush(retry)).toBe(true);
    expect(retry).toHaveBeenCalledExactlyOnceWith({ module: { scene_id: 'lab', state: { mass: 9 } } });
  });

  it('merges unsynced work with server progress without replacing newer work from another device', () => {
    const server: SavedProgress = { owner_id: 'learner', scene_id: 'scene-1', scene_index: 0, updated_at: 100, modules: { lab: { at: 100, state: { mass: 1 } }, newer: { at: 300, state: { answer: 'recent' } }, 'ink:scene-1': { at: 90, state: { s: [1] } } } };
    const pending = { scene: { at: 200, id: 'scene-2', index: 1 }, modules: { lab: { at: 200, state: { mass: 4 } }, newer: { at: 200, state: { answer: 'stale' } }, 'ink:scene-1': { at: 200, state: null } } };
    const result = mergePendingProgress(server, pending);
    expect(result.saved).toMatchObject({ scene_id: 'scene-2', scene_index: 1, modules: { lab: { state: { mass: 4 } }, newer: { state: { answer: 'recent' } } } });
    expect(result.saved.modules).not.toHaveProperty('ink:scene-1');
    expect(result.pending.modules).not.toHaveProperty('newer');
    const older = mergePendingProgress(result.saved, { scene: { at: 150, id: 'scene-old', index: 0 }, modules: {} });
    expect(older.saved.scene_id).toBe('scene-2');
    expect(older.pending.scene).toBeNull();
  });

  it('never replays a different account’s local cache or unscoped legacy state', () => {
    const queue = new ProgressQueue(); queue.saveScene('private-scene', 2, 100);
    const cache = { v: 2, owner_id: 'first-person', pending: queue.snapshot() };
    expect(cachedChanges(cache, 'second-person')).toEqual({ scene: null, modules: {} });
    expect(cachedChanges({ scene_id: 'private-scene', modules: {} }, 'first-person')).toEqual({ scene: null, modules: {} });
    expect(cachedChanges({ v: 2, owner_id: 'first-person', pending: { scene: { at: NaN, id: 'bad', index: -1 }, modules: { bad: { at: 'bad', state: [] } } } }, 'first-person')).toEqual({ scene: null, modules: {} });
  });
});

describe('classroom progress owner identity', () => {
  let fixture: ReturnType<typeof testDatabase> | undefined;
  afterEach(() => { fixture?.db.close(); });
  it('returns the authenticated owner and classroom and rejects writes queued for another account or classroom', async () => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('progress-user','progress@test.example',1); INSERT INTO allowlist(email,role,created_at) VALUES ('progress@test.example','member',1)");
    const secret = 'progress-test-secret-'.repeat(3);
    const ticket = await signOpenMaicTicket({ sub: 'study:progress-user', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'classroom', exp: Date.now() + 60000 }, secret);
    const env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: secret } as unknown as Env;
    const app = new Hono(); app.route('/live', live); app.onError(error => error instanceof HTTPException ? error.getResponse() : new Response('error', { status: 500 }));
    const send = (body: unknown) => app.request('/live/progress', { method: 'PUT', headers: { cookie: 'study_openmaic=' + ticket, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
    expect((await send({ owner_id: 'progress-user', classroom_id: 'classroom', scene_id: 'scene-2', scene_index: 1 })).status).toBe(200);
    expect((await send({ owner_id: 'other-user', scene_id: 'wrong-scene', scene_index: 9 })).status).toBe(409);
    expect((await send({ owner_id: 'progress-user', classroom_id: 'another-classroom', scene_id: 'wrong-scene', scene_index: 9 })).status).toBe(409);
    const response = await app.request('/live/progress', { headers: { cookie: 'study_openmaic=' + ticket } }, env);
    expect(await response.json()).toMatchObject({ owner_id: 'progress-user', classroom_id: 'classroom', scene_id: 'scene-2', scene_index: 1 });
    expect((await send({ scene_id: 'legacy-scene', scene_index: 2 })).status).toBe(200);
  });
});
