import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepClassroomSession } from '../overlay/lib/study-classroom/session';

describe('active classroom session renewal', () => {
  let page: EventTarget & { visibilityState: string };
  beforeEach(() => {
    vi.useFakeTimers();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page); vi.stubGlobal('window', new EventTarget());
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('keeps a half-hour lesson authenticated without extending hidden tabs', async () => {
    const fetch = vi.fn(async () => Response.json({ expires_at: Date.now() + 900000 })); vi.stubGlobal('fetch', fetch);
    const stop = keepClassroomSession('lesson', vi.fn());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ classroom_id: 'lesson' });
    page.visibilityState = 'hidden'; await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(7);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(8);
    stop(); await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('retries transient failures and warns once when authentication has expired', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch); const expired = vi.fn(), stop = keepClassroomSession('lesson', expired);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetch).toHaveBeenCalledTimes(3); expect(expired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_000); expect(fetch).toHaveBeenCalledTimes(3); stop();
  });
  it('never overlaps slow renewals or warns after unmount', async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal('fetch', fetch);
    const expired = vi.fn(), stop = keepClassroomSession('lesson', expired);
    await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(1);
    stop(); expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    release(new Response(null, { status: 409 })); await vi.advanceTimersByTimeAsync(0);
    expect(expired).not.toHaveBeenCalled();
  });
  it('rechecks on return to the classroom, including focus during an older renewal', async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch); const expired = vi.fn(), stop = keepClassroomSession('lesson', expired);
    window.dispatchEvent(new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(1);
    release(Response.json({ expires_at: Date.now() + 900000 })); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2); expect(expired).toHaveBeenCalledTimes(1);
    stop(); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
