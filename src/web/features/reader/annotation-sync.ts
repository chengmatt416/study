import type { Annotation } from "./PdfViewer";

export interface AnnotationChange { id: string; removed: Annotation[]; added: Annotation[] }
export interface AnnotationCache { version: 1; owner_id: string; book_id: string; changes: AnnotationChange[] }
export interface AnnotationSnapshot { annotations: Annotation[]; ready: boolean; pending: number; saving: boolean; locallySaved: boolean; error: string | null }
export interface AnnotationTransport {
  owner: string;
  book: string;
  load: () => Promise<{ owner_id: string; annotations: Annotation[] }>;
  read: () => Promise<AnnotationCache>;
  append: (changes: AnnotationChange[]) => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
  send: (change: AnnotationChange) => Promise<void>;
  message: (error: unknown) => string;
}

export function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Annotation, data = annotation.data;
  if (typeof annotation.id !== "string" || !Number.isSafeInteger(annotation.page) || annotation.page < 1 || typeof annotation.color !== "string" || !["private", "shared"].includes(annotation.visibility) || typeof annotation.mine !== "boolean" || !data || typeof data !== "object" || Array.isArray(data)) return false;
  if (annotation.type === "note") return Number.isFinite(data.x) && Number.isFinite(data.y) && typeof data.text === "string";
  if (annotation.type === "ink") return Array.isArray(data.points) && data.points.length > 0 && data.points.every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) && (data.width === undefined || Number.isFinite(data.width));
  return ["highlight", "underline", "strike", "rect"].includes(annotation.type) && Array.isArray(data.rects) && data.rects.every(rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] >= 0 && rect[3] >= 0);
}

export function annotationCache(value: unknown, owner: string, book: string): AnnotationCache {
  if (value === undefined) return { version: 1, owner_id: owner, book_id: book, changes: [] };
  const cache = value as AnnotationCache | null;
  if (!cache || cache.version !== 1 || cache.owner_id !== owner || cache.book_id !== book || !Array.isArray(cache.changes) || !cache.changes.every(change => change && typeof change.id === "string" && Array.isArray(change.removed) && Array.isArray(change.added) && change.removed.every(validAnnotation) && change.added.every(validAnnotation))) throw new Error("無法讀取這個帳號的未同步標注，請保留瀏覽器資料並重試");
  return cache;
}

export function applyAnnotationChanges(annotations: Annotation[], changes: AnnotationChange[]): Annotation[] {
  const result = new Map(annotations.map(annotation => [annotation.id, annotation]));
  for (const change of changes) {
    for (const removed of change.removed) result.delete(removed.id);
    for (const added of change.added) result.set(added.id, added);
  }
  return [...result.values()];
}

/** Keep edits visible and durable until the same atomic batch has been acknowledged. */
export class AnnotationSync {
  private base: Annotation[] = [];
  private changes: AnnotationChange[] = [];
  private persisted = new Set<string>();
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  private persisting: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delay = 2000;
  private stopped = false;
  private snapshot: AnnotationSnapshot = { annotations: [], ready: false, pending: 0, saving: false, locallySaved: true, error: null };
  constructor(private transport: AnnotationTransport) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(update: Partial<AnnotationSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...update, annotations: applyAnnotationChanges(this.base, this.changes), pending: this.changes.length, locallySaved: this.changes.every(change => this.persisted.has(change.id)) };
    this.listeners.forEach(listener => listener());
  }
  load(): Promise<void> {
    this.stopped = false;
    if (this.loading) return this.loading;
    if (this.snapshot.ready) return this.flush();
    this.loading = (async () => {
      try {
        const response = await this.transport.load();
        if (response.owner_id !== this.transport.owner) throw new Error("登入身分已變更，請重新開啟這本書");
        const cache = annotationCache(await this.transport.read(), this.transport.owner, this.transport.book);
        this.base = response.annotations;
        this.changes = cache.changes;
        this.persisted = new Set(cache.changes.map(change => change.id));
        this.publish({ ready: true, error: null });
        void this.flush();
      } catch (error) { this.publish({ error: this.transport.message(error) }); }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  change(removed: Annotation[], added: Annotation[]) {
    if (!this.snapshot.ready) return;
    this.changes.push(structuredClone({ id: crypto.randomUUID(), removed, added }));
    this.publish();
    if (this.flushing) void this.persist().catch(error => this.failed(error));
    else void this.flush();
  }
  private persist(): Promise<void> {
    const work = this.persisting.catch(() => {}).then(async () => {
      const pending = this.changes.filter(change => !this.persisted.has(change.id));
      if (!pending.length) return;
      await this.transport.append(pending);
      pending.forEach(change => this.persisted.add(change.id));
      this.publish();
    });
    this.persisting = work;
    return work;
  }
  private failed(error: unknown) {
    this.publish({ saving: false, error: this.transport.message(error) });
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
    if (!this.stopped && (!status || status === 429 || status >= 500) && !this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.delay);
      this.delay = Math.min(30000, this.delay * 2);
    }
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.snapshot.ready || this.stopped || !this.changes.length) return Promise.resolve();
    clearTimeout(this.timer); this.timer = undefined;
    this.flushing = (async () => {
      try {
        await this.persist();
        while (this.changes.length) {
          const change = this.changes[0];
          if (!this.persisted.has(change.id)) await this.persist();
          this.publish({ saving: true });
          await this.transport.send(change);
          await this.transport.acknowledge(change.id);
          this.base = applyAnnotationChanges(this.base, [change]);
          this.changes.shift();
          this.publish({ error: null });
          if (this.stopped) break;
        }
        this.delay = 2000;
        this.publish({ saving: false });
      } catch (error) { this.failed(error); }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  retry = () => { this.stopped = false; return this.snapshot.ready ? this.flush() : this.load(); };
  dispose() { this.stopped = true; clearTimeout(this.timer); this.timer = undefined; }
}
