// 離線複習佇列：評分先寫入 IndexedDB，連線時批次送出（伺服器以 review id 去重，可安全重送）。
import { idb } from "../../lib/idb";
import { api } from "../../lib/api";

export interface ReviewItem {
  id: string;
  card_id: string;
  rating: 1 | 2 | 3 | 4;
  mode: string;
  reviewed_at: number;
  duration_ms?: number;
}

const KEY = "review-outbox";
interface ReviewStore { version: 2; queues: Record<string, ReviewItem[]>; legacy: ReviewItem[] }
const flushing = new Map<string, Promise<void>>();
function stored(value?: ReviewStore | ReviewItem[]): ReviewStore {
  if (Array.isArray(value)) return { version: 2, queues: {}, legacy: value };
  if (!value) return { version: 2, queues: {}, legacy: [] };
  if (value.version !== 2 || !value.queues || !Array.isArray(value.legacy)) throw new Error("無法讀取尚未同步的複習紀錄，請保留此瀏覽器的資料並聯絡管理員");
  return value;
}
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("study-review-outbox")); };

export async function enqueueReview(ownerId: string, item: ReviewItem) {
  await idb.update<ReviewStore | ReviewItem[]>(KEY, value => {
    const data = stored(value);
    return { ...data, queues: { ...data.queues, [ownerId]: [...(data.queues[ownerId] ?? []), item] } };
  });
  changed();
  if (navigator.onLine) void flushReviewOutbox(ownerId);
}

export async function pendingReviews(ownerId: string) {
  return stored(await idb.get<ReviewStore | ReviewItem[]>(KEY)).queues[ownerId] ?? [];
}

export async function outboxSize(ownerId: string) {
  return (await pendingReviews(ownerId)).length;
}

export async function legacyReviewCount() {
  return stored(await idb.get<ReviewStore | ReviewItem[]>(KEY)).legacy.length;
}

/** Old records contain no account identity; move them only after the original learner confirms ownership. */
export async function recoverLegacyReviews(ownerId: string) {
  await idb.update<ReviewStore | ReviewItem[]>(KEY, value => {
    const data = stored(value), own = data.queues[ownerId] ?? [];
    const ids = new Set(own.map(item => item.id));
    return { ...data, legacy: [], queues: { ...data.queues, [ownerId]: [...own, ...data.legacy.filter(item => !ids.has(item.id))] } };
  });
  changed();
}

export function flushReviewOutbox(ownerId: string): Promise<void> {
  const active = flushing.get(ownerId);
  if (active) return active;
  const work = (async () => {
    try {
      while (true) {
        const batch = (await pendingReviews(ownerId)).slice(0, 200);
        if (!batch.length) return;
        await api.post("/api/reviews", { owner_id: ownerId, items: batch });
        const sent = new Set(batch.map((item) => item.id));
        await idb.update<ReviewStore | ReviewItem[]>(KEY, value => {
          const data = stored(value);
          return { ...data, queues: { ...data.queues, [ownerId]: (data.queues[ownerId] ?? []).filter(item => !sent.has(item.id)) } };
        });
        changed();
      }
    } catch {
      /* 保留未送出的紀錄，連線恢復後重試。 */
    }
  })().finally(() => { flushing.delete(ownerId); });
  flushing.set(ownerId, work);
  return work;
}
