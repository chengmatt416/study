// 字卡：匯入（NotebookLM / 貼上 / CSV / JSON）、同步、編修（含原版比對）、FSRS 複習。
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/types";
import { resolveCreateVisibility, resolveVisibilityChange } from "../lib/access";
import type { Visibility } from "../../shared/visibility";
import { requireAdmin } from "../lib/auth";
import { bad, now, readJson, sha256Hex, str, uid } from "../lib/util";
import { audit } from "../lib/audit";
import { assertNotInChapter } from "../lib/chapter-visibility";
import {
  fetchNotebookLMDeck,
  NotebookLMError,
  parseCsvCards,
  parsePastedCards,
  type ParsedCard,
} from "../../shared/notebooklm";
import { affectsSchedule, applyRating, buildSmartQueue, DEFAULT_REVIEW_SETTINGS, retrievability, shuffle, studyDayStart, State, type ReviewSettings, type ReviewStateRow } from "../../shared/srs";
import type { Grade } from "ts-fsrs";

import { vocabularyPlanSchema } from "../../shared/vocabulary";
const decks = new Hono<AppEnv>();

interface CardRow {
  id: string;
  deck_id: string;
  ord: number;
  front: string;
  back: string;
  baseline_front: string | null;
  baseline_back: string | null;
  source_key: string | null;
  updated_at: number;
  deleted_at: number | null;
}

const MAX_CARDS = 2000;
async function acceptPrivateCard(env: Env, cardId: string) {
  await env.DB.prepare("UPDATE cards SET baseline_front=front,baseline_back=back WHERE id=? AND EXISTS(SELECT 1 FROM decks d WHERE d.id=cards.deck_id AND d.visibility='private')").bind(cardId).run();
}


async function cardKey(front: string) {
  return (await sha256Hex(front.normalize("NFKC").trim().toLowerCase())).slice(0, 24);
}

