import { afterEach, describe, expect, it, vi } from 'vitest';
import { annotationCache, AnnotationSync, validAnnotation, type AnnotationCache, type AnnotationChange, type AnnotationTransport } from '../src/web/features/reader/annotation-sync';
import type { Annotation } from '../src/web/features/reader/PdfViewer';
const note = (id = 'note-001'): Annotation => ({ id, page: 3, type: 'note', data: { x: 70, y: 150, text: 'Compare the square roots' }, mine: true, visibility: 'private', color: '#fde68a' });
function fixture(options: Partial<AnnotationTransport> = {}) {
  let cache: AnnotationCache = { version: 1, owner_id: 'learner', book_id: 'book', changes: [] };
  const sent: AnnotationChange[] = [];
  const transport: AnnotationTransport = {
    owner: 'learner', book: 'book', load: async () => ({ owner_id: 'learner', annotations: [note()] }), read: async () => structuredClone(cache),
    append: async changes => { cache.changes.push(...structuredClone(changes)); },
    acknowledge: async id => { cache.changes = cache.changes.filter(change => change.id !== id); },
    send: async change => { sent.push(structuredClone(change)); }, message: error => (error as Error).message, ...options,
  };
  return { sync: new AnnotationSync(transport), transport, sent, cache: () => cache };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('durable reader annotations', () => {
  it('keeps a failed deletion visible as pending and restores it after reload until the batch is acknowledged', async () => {
    vi.useFakeTimers();
    const f = fixture({ send: async () => { throw Object.assign(Error('offline'), { status: 503 }); } });
    await f.sync.load(); f.sync.change([note()], []); await f.sync.flush();
    expect(f.sync.getSnapshot()).toMatchObject({ annotations: [], pending: 1, locallySaved: true, error: 'offline' });
    expect(f.cache().changes[0].removed).toEqual([note()]);
    f.sync.dispose();
    const resumed = new AnnotationSync({ ...f.transport, send: async change => { f.sent.push(change); } });
    await resumed.load(); await resumed.flush();
    expect(resumed.getSnapshot()).toMatchObject({ annotations: [], pending: 0, error: null });
    expect(f.cache().changes).toEqual([]); expect(f.sent).toHaveLength(1); resumed.dispose();
  });
  it('serializes writes and preserves an undo added while the original creation is in flight', async () => {
    let release!: () => void;
    const f = fixture({ send: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined) });
    await f.sync.load();
    const added = note('new-note'); f.sync.change([], [added]);
    const first = f.sync.flush(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.sync.change([added], []); expect(f.sync.flush()).toBe(first);
    release(); await first;
    expect(vi.mocked(f.transport.send).mock.calls.map(([change]) => [change.removed.map(a => a.id), change.added.map(a => a.id)])).toEqual([[[], ['new-note']], [['new-note'], []]]);
    expect(f.sync.getSnapshot()).toMatchObject({ annotations: [note()], pending: 0 }); f.sync.dispose();
  });
  it('durably stores later strokes even while an earlier network request is held', async () => {
    let release!: () => void;
    const f = fixture({ send: async () => new Promise<void>(resolve => { release = resolve; }) });
    await f.sync.load(); f.sync.change([], [note('first')]); const first = f.sync.flush();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    f.sync.change([], [note('second')]);
    await vi.waitFor(() => expect(f.cache().changes).toHaveLength(2));
    f.sync.dispose(); release(); await first;
    expect(f.cache().changes[0].added[0].id).toBe('second');
  });
  it('retries transient writes automatically but keeps another account’s queue untouched', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValueOnce(Object.assign(Error('offline'), { status: 503 })).mockResolvedValue(undefined);
    const f = fixture({ send }); await f.sync.load(); f.sync.change([note()], []); await f.sync.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2); expect(f.sync.getSnapshot().pending).toBe(0); f.sync.dispose();
    const read = vi.fn(async () => f.cache()), unauthorized = fixture({ load: async () => ({ owner_id: 'someone-else', annotations: [] }), read });
    await unauthorized.sync.load();
    expect(unauthorized.sync.getSnapshot().ready).toBe(false); expect(read).not.toHaveBeenCalled(); expect(unauthorized.sent).toEqual([]); unauthorized.sync.dispose();
  });
  it('retains already sent operations when acknowledging the local cache fails', async () => {
    const acknowledge = vi.fn().mockRejectedValueOnce(Error('local disk interrupted')).mockResolvedValue(undefined);
    const f = fixture({ acknowledge }); await f.sync.load(); f.sync.change([note()], []); await f.sync.flush();
    expect(f.sync.getSnapshot().pending).toBe(1); expect(f.cache().changes).toHaveLength(1);
    await f.sync.retry();
    expect(f.sent).toHaveLength(2); expect(f.sent[0]).toEqual(f.sent[1]); expect(f.sync.getSnapshot().pending).toBe(0); f.sync.dispose();
  });
  it('never sends an edit until its local transaction commits, and retains it when storage fails', async () => {
    const append = vi.fn().mockRejectedValueOnce(Error('storage full')).mockResolvedValue(undefined);
    const f = fixture({ append }); await f.sync.load(); f.sync.change([], [note('new-note')]);
    await f.sync.flush();
    expect(f.sent).toEqual([]); expect(f.sync.getSnapshot()).toMatchObject({ pending: 1, locallySaved: false });
    await f.sync.retry(); expect(f.sent).toHaveLength(1); expect(f.sync.getSnapshot().pending).toBe(0); f.sync.dispose();
  });
  it('does not retry authentication failures or discard unsynced edits', async () => {
    vi.useFakeTimers(); const send = vi.fn().mockRejectedValue(Object.assign(Error('identity changed'), { status: 409 }));
    const f = fixture({ send }); await f.sync.load(); f.sync.change([note()], []); await f.sync.flush();
    await vi.advanceTimersByTimeAsync(60000);
    expect(send).toHaveBeenCalledTimes(1); expect(f.cache().changes).toHaveLength(1); expect(f.sync.getSnapshot().pending).toBe(1); f.sync.dispose();
  });
  it('freezes a queued operation payload even if the caller later edits its source object', async () => {
    const f = fixture(); await f.sync.load(); const created = note('new-note');
    f.sync.change([], [created]); created.data.text = 'A later unrelated edit'; await f.sync.flush();
    expect(f.sent[0].added[0].data.text).toBe('Compare the square roots'); f.sync.dispose();
  });
  it('rejects caches scoped to another owner or book and never adopts unscoped data', () => {
    expect(annotationCache(undefined, 'learner', 'book').changes).toEqual([]);
    for (const value of [{version:1,owner_id:'other',book_id:'book',changes:[]},{version:1,owner_id:'learner',book_id:'other',changes:[]},[]]) expect(() => annotationCache(value as AnnotationCache, 'learner', 'book')).toThrow();
  });
  it('reports malformed cached operations without erasing or rendering them', async () => {
    const invalid = { version: 1, owner_id: 'learner', book_id: 'book', changes: [null] };
    const f = fixture({ read: async () => invalid as unknown as AnnotationCache }); await f.sync.load();
    expect(f.sync.getSnapshot()).toMatchObject({ ready: false, annotations: [] }); expect(f.sent).toEqual([]); expect(invalid.changes).toEqual([null]); f.sync.dispose();
    expect(validAnnotation(note())).toBe(true);
    expect(validAnnotation({ ...note(), data: { x: 'bad', y: 1, text: 'text' } })).toBe(false);
    expect(validAnnotation({ ...note(), type: 'highlight', data: { rects: 'not-an-array' } })).toBe(false);
    expect(validAnnotation({ ...note(), type: 'ink', data: { points: [[1, 2, Infinity]] } })).toBe(false);
  });
});
