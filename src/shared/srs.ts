// FSRS 間隔複習（ts-fsrs 包裝）：D1 列 ↔ Card 轉換、排程、今日佇列。
import { fsrs, createEmptyCard, generatorParameters, Rating, State, StrategyMode, type Card, type Grade } from "ts-fsrs";

export { Rating, State };

export interface ReviewStateRow {
  card_id: string;
  deck_id: string;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export interface ReviewSettings {
  new_per_day: number;
  target_date: string | null;
  request_retention: number;
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { new_per_day: 20, target_date: null, request_retention: 0.9 };
const DAY = 86400000;
const schedulerFor = (retention = 0.9, cardId = "") => fsrs(generatorParameters({
  request_retention: Number.isFinite(retention) ? Math.max(0.8, Math.min(0.97, retention)) : 0.9,
  enable_fuzz: true, maximum_interval: 365,
})).useStrategy(StrategyMode.SEED, function () { return `${cardId}:${this.current.reps}`; });
const scheduler = schedulerFor();

export function affectsSchedule(mode: string) {
  return mode === "smart" || mode === "review" || mode === "weak";
}

/** A fixed UTC+8 study day keeps quotas and date-only exam targets consistent across devices. */
export function studyDayStart(at: number): number {
  return Math.floor((at + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
}

function capAtTarget(due: Date, at: Date, targetDate?: string | null): Date {
  if (!targetDate) return due;
  const target = Date.parse(`${targetDate}T00:00:00+08:00`);
  if (!Number.isFinite(target) || target <= at.getTime()) return due;
  const cap = Math.min(target, Math.max(at.getTime() + 3600000, target - DAY));
  return due.getTime() > cap ? new Date(cap) : due;
}

export function rowToCard(row: ReviewStateRow | null | undefined, now = new Date()): Card {
  if (!row) return createEmptyCard(now);
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export function cardToRow(card: Card, cardId: string, deckId: string): ReviewStateRow {
  return {
    card_id: cardId,
    deck_id: deckId,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

/**
 * 套用一次評分。targetDate（考試日）：若排程超過考試日，提前到考前一天，
 * 確保每張卡在考前至少再看一次（考前衝刺）。
 */
export function applyRating(
  row: ReviewStateRow | null | undefined,
  rating: Grade,
  at: Date,
  ids: { cardId: string; deckId: string },
  targetDate?: string | null,
  retention = 0.9,
): ReviewStateRow {
  const { card } = schedulerFor(retention, ids.cardId).next(rowToCard(row, at), at, rating);
  card.due = capAtTarget(card.due, at, targetDate);
  return cardToRow(card, ids.cardId, ids.deckId);
}

/** 預覽四個按鈕的下次間隔（顯示在按鈕上）。 */
export function previewIntervals(row: ReviewStateRow | null | undefined, now = new Date(), targetDate?: string | null, retention = 0.9, cardId = row?.card_id ?? ""): Record<"again" | "hard" | "good" | "easy", string> {
  const p = schedulerFor(retention, cardId).repeat(rowToCard(row, now), now);
  const fmt = (d: Date) => formatInterval(capAtTarget(d, now, targetDate).getTime() - now.getTime());
  return {
    again: fmt(p[Rating.Again].card.due),
    hard: fmt(p[Rating.Hard].card.due),
    good: fmt(p[Rating.Good].card.due),
    easy: fmt(p[Rating.Easy].card.due),
  };
}

export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} 分`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小時`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} 天`;
  const m = Math.round(d / 30);
  if (m < 12) return `${m} 個月`;
  return `${Math.round(d / 365)} 年`;
}

export interface QueueCard {
  id: string;
  isNew: boolean;
  due: number;
}

/** Prioritize due learning steps, then recall risk; leave room for new material only below the review workload budget. */
export function buildSmartQueue(
  cards: { id: string; ord: number }[],
  states: Map<string, ReviewStateRow>,
  now: number,
  newLimit: number,
): QueueCard[] {
  const due: QueueCard[] = [];
  const fresh: QueueCard[] = [];
  for (const c of [...cards].sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))) {
    const st = states.get(c.id);
    if (!st || st.state === State.New) fresh.push({ id: c.id, isNew: true, due: now });
    else if (st.due <= now) due.push({ id: c.id, isNew: false, due: st.due });
  }
  const risk = new Map(due.map((c) => [c.id, retrievability(states.get(c.id)!, new Date(now))]));
  due.sort((a, b) => {
    const sa = states.get(a.id)!;
    const sb = states.get(b.id)!;
    const learning = (s: ReviewStateRow) => s.state === State.Learning || s.state === State.Relearning;
    return Number(learning(sb)) - Number(learning(sa))
      || risk.get(a.id)! - risk.get(b.id)!
      || sb.lapses - sa.lapses || a.due - b.due || a.id.localeCompare(b.id);
  });
  const news = fresh.slice(0, Math.max(0, Math.min(Math.trunc(newLimit) || 0, 40 - due.length)));
  // 每 4 張複習卡插 1 張新卡
  const out: QueueCard[] = [];
  let ni = 0;
  for (let i = 0; i < due.length; i++) {
    out.push(due[i]);
    if ((i + 1) % 4 === 0 && ni < news.length) out.push(news[ni++]);
  }
  while (ni < news.length) out.push(news[ni++]);
  return out;
}

/** Fisher–Yates 洗牌 */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 目前記憶保留率（0–1），用於「錯卡加強」排序。 */
export function retrievability(row: ReviewStateRow, now = new Date()): number {
  if (!row.last_review) return 0;
  return scheduler.get_retrievability(rowToCard(row), now, false) as number;
}