decks.get("/", async (c) => {
  const userId = c.get("user").id;
  const t = now();
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.title, d.subject_id, d.description, d.source_type, d.last_synced_at, d.updated_at, d.visibility, d.created_by,
            (SELECT COUNT(*) FROM cards k WHERE k.deck_id = d.id AND k.deleted_at IS NULL) AS total,
            (SELECT COUNT(*) FROM review_state r JOIN cards k ON k.id = r.card_id AND k.deleted_at IS NULL WHERE r.deck_id = d.id AND r.user_id = ? AND r.due <= ?) AS due,
            (SELECT COUNT(*) FROM cards k WHERE k.deck_id = d.id AND k.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM review_state r WHERE r.card_id = k.id AND r.user_id = ?)) AS new_count,
            (SELECT COUNT(*) FROM cards k WHERE k.deck_id = d.id AND k.deleted_at IS NULL AND (k.baseline_front IS NULL OR k.baseline_front != k.front OR k.baseline_back != k.back)) AS changed
       FROM decks d WHERE NOT EXISTS (SELECT 1 FROM content_organization o WHERE o.user_id=? AND o.content_type='deck' AND o.content_id=d.id AND o.archived_at IS NOT NULL) ORDER BY d.subject_id, d.title`,
  )
    .bind(userId, t, userId, userId)
    .all();
  return c.json({ decks: results });
});

decks.post("/", async (c) => {
  const b = await readJson<{ title: string; subject_id?: string; description?: string; visibility?: Visibility }>(c.req.raw);
  const visibility = resolveCreateVisibility(c, b.visibility);
  const id = uid();
  const t = now();
  await c.env.DB.prepare("INSERT INTO decks (id, subject_id, title, description, source_type, created_by, created_at, updated_at, visibility) VALUES (?,?,?,?, 'manual', ?,?,?,?)")
    .bind(id, b.subject_id || null, str(b.title, "title", { max: 200 }), (b.description ?? "").slice(0, 1000) || null, c.get("user").id, t, t, visibility)
    .run();
  return c.json({ id, visibility });
});

decks.get("/:id", async (c) => {
  const deck = await c.env.DB.prepare("SELECT * FROM decks WHERE id = ?").bind(c.req.param("id")).first();
  if (!deck) bad("找不到字卡組", 404);
  const includeDeleted = c.req.query("deleted") === "1";
  const { results: cards } = await c.env.DB.prepare(
    `SELECT k.id, k.ord, k.front, k.back, k.baseline_front, k.baseline_back, k.updated_at, k.deleted_at, u.name AS updated_by_name,
            r.due, r.state, r.reps, r.lapses, r.stability, r.difficulty, r.last_review
       FROM cards k LEFT JOIN users u ON u.id = k.updated_by
       LEFT JOIN review_state r ON r.card_id = k.id AND r.user_id = ?
      WHERE k.deck_id = ? ${includeDeleted ? "" : "AND k.deleted_at IS NULL"} ORDER BY k.ord`,
  )
    .bind(c.get("user").id, c.req.param("id"))
    .all();
  const settings = await c.env.DB.prepare("SELECT new_per_day, target_date, request_retention FROM deck_settings WHERE user_id = ? AND deck_id = ?")
    .bind(c.get("user").id, c.req.param("id"))
    .first();
  return c.json({ deck, cards, settings: settings ?? DEFAULT_REVIEW_SETTINGS });
});

decks.put("/:id", async (c) => {
  const b = await readJson<{ title?: string; subject_id?: string | null; description?: string; visibility?: Visibility }>(c.req.raw);
  if (b.visibility !== undefined) bad("請使用 PUT /api/decks/:id/visibility 變更可見範圍");
  await c.env.DB.prepare(
    "UPDATE decks SET title = COALESCE(?, title), subject_id = CASE WHEN ? THEN ? ELSE subject_id END, description = COALESCE(?, description), updated_at = ? WHERE id = ?",
  )
    .bind(b.title ? str(b.title, "title", { max: 200 }) : null, b.subject_id !== undefined ? 1 : 0, b.subject_id || null, b.description ?? null, now(), c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

/** 建立者一鍵切換私人 ↔ 共享；改為私人時，目前的卡片內容即為原版。 */
decks.put("/:id/visibility", async (c) => {
  const deck = await c.env.DB.prepare("SELECT visibility,created_by FROM decks WHERE id=?").bind(c.req.param("id")).first<{ visibility: Visibility; created_by: string | null }>();
  if (!deck) bad("找不到字卡牌組", 404);
  const b = await readJson<{ visibility?: unknown }>(c.req.raw);
  const next = resolveVisibilityChange(c, deck, b.visibility);
  // A flashcard deck in a chapter follows the chapter's visibility, so it cannot be changed on its own.
  if (next) await assertNotInChapter(c.env.DB, "deck", c.req.param("id"));
  if (next) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE decks SET visibility = ?, updated_at = ? WHERE id = ?").bind(next, now(), c.req.param("id")),
      c.env.DB.prepare("UPDATE cards SET baseline_front = front, baseline_back = back WHERE deck_id = ? AND deleted_at IS NULL").bind(c.req.param("id")),
    ]);
    await audit(c.env.DB, c.get("user").id, "deck.visibility", "deck", c.req.param("id"), { visibility: next });
  }
  return c.json({ ok: true, visibility: next ?? deck.visibility });
});

/** The chatbot's assessment of which terms matter for the chapter; cards are checked against it. */
decks.put("/:id/vocabulary-plan", async (c) => {
  const deck = await c.env.DB.prepare("SELECT id FROM decks WHERE id=?").bind(c.req.param("id")).first<{ id: string }>();
  if (!deck) bad("找不到字卡組", 404);
  const parsed = vocabularyPlanSchema.safeParse((await readJson<{ plan?: unknown }>(c.req.raw)).plan);
  if (!parsed.success) bad(`vocabulary_plan 格式錯誤：${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；")}`, 422);
  await c.env.DB.prepare("INSERT INTO deck_vocabulary_plans(deck_id,plan_json,created_by,created_at) VALUES (?,?,?,?) ON CONFLICT(deck_id) DO UPDATE SET plan_json=excluded.plan_json,created_by=excluded.created_by,created_at=excluded.created_at")
    .bind(deck.id, JSON.stringify(parsed.data), c.get("user").id, now()).run();
  return c.json({ saved: true, terms: parsed.data.terms.length });
});
decks.get("/:id/vocabulary-plan", async (c) => {
  const row = await c.env.DB.prepare("SELECT plan_json FROM deck_vocabulary_plans WHERE deck_id=?").bind(c.req.param("id")).first<{ plan_json: string }>();
  return c.json({ plan: row ? JSON.parse(row.plan_json) : null });
});

