import { affectsSchedule, applyRating, studyDayStart, State, type ReviewSettings, type ReviewStateRow } from "./srs";

export interface ReviewQueueSummary {
  due: number; learning: number; new: number; new_today: number; new_remaining: number;
  deferred_new: number; next_due: number | null; suggested_new_per_day: number | null;
}
export interface ReviewQueue {
  ids: string[];
  states: Record<string, ReviewStateRow>;
  settings: ReviewSettings;
  summary: ReviewQueueSummary;
}
export interface PendingReview {
  card_id: string; rating: 1 | 2 | 3 | 4; mode: string; reviewed_at: number;
}

/** Reconcile durable, unsent answers before offering a new session on the same device. */
export function reconcileReviewQueue(queue: ReviewQueue, pending: PendingReview[], deckId: string, now: number, mode = "review"): ReviewQueue {
  const states = { ...queue.states };
  const introduced = new Set<string>();
  const touched = new Set<string>();
  for (const item of [...pending].sort((a, b) => a.reviewed_at - b.reviewed_at)) {
    if (!affectsSchedule(item.mode) || (states[item.card_id]?.last_review ?? 0) >= item.reviewed_at) continue;
    if ((!states[item.card_id] || states[item.card_id].state === State.New) && item.reviewed_at >= studyDayStart(now)) introduced.add(item.card_id);
    touched.add(item.card_id);
    states[item.card_id] = applyRating(states[item.card_id], item.rating, new Date(item.reviewed_at), { cardId: item.card_id, deckId }, queue.settings.target_date, queue.settings.request_retention);
  }
  let fresh = 0;
  const ids = queue.ids.filter((id) => {
    if (mode === "shuffle" || mode === "all") return true;
    if (states[id] && states[id].state !== State.New) return (mode === "weak" && !touched.has(id)) || states[id].due <= now;
    return ++fresh <= Math.max(0, queue.summary.new_remaining - introduced.size);
  });
  const future = Object.values(states).filter((s) => s.due > now).map((s) => s.due);
  return { ...queue, states, ids, summary: { ...queue.summary,
    new_today: queue.summary.new_today + introduced.size,
    new_remaining: Math.max(0, queue.summary.new_remaining - introduced.size),
    next_due: future.length ? Math.min(...future) : queue.summary.next_due,
    new: ids.filter((id) => !states[id] || states[id].state === State.New).length,
  } };
}

export interface ReviewSession {
  pending: { id: string; due: number; repeat: boolean }[];
  seen: string[];
  total: number;
  ratings: [number, number, number, number];
}

export function createReviewSession(ids: string[], limit: number, now: number): ReviewSession {
  const selected = [...new Set(ids)].slice(0, limit);
  return { pending: selected.map((id) => ({ id, due: now, repeat: false })), seen: [], total: selected.length, ratings: [0, 0, 0, 0] };
}

export function nextReview(session: ReviewSession, now: number) {
  return session.pending.find((p) => p.repeat && p.due <= now) ?? session.pending.find((p) => p.due <= now);
}

export function answerReview(session: ReviewSession, id: string, rating: 1 | 2 | 3 | 4, next?: ReviewStateRow): ReviewSession {
  if (!session.pending.some((p) => p.id === id)) return session;
  const pending = session.pending.filter((p) => p.id !== id);
  if (next && (next.state === State.Learning || next.state === State.Relearning)) pending.push({ id, due: next.due, repeat: true });
  const ratings = [...session.ratings] as ReviewSession["ratings"];
  ratings[rating - 1]++;
  return { ...session, pending, ratings, seen: session.seen.includes(id) ? session.seen : [...session.seen, id] };
}

export function reviewShortcut(event: { key: string; repeat: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }, flipped: boolean, practice: boolean): "reveal" | 1 | 2 | 3 | 4 | null {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (!flipped && (event.key === " " || event.key === "Enter")) return "reveal";
  if (!flipped) return null;
  if (practice) {
    if (event.key === "1" || event.key === "ArrowLeft") return 1;
    if (["2", "ArrowRight"].includes(event.key)) return 3;
    return null;
  }
  return /^[1-4]$/.test(event.key) ? Number(event.key) as 1 | 2 | 3 | 4 : null;
}
