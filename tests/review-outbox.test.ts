import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, api, idb, failure } = vi.hoisted(() => {
  const storage = { value: undefined as unknown };
  const failure = { write: false };
  let transaction = Promise.resolve();
  return {
    storage, failure,
    api: { post: vi.fn() },
    idb: {
      get: vi.fn(async () => structuredClone(storage.value)),
      update: vi.fn((_key: string, update: (items: unknown) => unknown) => {
        const result = transaction.then(() => {
          if (failure.write) throw new Error("Storage unavailable");
          storage.value = update(structuredClone(storage.value));
          return storage.value;
        });
        transaction = result.then(() => undefined, () => undefined);
        return result;
      }),
    },
  };
});
vi.mock("../src/web/lib/idb", () => ({ idb }));
vi.mock("../src/web/lib/api", () => ({ api }));
import { enqueueReview, flushReviewOutbox, legacyReviewCount, pendingReviews, recoverLegacyReviews } from "../src/web/features/decks/outbox";
const item = (id: string) => ({ id, card_id: "card", rating: 3 as const, mode: "smart", reviewed_at: 100 });

describe("複習紀錄持久化", () => {
  beforeEach(() => {
    storage.value = undefined; failure.write = false; vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: false });
    api.post.mockResolvedValue({});
  });
  it("快速連續儲存不覆蓋彼此，確認送出前不移除", async () => {
    await Promise.all([enqueueReview("learner", item("one")), enqueueReview("learner", item("two"))]);
    expect((await pendingReviews("learner")).map((r) => r.id)).toEqual(["one", "two"]);
    let release: () => void = () => undefined;
    api.post.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const sync = flushReviewOutbox("learner");
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(await pendingReviews("learner")).toHaveLength(2);
    await enqueueReview("learner", item("three"));
    release(); await sync;
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1].items).toMatchObject([{ id: "three" }]);
    expect(await pendingReviews("learner")).toEqual([]);
  });
  it("網路失敗保留紀錄，可安全重試；多處觸發只啟動一次同步", async () => {
    await enqueueReview("learner", item("one"));
    api.post.mockRejectedValueOnce(new Error("offline"));
    const first = flushReviewOutbox("learner");
    expect(flushReviewOutbox("learner")).toBe(first);
    await first;
    expect(await pendingReviews("learner")).toHaveLength(1);
    await flushReviewOutbox("learner");
    expect(await pendingReviews("learner")).toHaveLength(0);
    expect(api.post).toHaveBeenCalledTimes(2);
  });
  it("本機儲存失敗會通知評分流程，不假裝已儲存", async () => {
    failure.write = true;
    await expect(enqueueReview("learner", item("one"))).rejects.toThrow("Storage unavailable");
    expect(api.post).not.toHaveBeenCalled();
  });
  it("隔離共用瀏覽器的不同帳號，送出時同時核對原作答帳號", async () => {
    await enqueueReview("first", item("first-review"));
    await enqueueReview("second", item("second-review"));
    expect(await pendingReviews("second")).toEqual([item("second-review")]);
    await flushReviewOutbox("second");
    expect(api.post).toHaveBeenCalledExactlyOnceWith("/api/reviews", { owner_id: "second", items: [item("second-review")] });
    expect(await pendingReviews("first")).toEqual([item("first-review")]);
    expect(await pendingReviews("second")).toEqual([]);
  });
  it("較早帳號的同步不會阻擋新帳號，也不移除新帳號的未同步作答", async () => {
    await enqueueReview("first", item("first-review")); await enqueueReview("second", item("second-review"));
    let release!: () => void;
    api.post.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockRejectedValueOnce(Error("temporarily offline"));
    const first = flushReviewOutbox("first");
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await flushReviewOutbox("second");
    expect(api.post.mock.calls[1][1].owner_id).toBe("second");
    release(); await first;
    expect(await pendingReviews("first")).toEqual([]);
    expect(await pendingReviews("second")).toEqual([item("second-review")]);
  });
  it("舊版未註明帳號的紀錄不自動送出，原作答者確認後原子恢復且保留其他帳號", async () => {
    storage.value = [item("legacy")];
    await enqueueReview("other", item("other-new"));
    expect(await pendingReviews("original")).toEqual([]);
    await flushReviewOutbox("original"); expect(api.post).not.toHaveBeenCalled();
    expect(await legacyReviewCount()).toBe(1);
    failure.write = true;
    await expect(recoverLegacyReviews("original")).rejects.toThrow("Storage unavailable");
    expect(await legacyReviewCount()).toBe(1);
    failure.write = false; await recoverLegacyReviews("original");
    expect(await legacyReviewCount()).toBe(0);
    expect(await pendingReviews("original")).toEqual([item("legacy")]);
    expect(await pendingReviews("other")).toEqual([item("other-new")]);
    await recoverLegacyReviews("original");
    expect(await pendingReviews("original")).toHaveLength(1);
  });
});