decks.delete("/:id", async (c) => {
  const deck = await c.env.DB.prepare("SELECT visibility,created_by FROM decks WHERE id=?").bind(c.req.param("id")).first<{ visibility: Visibility; created_by: string | null }>();
  if (c.get("user").role !== "admin" && !(deck?.visibility === "private" && deck.created_by === c.get("user").id)) bad("需要管理員或私人內容擁有者權限", 403);
  await c.env.DB.prepare("DELETE FROM decks WHERE id = ?").bind(c.req.param("id")).run();
  if (deck?.visibility !== "private") await audit(c.env.DB, c.get("user").id, "deck.delete", "deck", c.req.param("id"));
  return c.json({ ok: true });
});

// ---------- 匯入 ----------
type ImportSource = { url?: string; text?: string; csv?: string; json?: unknown };

async function parseSource(src: ImportSource): Promise<{ title?: string; cards: ParsedCard[]; sourceType: "notebooklm" | "manual" | "csv" | "json"; meta?: unknown }> {
  if (src.url) {
    try {
      const deck = await fetchNotebookLMDeck(src.url.trim());
      return { title: deck.title, cards: deck.cards, sourceType: "notebooklm", meta: { artifactId: deck.artifactId, topics: deck.topics } };
    } catch (e) {
      if (e instanceof NotebookLMError) bad(`NotebookLM 解析失敗：${e.message}`, e.code === "bad_url" ? 400 : 502, { code: e.code });
      throw e;
    }
  }
  if (src.csv) return { cards: parseCsvCards(src.csv), sourceType: "csv" };
  if (src.text) return { cards: parsePastedCards(src.text), sourceType: "manual" };
  if (src.json) {
    const arr = Array.isArray(src.json) ? src.json : (src.json as { cards?: unknown[] }).cards;
    if (!Array.isArray(arr)) bad("JSON 需為 [{front, back}] 陣列");
    return {
      cards: arr
        .map((x) => ({ front: String((x as ParsedCard).front ?? "").trim(), back: String((x as ParsedCard).back ?? "").trim() }))
        .filter((x) => x.front),
      sourceType: "json",
    };
  }
  bad("請提供 url、text、csv 或 json");
}

interface ImportPlan {
  add: ParsedCard[];
  update: { id: string; front: string; back: string; oldBack: string }[];
  remove: { id: string; front: string }[];
  unchanged: number;
}

async function planImport(env: Env, deckId: string | null, incoming: ParsedCard[]): Promise<ImportPlan> {
  const plan: ImportPlan = { add: [], update: [], remove: [], unchanged: 0 };
  if (!deckId) return { ...plan, add: incoming };
  const { results } = await env.DB.prepare("SELECT * FROM cards WHERE deck_id = ? AND deleted_at IS NULL").bind(deckId).all<CardRow>();
  const byKey = new Map<string, CardRow>();
  for (const r of results) byKey.set(r.source_key ?? (await cardKey(r.front)), r);
  const seen = new Set<string>();
  for (const card of incoming) {
    const key = await cardKey(card.front);
    const existing = byKey.get(key);
    seen.add(key);
    if (!existing) plan.add.push(card);
    else if (existing.back !== card.back) plan.update.push({ id: existing.id, front: card.front, back: card.back, oldBack: existing.back });
    else plan.unchanged++;
  }
  for (const [key, row] of byKey) if (!seen.has(key)) plan.remove.push({ id: row.id, front: row.front });
  return plan;
}

decks.post("/import/preview", async (c) => {
  const b = await readJson<ImportSource & { deck_id?: string }>(c.req.raw);
  const parsed = await parseSource(b);
  if (!parsed.cards.length) bad("沒有解析到任何卡片", 422);
  if (parsed.cards.length > MAX_CARDS) bad(`單組最多 ${MAX_CARDS} 張`, 413);
  const plan = await planImport(c.env, b.deck_id ?? null, parsed.cards);
  return c.json({ title: parsed.title, sourceType: parsed.sourceType, meta: parsed.meta, cards: parsed.cards, plan });
});

