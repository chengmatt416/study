import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./helpers/d1";
import { callApi } from "../src/worker/mcp/internal";
import { submitReviews } from "../src/worker/routes/decks";

const user = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
const at = Date.parse("2026-10-30T08:00:00Z");
describe("字卡排程 API", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => callApi<T>(env, { waitUntil: () => undefined } as ExecutionContext, user, method, path, body);
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(at);
    fixture = testDatabase(); env = { DB: fixture.DB } as Env;
    fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1)");
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('member','member@test.example',1)");
    fixture.db.exec("INSERT INTO decks(id,title,created_at,updated_at) VALUES ('deck','Deck',1,1)");
    for (let i = 0; i < 6; i++) fixture.db.prepare("INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES (?,'deck',?,'Q','A',1,1)").run(`card${i}`, i);
  });
  afterEach(() => { fixture.db.close(); vi.useRealTimers(); });
  const review = (id: string, card = "card0", time = at - 1000, mode = "smart") => ({ id, card_id: card, rating: 3, mode, reviewed_at: time });

  it("新卡重複評分後仍計入今日額度，瀏覽與隨機練習不消耗額度", async () => {
    await api("PUT", "/api/decks/deck/settings", { new_per_day: 1 });
    await submitReviews(env, user.id, [review("first-review", "card0", at - 60000), review("next-review", "card0", at - 1000), review("browse-review", "card1", at - 1000, "all"), review("shuffle-review", "card2", at - 1000, "shuffle")]);
    const queue = await api<{ ids: string[]; summary: { new_today: number; new: number } }>("GET", "/api/decks/deck/queue");
    expect(queue.summary).toMatchObject({ new_today: 1, new: 0 });
    expect(queue.ids).not.toContain("card3");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM review_state").get()).toMatchObject({ n: 1 });
  });
  it("新卡額度以首次遇見日期計算，既有卡今天複習不算新卡", async () => {
    await submitReviews(env, user.id, [review("yesterday-review", "card0", at - 86400000), review("today-review", "card0", at - 1000)]);
    expect(await api("GET", "/api/decks/deck/queue")).toHaveProperty("summary.new_today", 0);
  });
  it("保留舊版依序瀏覽的排程歷史，不把舊卡當成今天首次學習", async () => {
    fixture.db.prepare("INSERT INTO review_log(id,user_id,card_id,rating,mode,reviewed_at) VALUES ('legacy-all-review','member','card0',3,'all',?)").run(at - 86400000);
    await submitReviews(env, user.id, [review("today-smart-review")]);
    expect(await api("GET", "/api/decks/deck/queue")).toHaveProperty("summary.new_today", 0);
  });
  it("重送不重複排程，較舊的離線紀錄不倒退記憶狀態", async () => {
    const item = review("latest-review");
    const first = await submitReviews(env, user.id, [item]);
    await submitReviews(env, user.id, [item]);
    await submitReviews(env, user.id, [review("older-review", "card0", at - 60000)]);
    expect(fixture.db.prepare("SELECT reps,last_review,due FROM review_state WHERE card_id='card0'").get()).toMatchObject({ reps: 1, last_review: item.reviewed_at, due: first.card0.due });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM review_log").get()).toMatchObject({ n: 2 });
  });
  it("同時來自兩個分頁的評分會重讀狀態，保留兩次記憶更新", async () => {
    const originalBatch = fixture.DB.batch;
    let writes = Promise.resolve<unknown>(undefined);
    env.DB = { ...fixture.DB, batch: (statements: Parameters<typeof originalBatch>[0]) => {
      const result = writes.then(() => originalBatch(statements));
      writes = result;
      return result;
    } } as D1Database;
    await Promise.all([
      submitReviews(env, user.id, [review("tab-one-review", "card0", at - 2000)]),
      submitReviews(env, user.id, [review("tab-two-review", "card0", at - 1000)]),
    ]);
    expect(fixture.db.prepare("SELECT reps,last_review FROM review_state").get()).toMatchObject({ reps: 2, last_review: at - 1000 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM review_log").get()).toMatchObject({ n: 2 });
  });
  it("弱項佇列排除已刪除卡片", async () => {
    await submitReviews(env, user.id, [review("deleted-review")]);
    fixture.db.exec("UPDATE cards SET deleted_at=1 WHERE id='card0'");
    expect(await api("GET", "/api/decks/deck/queue?mode=weak")).toHaveProperty("ids", []);
  });
  it("設定可調記憶率，部分更新保留其他值，拒絕不合理日期與數值", async () => {
    await api("PUT", "/api/decks/deck/settings", { request_retention: 0.95, new_per_day: 10, target_date: "2026-11-02" });
    await api("PUT", "/api/decks/deck/settings", { new_per_day: 7 });
    expect(await api("GET", "/api/decks/deck/settings")).toMatchObject({ request_retention: 0.95, new_per_day: 7, target_date: "2026-11-02" });
    for (const invalid of [{ new_per_day: -1 }, { new_per_day: 1.5 }, { target_date: "2026-02-30" }, { request_retention: 0.99 }]) await expect(api("PUT", "/api/decks/deck/settings", invalid)).rejects.toMatchObject({ status: 400 });
  });
  it("拒絕無效時間與模式，且不寫入任何排程", async () => {
    for (const invalid of [{ ...review("bad-time-review"), reviewed_at: -1 }, { ...review("bad-mode-review"), mode: "unknown" }]) await expect(submitReviews(env, user.id, [invalid])).rejects.toMatchObject({ status: 400 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM review_log").get()).toMatchObject({ n: 0 });
  });
});
