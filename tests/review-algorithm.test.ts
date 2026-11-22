import { describe, expect, it } from "vitest";
import { applyRating, buildSmartQueue, DEFAULT_REVIEW_SETTINGS, formatInterval, previewIntervals, Rating, State, studyDayStart, type ReviewStateRow } from "../src/shared/srs";
import { answerReview, createReviewSession, nextReview, reconcileReviewQueue, reviewShortcut, type ReviewQueue } from "../src/shared/review-session";

const at = Date.parse("2026-10-30T08:00:00Z");
const row = (id: string, values: Partial<ReviewStateRow> = {}): ReviewStateRow => ({ card_id: id, deck_id: "deck", due: at - 1000, stability: 5, difficulty: 5, elapsed_days: 5, scheduled_days: 5, learning_steps: 0, reps: 4, lapses: 0, state: State.Review, last_review: at - 86400000, ...values });
const event = (key: string, repeat = false) => ({ key, repeat, altKey: false, ctrlKey: false, metaKey: false });

describe("智慧排程與預覽", () => {
  it("到期重學優先，其次為回想風險，而非只比較到期日", () => {
    const rows = [row("strong", { due: at - 100000 }), row("weak", { stability: 0.1 }), row("learning", { state: State.Relearning })];
    expect(buildSmartQueue(rows.map((r, ord) => ({ id: r.card_id, ord })), new Map(rows.map((r) => [r.card_id, r])), at, 0).map((r) => r.id)).toEqual(["learning", "weak", "strong"]);
  });
  it("積壓到期卡時暫緩新卡，保留所有到期卡且不重排原始資料", () => {
    const rows = Array.from({ length: 42 }, (_, i) => row(`due${i}`));
    const cards = [...rows.map((r, ord) => ({ id: r.card_id, ord })), { id: "new", ord: 99 }];
    const queue = buildSmartQueue(cards, new Map(rows.map((r) => [r.card_id, r])), at, 20);
    expect(queue).toHaveLength(42);
    expect(queue.some((r) => r.isNew)).toBe(false);
    expect(cards.at(-1)?.id).toBe("new");
  });
  it("預覽與實際套用一致，均套用考試日期、記憶率及穩定 fuzz 種子", () => {
    const previous = row("card", { stability: 100, last_review: at - 20 * 86400000 });
    const preview = previewIntervals(previous, new Date(at), "2026-11-02", 0.95);
    for (const [index, key] of ["again", "hard", "good", "easy"].entries()) {
      const next = applyRating(previous, (index + 1) as 1 | 2 | 3 | 4, new Date(at), { cardId: "card", deckId: "deck" }, "2026-11-02", 0.95);
      expect(preview[key as keyof typeof preview]).toBe(formatInterval(next.due - at));
      expect(next.due).toBeLessThanOrEqual(Date.parse("2026-11-02T00:00:00+08:00"));
    }
  });
  it("提高目標記憶率會縮短長期複習間隔，且不修改舊紀錄", () => {
    const previous = row("card", { stability: 30, last_review: at - 20 * 86400000 });
    const low = applyRating(previous, Rating.Good, new Date(at), { cardId: "card", deckId: "deck" }, null, 0.8);
    const high = applyRating(previous, Rating.Good, new Date(at), { cardId: "card", deckId: "deck" }, null, 0.97);
    expect(high.due).toBeLessThan(low.due);
    expect(previous.reps).toBe(4);
  });
  it("UTC+8 午夜切換每日額度", () => {
    expect(studyDayStart(Date.parse("2026-10-30T15:59:59Z"))).toBe(Date.parse("2026-10-29T16:00:00Z"));
    expect(studyDayStart(Date.parse("2026-10-30T16:00:00Z"))).toBe(Date.parse("2026-10-30T16:00:00Z"));
  });
  it("考試前不到一小時也不排到考試日之後", () => {
    const now = new Date("2026-11-01T23:45:00+08:00");
    const next = applyRating(row("card"), Rating.Easy, now, { cardId: "card", deckId: "deck" }, "2026-11-02");
    expect(next.due).toBeLessThanOrEqual(Date.parse("2026-11-02T00:00:00+08:00"));
    expect(next.due).toBeGreaterThan(now.getTime());
  });
});

describe("短回合與互動保護", () => {
  it("遺忘卡依排程等待，未到期不提前重看；熟悉後離開本輪", () => {
    let session = createReviewSession(["card", "other"], 10, at);
    session = answerReview(session, "card", 1, row("card", { state: State.Relearning, due: at + 60000 }));
    expect(nextReview(session, at)?.id).toBe("other");
    session = answerReview(session, "other", 3, row("other"));
    expect(nextReview(session, at + 59999)).toBeUndefined();
    expect(nextReview(session, at + 60000)?.id).toBe("card");
    session = answerReview(session, "card", 3, row("card"));
    expect(session.pending).toEqual([]);
    expect(session.seen).toEqual(["card", "other"]);
    expect(session.ratings).toEqual([1, 0, 2, 0]);
  });
  it("初次 Good 仍在學習階段時保留排定的重學，不只處理 Again", () => {
    const session = answerReview(createReviewSession(["new"], 20, at), "new", 3, applyRating(null, 3, new Date(at), { cardId: "new", deckId: "deck" }));
    expect(session.pending[0].due).toBeGreaterThan(at);
    expect(nextReview(session, at)).toBeUndefined();
  });
  it("練習模式不重排，已完成卡片不接受第二次評分", () => {
    const first = answerReview(createReviewSession(["card"], 20, at), "card", 1);
    expect(first.pending).toEqual([]);
    expect(answerReview(first, "card", 1)).toBe(first);
  });
  it("快捷鍵忽略長按、組合鍵和未翻面評分", () => {
    expect(reviewShortcut(event("1"), false, false)).toBeNull();
    expect(reviewShortcut(event(" "), false, false)).toBe("reveal");
    expect(reviewShortcut(event("1", true), true, false)).toBeNull();
    expect(reviewShortcut({ ...event("1"), ctrlKey: true }, true, false)).toBeNull();
    expect(reviewShortcut(event("3"), true, false)).toBe(3);
    expect(reviewShortcut(event("2"), true, true)).toBe(3);
  });
  it("未同步評分不會讓同裝置立刻重抽同一張新卡或重複消耗額度", () => {
    const queue: ReviewQueue = { ids: ["new", "second"], states: {}, settings: { ...DEFAULT_REVIEW_SETTINGS, new_per_day: 1 }, summary: { due: 0, learning: 0, new: 1, new_today: 0, new_remaining: 1, deferred_new: 0, next_due: null, suggested_new_per_day: null } };
    const result = reconcileReviewQueue(queue, [{ card_id: "new", rating: 3, mode: "smart", reviewed_at: at }], "deck", at + 1000);
    expect(result.ids).toEqual([]);
    expect(result.states.new.reps).toBe(1);
    expect(queue.states).toEqual({});
    expect(reconcileReviewQueue(queue, [], "deck", at, "shuffle").ids).toEqual(queue.ids);
  });
});