async function commitImport(
  env: Env,
  userId: string,
  deckId: string,
  cards: ParsedCard[],
  removeMissing: boolean,
): Promise<ImportPlan> {
  const plan = await planImport(env, deckId, cards);
  const t = now();
  const maxOrd = (await env.DB.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM cards WHERE deck_id = ?").bind(deckId).first<{ m: number }>())?.m ?? 0;
  const stmts: D1PreparedStatement[] = [];
  let ord = maxOrd;
  for (const card of plan.add) {
    ord++;
    // 匯入的卡片即為原版（baseline = 內容）
    stmts.push(
      env.DB.prepare(
        "INSERT INTO cards (id, deck_id, ord, front, back, baseline_front, baseline_back, source_key, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(uid(), deckId, ord, card.front, card.back, card.front, card.back, await cardKey(card.front), userId, t, t),
    );
  }
  for (const u of plan.update) {
    stmts.push(
      env.DB.prepare("UPDATE cards SET back = ?, baseline_back = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(u.back, u.back, userId, t, u.id),
    );
  }
  if (removeMissing) for (const r of plan.remove) stmts.push(env.DB.prepare("UPDATE cards SET deleted_at = ? WHERE id = ?").bind(t, r.id));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return plan;
}

decks.post("/import/commit", async (c) => {
  const b = await readJson<ImportSource & { deck_id?: string; title?: string; subject_id?: string; remove_missing?: boolean; visibility?: Visibility }>(c.req.raw);
  const visibility = b.deck_id ? undefined : resolveCreateVisibility(c, b.visibility);
  const parsed = await parseSource(b);
  if (!parsed.cards.length) bad("沒有解析到任何卡片", 422);
  let deckId = b.deck_id;
  const t = now();
  if (!deckId) {
    deckId = uid();
    await c.env.DB.prepare(
      "INSERT INTO decks (id, subject_id, title, source_type, source_url, source_meta, last_synced_at, created_by, created_at, updated_at, visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(deckId, b.subject_id || null, (b.title || parsed.title || "字卡").slice(0, 200), parsed.sourceType, b.url ?? null, parsed.meta ? JSON.stringify(parsed.meta) : null, t, c.get("user").id, t, t, visibility ?? "shared")
      .run();
  } else if (b.url) {
    await c.env.DB.prepare("UPDATE decks SET source_type = 'notebooklm', source_url = ?, source_meta = ?, last_synced_at = ?, updated_at = ? WHERE id = ?")
      .bind(b.url, parsed.meta ? JSON.stringify(parsed.meta) : null, t, t, deckId)
      .run();
  }
  const plan = await commitImport(c.env, c.get("user").id, deckId, parsed.cards, !!b.remove_missing);
  await audit(c.env.DB, c.get("user").id, "deck.import", "deck", deckId, { source: parsed.sourceType, add: plan.add.length, update: plan.update.length });
  return c.json({ deckId, visibility, added: plan.add.length, updated: plan.update.length, removed: b.remove_missing ? plan.remove.length : 0 });
});

/** 重新從來源連結同步（保留學習紀錄） */
decks.post("/:id/sync", async (c) => {
  const deck = await c.env.DB.prepare("SELECT source_url FROM decks WHERE id = ?").bind(c.req.param("id")).first<{ source_url: string | null }>();
  if (!deck?.source_url) bad("此字卡組沒有來源連結", 409);
  const { remove_missing } = await readJson<{ remove_missing?: boolean }>(c.req.raw).catch(() => ({ remove_missing: false }));
  const parsed = await parseSource({ url: deck.source_url });
  const plan = await commitImport(c.env, c.get("user").id, c.req.param("id"), parsed.cards, !!remove_missing);
  await c.env.DB.prepare("UPDATE decks SET last_synced_at = ? WHERE id = ?").bind(now(), c.req.param("id")).run();
  return c.json({ added: plan.add.length, updated: plan.update.length, removed: remove_missing ? plan.remove.length : 0, unchanged: plan.unchanged });
});

// ---------- 卡片編修 ----------
decks.post("/:id/cards", async (c) => {
  const b = await readJson<{ front: string; back: string }>(c.req.raw);
  const front = str(b.front, "front", { max: 5000 });
  const back = str(b.back ?? "", "back", { max: 10000, optional: true });
  const t = now();
  const ord = ((await c.env.DB.prepare("SELECT COALESCE(MAX(ord), 0) AS m FROM cards WHERE deck_id = ?").bind(c.req.param("id")).first<{ m: number }>())?.m ?? 0) + 1;
  const id = uid();
  // 新卡沒有原版（baseline 為 NULL）→ 對其他人以「新增」螢光顯示
  await c.env.DB.prepare("INSERT INTO cards (id, deck_id, ord, front, back, source_key, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(id, c.req.param("id"), ord, front, back, await cardKey(front), c.get("user").id, t, t)
    .run();
  await c.env.DB.prepare("INSERT INTO card_revisions (id, card_id, front, back, author_id, created_at) VALUES (?,?,?,?,?,?)").bind(uid(), id, front, back, c.get("user").id, t).run();
  await acceptPrivateCard(c.env, id);
  return c.json({ id });
});

decks.put("/cards/:cardId", async (c) => {
  const b = await readJson<{ front: string; back: string }>(c.req.raw);
  const front = str(b.front, "front", { max: 5000 });
  const back = str(b.back ?? "", "back", { max: 10000, optional: true });
  const t = now();
  const res = await c.env.DB.prepare("UPDATE cards SET front = ?, back = ?, updated_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(front, back, c.get("user").id, t, c.req.param("cardId"))
    .run();
  if (!res.meta.changes) bad("找不到卡片", 404);
  await c.env.DB.prepare("INSERT INTO card_revisions (id, card_id, front, back, author_id, created_at) VALUES (?,?,?,?,?,?)").bind(uid(), c.req.param("cardId"), front, back, c.get("user").id, t).run();
  await acceptPrivateCard(c.env, c.req.param("cardId"));
  return c.json({ ok: true });
});

decks.delete("/cards/:cardId", async (c) => {
  await c.env.DB.prepare("UPDATE cards SET deleted_at = ?, updated_by = ? WHERE id = ?").bind(now(), c.get("user").id, c.req.param("cardId")).run();
  return c.json({ ok: true });
});

decks.post("/cards/:cardId/restore", async (c) => {
  await c.env.DB.prepare("UPDATE cards SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?").bind(c.get("user").id, now(), c.req.param("cardId")).run();
  return c.json({ ok: true });
});

decks.get("/cards/:cardId/revisions", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT cr.front, cr.back, cr.created_at, u.name AS author_name FROM card_revisions cr LEFT JOIN users u ON u.id = cr.author_id WHERE cr.card_id = ? ORDER BY cr.created_at DESC",
  )
    .bind(c.req.param("cardId"))
    .all();
  return c.json({ revisions: results });
});

/** 管理員：接受所有修訂為新原版（螢光消失） */
decks.post("/:id/baseline", requireAdmin, async (c) => {
  await c.env.DB.prepare("UPDATE cards SET baseline_front = front, baseline_back = back WHERE deck_id = ? AND deleted_at IS NULL").bind(c.req.param("id")).run();
  await audit(c.env.DB, c.get("user").id, "deck.baseline", "deck", c.req.param("id"));
  return c.json({ ok: true });
});

/** 管理員：單張卡回復原版 */
decks.post("/cards/:cardId/revert", requireAdmin, async (c) => {
  await c.env.DB.prepare(
    "UPDATE cards SET front = COALESCE(baseline_front, front), back = COALESCE(baseline_back, back), updated_by = ?, updated_at = ? WHERE id = ?",
  )
    .bind(c.get("user").id, now(), c.req.param("cardId"))
    .run();
  return c.json({ ok: true });
});

// ---------- 複習 ----------
decks.get("/:id/settings", async (c) => {
  const s = await c.env.DB.prepare("SELECT new_per_day, target_date, request_retention FROM deck_settings WHERE user_id = ? AND deck_id = ?").bind(c.get("user").id, c.req.param("id")).first();
  return c.json(s ?? DEFAULT_REVIEW_SETTINGS);
});

const settingsSchema = z.object({
  new_per_day: z.number().int().min(0).max(500).optional(),
  request_retention: z.number().min(0.8).max(0.97).optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "請選擇有效日期").nullable().optional(),
});

decks.put("/:id/settings", async (c) => {
  const parsed = settingsSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) bad("複習設定格式不正確", 400);
  const prev = await c.env.DB.prepare("SELECT new_per_day, target_date, request_retention FROM deck_settings WHERE user_id = ? AND deck_id = ?")
    .bind(c.get("user").id, c.req.param("id")).first<ReviewSettings>();
  const settings = { ...(prev ?? DEFAULT_REVIEW_SETTINGS), ...parsed.data };
  await c.env.DB.prepare(
    "INSERT INTO deck_settings (user_id, deck_id, new_per_day, target_date, request_retention) VALUES (?,?,?,?,?) ON CONFLICT(user_id, deck_id) DO UPDATE SET new_per_day = excluded.new_per_day, target_date = excluded.target_date, request_retention = excluded.request_retention",
  ).bind(c.get("user").id, c.req.param("id"), settings.new_per_day, settings.target_date, settings.request_retention).run();
  return c.json({ ok: true });
});

/** 佇列：smart（FSRS）/ shuffle（全部隨機）/ weak（保留率最低）/ all（依序） */
decks.get("/:id/queue", async (c) => {
  const userId = c.get("user").id;
  const deckId = c.req.param("id");
  const mode = c.req.query("mode") ?? "smart";
  const t = now();
  const { results: cards } = await c.env.DB.prepare("SELECT id, ord FROM cards WHERE deck_id = ? AND deleted_at IS NULL ORDER BY ord").bind(deckId).all<{ id: string; ord: number }>();
  const { results: states } = await c.env.DB.prepare("SELECT * FROM review_state WHERE user_id = ? AND deck_id = ?").bind(userId, deckId).all<ReviewStateRow>();
  const stateMap = new Map(states.map((s) => [s.card_id, s]));
  const settings = await c.env.DB.prepare("SELECT new_per_day, target_date, request_retention FROM deck_settings WHERE user_id = ? AND deck_id = ?")
    .bind(userId, deckId).first<ReviewSettings>() ?? DEFAULT_REVIEW_SETTINGS;
  // Count first scheduled encounters, not cards whose reps happens to still be one.
  const newToday = (await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT l.card_id FROM review_log l JOIN cards k ON k.id=l.card_id
       WHERE l.user_id=? AND k.deck_id=? AND l.scheduled=1
       GROUP BY l.card_id HAVING MIN(l.reviewed_at) >= ? AND MIN(l.reviewed_at) < ?
     )`,
  ).bind(userId, deckId, studyDayStart(t), studyDayStart(t) + 86400000).first<{ n: number }>())?.n ?? 0;
  const dailyRemaining = Math.max(0, settings.new_per_day - newToday);
  const smart = buildSmartQueue(cards, stateMap, t, dailyRemaining);
  let ids: string[];
  if (mode === "shuffle") ids = shuffle(cards.map((k) => k.id));
  else if (mode === "all") ids = cards.map((k) => k.id);
  else if (mode === "weak") {
    ids = cards.map((k) => stateMap.get(k.id)).filter((s): s is ReviewStateRow => !!s?.last_review)
      .sort((a, b) => retrievability(a, new Date(t)) - retrievability(b, new Date(t)) || b.lapses - a.lapses || a.due - b.due)
      .slice(0, 50).map((s) => s.card_id);
  } else ids = smart.map((q) => q.id);
  const activeStates = cards.flatMap((k) => stateMap.has(k.id) ? [stateMap.get(k.id)!] : []);
  const future = activeStates.filter((s) => s.due > t).map((s) => s.due);
  const newTotal = cards.filter((k) => !stateMap.has(k.id) || stateMap.get(k.id)!.state === State.New).length;
  const target = settings.target_date ? Date.parse(`${settings.target_date}T00:00:00+08:00`) : 0;
  return c.json({ mode, ids, states: Object.fromEntries(activeStates.map((s) => [s.card_id, s])), settings,
    summary: {
      due: activeStates.filter((s) => s.due <= t).length,
      learning: activeStates.filter((s) => s.due <= t && (s.state === State.Learning || s.state === State.Relearning)).length,
      new: smart.filter((s) => s.isNew).length, new_today: newToday, new_remaining: dailyRemaining,
      deferred_new: Math.max(0, Math.min(newTotal, dailyRemaining) - smart.filter((s) => s.isNew).length),
      next_due: future.length ? Math.min(...future) : null,
      suggested_new_per_day: target > t ? Math.ceil(newTotal / Math.max(1, Math.ceil((target - t) / 86400000))) : null,
    },
  });
});

export default decks;

/** 批次寫入複習紀錄（離線佇列重送：以 review id 去重） */
export async function submitReviews(
  env: Env,
  userId: string,
  items: { id: string; card_id: string; rating: number; mode: string; reviewed_at: number; duration_ms?: number }[],
) {
  if (!Array.isArray(items) || items.length > 500) bad("一次最多 500 筆");
  const parsed = z.array(z.object({
    id: z.string().regex(/^[\w-]{8,64}$/), card_id: z.string().min(1).max(100),
    rating: z.number().int().min(1).max(4), mode: z.enum(["smart", "review", "weak", "all", "shuffle"]),
    reviewed_at: z.number().finite().int().min(1), duration_ms: z.number().finite().int().min(0).max(86400000).optional(),
  })).safeParse(items);
  if (!parsed.success) bad("複習紀錄格式不正確", 400);
  const sorted = [...parsed.data].sort((a, b) => a.reviewed_at - b.reviewed_at);
  const updated: Record<string, ReviewStateRow> = {};
  for (const it of sorted) {
    const card = await env.DB.prepare("SELECT k.deck_id, s.target_date, s.request_retention FROM cards k LEFT JOIN deck_settings s ON s.deck_id = k.deck_id AND s.user_id = ? WHERE k.id = ? AND k.deleted_at IS NULL")
      .bind(userId, it.card_id).first<{ deck_id: string; target_date: string | null; request_retention: number | null }>();
    if (!card) continue;
    const at = new Date(Math.min(it.reviewed_at, now()));
    const logValues = [it.id, userId, it.card_id, it.rating, it.mode, at.getTime(), it.duration_ms ?? null];
    if (!affectsSchedule(it.mode)) {
      await env.DB.prepare("INSERT OR IGNORE INTO review_log (id, user_id, card_id, rating, mode, reviewed_at, duration_ms, scheduled) VALUES (?,?,?,?,?,?,?,0)").bind(...logValues).run();
      continue;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await env.DB.prepare("SELECT 1 FROM review_log WHERE id=?").bind(it.id).first()) break;
      const prev = await env.DB.prepare("SELECT * FROM review_state WHERE user_id=? AND card_id=?").bind(userId, it.card_id).first<ReviewStateRow>();
      // Keep historical offline encounters, without rewinding a newer memory state.
      if (prev?.last_review && at.getTime() <= prev.last_review) {
        await env.DB.prepare("INSERT OR IGNORE INTO review_log (id, user_id, card_id, rating, mode, reviewed_at, duration_ms) VALUES (?,?,?,?,?,?,?)").bind(...logValues).run();
        updated[it.card_id] = prev;
        break;
      }
      const next = applyRating(prev, it.rating as Grade, at, { cardId: it.card_id, deckId: card.deck_id }, card.target_date, card.request_retention ?? 0.9);
      await env.DB.batch([
        // Both writes succeed together only if the snapshot still matches. Another tab may have answered while this request was in flight.
        env.DB.prepare(`INSERT OR IGNORE INTO review_log (id,user_id,card_id,rating,mode,reviewed_at,duration_ms)
          SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT reps FROM review_state WHERE user_id=? AND card_id=?),0)=?
            AND COALESCE((SELECT last_review FROM review_state WHERE user_id=? AND card_id=?),0)=?`)
          .bind(...logValues, userId, it.card_id, prev?.reps ?? 0, userId, it.card_id, prev?.last_review ?? 0),
        env.DB.prepare(`INSERT INTO review_state (user_id,card_id,deck_id,due,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,state,last_review)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1
          ON CONFLICT(user_id,card_id) DO UPDATE SET due=excluded.due,stability=excluded.stability,difficulty=excluded.difficulty,
            elapsed_days=excluded.elapsed_days,scheduled_days=excluded.scheduled_days,learning_steps=excluded.learning_steps,
            reps=excluded.reps,lapses=excluded.lapses,state=excluded.state,last_review=excluded.last_review`)
          .bind(userId, it.card_id, next.deck_id, next.due, next.stability, next.difficulty, next.elapsed_days, next.scheduled_days, next.learning_steps, next.reps, next.lapses, next.state, next.last_review),
      ]);
      if (await env.DB.prepare("SELECT 1 FROM review_log WHERE id=?").bind(it.id).first()) {
        updated[it.card_id] = await env.DB.prepare("SELECT * FROM review_state WHERE user_id=? AND card_id=?").bind(userId, it.card_id).first<ReviewStateRow>() ?? next;
        break;
      }
      if (attempt === 2) bad("複習狀態已更新，請稍後重試；本機紀錄會保留", 409);
    }
  }
  return updated;
}
