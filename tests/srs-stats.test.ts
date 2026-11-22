import { describe, expect, it } from "vitest";
import { applyRating, buildSmartQueue, Rating, shuffle, type ReviewStateRow } from "../src/shared/srs";
import { oneVar, regression, twoVar, parseColumns } from "../src/shared/stats";

describe("FSRS", () => {
  it("新卡評 Good 後排程到未來，Again 則很快到期", () => {
    const now = new Date("2026-10-01T08:00:00Z");
    const good = applyRating(null, Rating.Good, now, { cardId: "c", deckId: "d" });
    const again = applyRating(null, Rating.Again, now, { cardId: "c", deckId: "d" });
    expect(good.due).toBeGreaterThan(now.getTime());
    expect(again.due).toBeLessThanOrEqual(good.due);
    expect(good.reps).toBe(1);
  });

  it("考前衝刺：排程不超過考試日", () => {
    let row: ReviewStateRow | null = null;
    let t = new Date("2026-10-01T08:00:00Z");
    for (let i = 0; i < 6; i++) {
      row = applyRating(row, Rating.Easy, t, { cardId: "c", deckId: "d" }, "2026-10-13");
      t = new Date(row.due);
    }
    expect(row!.due).toBeLessThanOrEqual(new Date("2026-10-13T00:00:00").getTime());
  });

  it("佇列：到期卡 + 新卡上限", () => {
    const now = Date.now();
    const cards = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, ord: i }));
    const states = new Map<string, ReviewStateRow>();
    states.set("c0", { card_id: "c0", deck_id: "d", due: now - 1000, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: now - 86400000 });
    states.set("c1", { card_id: "c1", deck_id: "d", due: now + 99999999, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: now });
    const q = buildSmartQueue(cards, states, now, 3);
    expect(q.map((c) => c.id)).toEqual(["c0", "c2", "c3", "c4"]);
    expect(shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("統計", () => {
  it("1-Var Stats（TI-84 四分位數）", () => {
    const r = oneVar([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.mean).toBe(5);
    expect(r.q1).toBe(2.5);
    expect(r.q3).toBe(7.5);
    expect(r.sx).toBeCloseTo(2.7386, 3);
    expect(r.sigmaX).toBeCloseTo(2.5820, 3);
    const f = oneVar([1, 2, 3], [2, 1, 1]);
    expect(f.n).toBe(4);
    expect(f.modes).toEqual([1]);
    expect(oneVar([1, 2, 3, 4, 100]).outliers).toEqual([]); // TI 法：Q3=52，100 未超過上界
    expect(oneVar([1, 2, 3, 4, 5, 6, 7, 100]).outliers).toEqual([100]);
  });

  it("2-Var 與回歸", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [2.1, 3.9, 6.2, 7.8, 10.1];
    expect(twoVar(xs, ys).r).toBeCloseTo(0.9989, 3);
    const lin = regression(xs, ys, "linear");
    expect(lin.coefficients.a).toBeCloseTo(1.99, 2);
    expect(lin.coefficients.b).toBeCloseTo(0.05, 2);
    const quad = regression([0, 1, 2, 3], [1, 2, 5, 10], "quadratic");
    expect(quad.coefficients.a).toBeCloseTo(1);
    expect(quad.coefficients.c).toBeCloseTo(1);
    expect(quad.r2).toBeCloseTo(1);
    const exp = regression([0, 1, 2, 3], [3, 6, 12, 24], "exponential");
    expect(exp.coefficients.a).toBeCloseTo(3);
    expect(exp.coefficients.b).toBeCloseTo(2);
    expect(exp.predict(4)).toBeCloseTo(48);
  });

  it("解析貼上資料", () => {
    expect(parseColumns("x,y\n1,2\n3\t4")).toEqual([[1, 3], [2, 4]]);
  });
});
