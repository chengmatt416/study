import { afterEach, describe, expect, it, vi } from 'vitest';
import { readingProgressCache, ReadingProgressSync, type ReadingProgressCache, type PendingReadingPage, type ReadingProgressServer } from '../src/web/features/reader/reading-progress';
const server = (page = 3, at = 100): ReadingProgressServer => ({ owner_id: 'learner', lastPage: page, progress_updated_at: at });
function fixture(initial: PendingReadingPage | null = null, options: Record<string, unknown> = {}) {
  let cache: ReadingProgressCache = { version: 1, owner_id: 'learner', book_id: 'book', pending: initial };
  const sent: PendingReadingPage[] = [];
  const transport = {
    owner: 'learner', book: 'book', read: async () => structuredClone(cache),
    write: async (pending: PendingReadingPage) => { cache.pending = structuredClone(pending); return pending; },
    acknowledge: async (id: string) => { if (cache.pending?.id === id) cache.pending = null; return cache.pending; },
    send: async (pending: PendingReadingPage) => { sent.push(structuredClone(pending)); }, message: (error: unknown) => (error as Error).message,
    ...options,
  };
  return { sync: new ReadingProgressSync(transport), transport, sent, cache: () => cache };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('latest reading-page outbox', () => {
  it('persists the latest page immediately, debounces remote saves and survives a failed save across reload', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const send = vi.fn().mockRejectedValue(Error('offline')), f = fixture(null, { send });
    await f.sync.initialize(server()); f.sync.save(4); f.sync.save(5);
    await vi.advanceTimersByTimeAsync(0); expect(f.cache().pending?.page).toBe(5); expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000); expect(send).toHaveBeenCalledTimes(1); expect(f.sync.getSnapshot()).toMatchObject({ pending: { page: 5 }, locallySaved: true, error: 'offline' });
    f.sync.dispose();
    const resumed = new ReadingProgressSync({ ...f.transport, send: async pending => { f.sent.push(pending); } });
    await resumed.initialize(server()); expect(resumed.getSnapshot().initialPage).toBe(5); await resumed.flush();
    expect(f.sent.map(item => item.page)).toEqual([5]); expect(f.cache().pending).toBeNull(); resumed.dispose();
  });
  it('prefers newer server progress and does not replay an older local page from another device', async () => {
    const f = fixture({ id: 'old-page', page: 4, changed_at: 200 }); await f.sync.initialize(server(8, 300));
    expect(f.sync.getSnapshot()).toMatchObject({ ready: true, initialPage: 8, pending: null }); expect(f.sent).toEqual([]); expect(f.cache().pending).toBeNull(); f.sync.dispose();
  });
  it('keeps a newer local page when an older remote write committed after that local edit', async () => {
    const f = fixture({ id: 'newer-page', page: 5, changed_at: 110 });
    await f.sync.initialize({ ...server(4, 120), progress_changed_at: 100 });
    expect(f.sync.getSnapshot().initialPage).toBe(5); await f.sync.flush();
    expect(f.sent.map(item => item.page)).toEqual([5]); f.sync.dispose();
  });
  it('never rewrites the saved place merely because the book was opened', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.sync.initialize(server()); f.sync.save(3); await vi.advanceTimersByTimeAsync(60000);
    expect(f.cache().pending).toBeNull(); expect(f.sent).toEqual([]); f.sync.dispose();
  });
  it('keeps successive intents ordered even within the same millisecond', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); const f = fixture(); await f.sync.initialize(server());
    f.sync.save(4); const first = f.sync.getSnapshot().pending!; f.sync.save(5); const second = f.sync.getSnapshot().pending!;
    expect(second.changed_at).toBeGreaterThan(first.changed_at); await f.sync.flush(); f.sync.dispose();
  });
  it('serializes an in-flight write and preserves a newer page when the older acknowledgement arrives', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); let release!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined), f = fixture(null, { send });
    await f.sync.initialize(server()); f.sync.save(4); const first = f.sync.flush(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    vi.setSystemTime(1200); f.sync.save(5); await vi.waitFor(() => expect(f.cache().pending?.page).toBe(5));
    expect(f.sync.flush()).toBe(first); release(); await first;
    expect(send.mock.calls.map(([item]) => item.page)).toEqual([4, 5]); expect(f.cache().pending).toBeNull(); f.sync.dispose();
  });
  it('checks the owner before reading local state and rejects unscoped or mismatched caches', async () => {
    const read = vi.fn(), f = fixture(null, { read }); await f.sync.initialize({ ...server(), owner_id: 'another-person' });
    expect(read).not.toHaveBeenCalled(); expect(f.sync.getSnapshot().ready).toBe(false); f.sync.dispose();
    for (const value of [{ version: 1, owner_id: 'other', book_id: 'book', pending: null }, { version: 1, owner_id: 'learner', book_id: 'other', pending: null }, { page: 5 }]) expect(() => readingProgressCache(value as ReadingProgressCache, 'learner', 'book')).toThrow();
  });
  it('keeps locally stored progress when authentication changes and does not retry it automatically', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); const send = vi.fn().mockRejectedValue(Object.assign(Error('account changed'), { status: 409 })), f = fixture(null, { send });
    await f.sync.initialize(server()); f.sync.save(5); await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1); expect(f.cache().pending?.page).toBe(5); f.sync.dispose();
  });
  it('keeps the PDF readable if device storage is unavailable and retains the unsaved page until retry commits it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    let fail = true; const f = fixture(); const read = f.transport.read, write = f.transport.write;
    f.transport.read = async () => { if (fail) throw Error('device storage unavailable'); return read(); };
    f.transport.write = async pending => { if (fail) throw Error('device storage unavailable'); return write(pending); };
    await f.sync.initialize(server()); expect(f.sync.getSnapshot()).toMatchObject({ ready: true, initialPage: 3 });
    f.sync.save(5); await f.sync.flush(); expect(f.sent).toEqual([]); expect(f.sync.getSnapshot()).toMatchObject({ pending: { page: 5 }, locallySaved: false });
    fail = false; await f.sync.initialize(server()); await f.sync.flush(); expect(f.sent.map(item => item.page)).toEqual([5]); expect(f.cache().pending).toBeNull(); f.sync.dispose();
  });
});
