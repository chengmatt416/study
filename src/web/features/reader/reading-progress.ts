export interface PendingReadingPage { id: string; page: number; changed_at: number }
export interface ReadingProgressCache { version: 1; owner_id: string; book_id: string; pending: PendingReadingPage | null }
export interface ReadingProgressServer { owner_id: string; lastPage: number | null; progress_updated_at: number | null; progress_changed_at?: number | null }
export interface ReadingProgressSnapshot { ready: boolean; initialPage: number; pending: PendingReadingPage | null; locallySaved: boolean; saving: boolean; error: string | null }
interface Transport {
  owner: string;
  book: string;
  read: () => Promise<ReadingProgressCache>;
  write: (pending: PendingReadingPage) => Promise<PendingReadingPage>;
  acknowledge: (id: string) => Promise<PendingReadingPage | null>;
  send: (pending: PendingReadingPage) => Promise<void>;
  message: (error: unknown) => string;
}

export function readingProgressCache(value: ReadingProgressCache | undefined, owner: string, book: string): ReadingProgressCache {
  if (!value) return { version: 1, owner_id: owner, book_id: book, pending: null };
  const pending = value.pending;
  if (value.version !== 1 || value.owner_id !== owner || value.book_id !== book || (pending !== null && (!pending || typeof pending.id !== "string" || !Number.isSafeInteger(pending.page) || pending.page < 1 || !Number.isFinite(pending.changed_at)))) throw new Error("無法讀取這個帳號的未同步閱讀進度，請保留瀏覽器資料並重試");
  return value;
}

/** One latest-page outbox per account and book; an old acknowledgement cannot erase a newer page. */
export class ReadingProgressSync {
  private pending: PendingReadingPage | null = null;
  private persistedId: string | null = null;
  private lastPage = 1;
  private lastIntent = 0;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private cacheLoaded = false;
  private flushing: Promise<void> | null = null;
  private persisting: Promise<void> = Promise.resolve();
  private stopped = false;
  private blocked = false;
  private delay = 2000;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: ReadingProgressSnapshot = { ready: false, initialPage: 1, pending: null, locallySaved: true, saving: false, error: null };
  constructor(private transport: Transport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<ReadingProgressSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...update, pending: this.pending, locallySaved: !this.pending || this.persistedId === this.pending.id };
    this.listeners.forEach(listener => listener());
  }
  initialize(server: ReadingProgressServer): Promise<void> {
    this.stopped = false;
    if (this.loading) return this.loading;
    if (this.snapshot.ready && this.cacheLoaded) return Promise.resolve();
    this.loading = (async () => {
      let verified = false;
      try {
        if (server.owner_id !== this.transport.owner) throw new Error("登入身分已變更，請重新開啟這本書");
        verified = true;
        this.lastIntent = Math.max(this.lastIntent, server.progress_changed_at ?? server.progress_updated_at ?? 0);
        const cache = readingProgressCache(await this.transport.read(), this.transport.owner, this.transport.book);
        const serverIntent = server.progress_changed_at ?? server.progress_updated_at ?? 0;
        let pending = cache.pending;
        while (pending && pending.changed_at <= serverIntent) pending = await this.transport.acknowledge(pending.id);
        const storedId = pending?.id ?? null;
        if (this.pending && this.pending.changed_at > serverIntent && (!pending || this.pending.changed_at >= pending.changed_at)) pending = this.pending;
        this.pending = pending;
        this.cacheLoaded = true;
        this.persistedId = storedId;
        this.lastPage = pending?.page ?? server.lastPage ?? 1;
        this.lastIntent = Math.max(this.lastIntent, pending?.changed_at ?? 0);
        this.publish({ ready: true, initialPage: this.lastPage, error: null });
        if (pending) void this.flush();
      } catch (error) {
        if (verified && !this.snapshot.ready) this.lastPage = server.lastPage ?? 1;
        this.publish({ ready: verified || this.snapshot.ready, initialPage: this.snapshot.ready ? this.snapshot.initialPage : this.lastPage, error: this.transport.message(error) });
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  save(page: number) {
    if (!this.snapshot.ready || !Number.isSafeInteger(page) || page < 1 || page === this.lastPage) return;
    this.lastPage = page;
    this.lastIntent = Math.max(Date.now(), this.lastIntent + 1);
    this.pending = { id: crypto.randomUUID(), page, changed_at: this.lastIntent };
    this.publish();
    void this.persist().catch(error => this.failed(error));
    if (!this.blocked) this.schedule(2000);
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.stopped && this.pending) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }
  private persist(): Promise<void> {
    const work = this.persisting.catch(() => {}).then(async () => {
      const pending = this.pending;
      if (!pending || this.persistedId === pending.id) return;
      const stored = await this.transport.write(pending);
      if (this.pending?.id === pending.id) this.pending = stored;
      this.persistedId = stored.id;
      this.publish();
    });
    this.persisting = work;
    return work;
  }
  private failed(error: unknown) {
    this.publish({ saving: false, error: this.transport.message(error) });
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    this.blocked = [401, 403, 409].includes(status);
    if (!this.blocked && (!status || status === 429 || status >= 500)) { this.schedule(this.delay); this.delay = Math.min(30000, this.delay * 2); }
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.snapshot.ready || this.stopped || !this.pending) return Promise.resolve();
    clearTimeout(this.timer); this.timer = undefined;
    this.flushing = (async () => {
      try {
        while (this.pending) {
          await this.persist();
          const pending = this.pending;
          if (!pending) break;
          this.publish({ saving: true });
          await this.transport.send(pending);
          const remaining = await this.transport.acknowledge(pending.id);
          if (this.pending?.id === pending.id) { this.pending = remaining; this.persistedId = remaining?.id ?? null; }
          this.publish({ error: null });
          if (this.stopped) break;
        }
        this.delay = 2000; this.blocked = false;
        this.publish({ saving: false });
      } catch (error) { this.failed(error); }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  retry = () => { this.stopped = false; this.blocked = false; return this.flush(); };
  dispose() { this.stopped = true; clearTimeout(this.timer); this.timer = undefined; }
}
