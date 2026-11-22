// The learning coach in the classroom: when to ask the server about a learner who keeps getting something wrong, the note
// it sends back, and the short remarks on answers. Spec: docs/adaptive-learning.md ("學習教練").
// The server decides what the learner is stuck on (src/shared/learning-coach.ts); the counts here only keep the classroom
// from asking when nothing has repeated.
import { useSyncExternalStore } from 'react';

export type StudyCoachRoute = 'continue' | 'review' | 'remedial';
export interface StudyCoachNote { key: string; chapter: string; kind: 'misconception' | 'checkpoint' | 'struggle'; headline: string; explanation: string; check: string | null; route: StudyCoachRoute; source: 'model' | 'rules'; /** The learner has not turned classroom AI on, so this note could only name the pattern. */ aiOff?: boolean }
export type RemarkTone = 'good' | 'fixed' | 'retry' | 'done';
export interface StudyRemark { id: number; text: string; tone: RemarkTone }
export interface StudyCoachState { note: StudyCoachNote | null; remark: StudyRemark | null }

let state: StudyCoachState = { note: null, remark: null };
const listeners = new Set<() => void>();
const publish = (next: Partial<StudyCoachState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
/** What the classroom is showing now (for code outside React, and tests). */
export const studyCoachState = () => state;
export function useStudyCoach() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => state);
}

// ---- when to ask ----
export interface CoachSignal { concept: string; kind: string; correct?: boolean | null; misconception?: string | null }
interface Tally { wrong: number; hints: number; retries: number; unsure: number; failed: number; misconceptions: Record<string, number> }
const tallies = new Map<string, Tally>(); const asked = new Set<string>();
/** Same thresholds as the server's coachFocus: a misconception twice (and again two repeats later), three misses, four hints or retries, two "I don't know", a failed checkpoint. */
const LIMITS = { misconception: 2, again: 4, wrong: 3, hints: 4, retries: 4, unsure: 2 };

/**
 * Counts one thing the learner did after being taught. Returns true the first time a pattern is reached, which is when
 * the classroom asks the server. Each pattern asks once, so a learner who stays stuck does not cause a request per answer.
 */
export function coachShouldAsk(signal: CoachSignal): boolean {
  const tally = tallies.get(signal.concept) ?? { wrong: 0, hints: 0, retries: 0, unsure: 0, failed: 0, misconceptions: {} };
  tallies.set(signal.concept, tally);
  const once = (key: string) => { const id = `${signal.concept}|${key}`; if (asked.has(id)) return false; asked.add(id); return true; };
  if (signal.kind === 'question' && signal.correct === false) {
    tally.wrong++;
    if (signal.misconception) {
      const count = tally.misconceptions[signal.misconception] = (tally.misconceptions[signal.misconception] ?? 0) + 1;
      if (count >= LIMITS.again) return once(`m:${signal.misconception}#2`);
      if (count >= LIMITS.misconception) return once(`m:${signal.misconception}`);
    }
    return tally.wrong >= LIMITS.wrong && once('struggle');
  }
  if (signal.kind === 'checkpoint' && signal.correct === false) { tally.failed++; return once(`checkpoint${tally.failed >= 2 ? '#2' : ''}`); }
  if (signal.kind === 'hint') return ++tally.hints >= LIMITS.hints && once('struggle');
  if (signal.kind === 'retry') return ++tally.retries >= LIMITS.retries && once('struggle');
  if (signal.kind === 'unsure') return ++tally.unsure >= LIMITS.unsure && once('struggle');
  return false;
}
/** The learner just turned classroom AI on: a pattern that was only pointed at may be asked about once more, now for an explanation. */
export function allowCoachToAskAgain() { asked.clear(); for (const tally of tallies.values()) { tally.misconceptions = Object.fromEntries(Object.entries(tally.misconceptions).map(([id, count]) => [id, Math.min(count, LIMITS.misconception - 1)])); tally.wrong = Math.min(tally.wrong, LIMITS.wrong - 1); } }
/** A new classroom (or a test) starts counting from nothing. */
export function resetStudyCoach() { tallies.clear(); asked.clear(); clearTimeout(remarkTimer); lastRemark = 0; publish({ note: null, remark: null }); }

// ---- the note ----
const NOTE_KINDS = ['misconception', 'checkpoint', 'struggle'], ROUTES = ['continue', 'review', 'remedial'];
/** A note from the server, checked before it is shown. */
export function parseStudyCoachNote(value: unknown): StudyCoachNote | null {
  if (!value || typeof value !== 'object') return null;
  const note = value as Record<string, unknown>;
  const text = (item: unknown, max: number) => typeof item === 'string' && item.trim() ? item.trim().slice(0, max) : null;
  const key = text(note.key, 200), chapter = text(note.chapter, 200), headline = text(note.headline, 60), explanation = text(note.explanation, 800);
  if (!key || !chapter || !headline || !explanation || !NOTE_KINDS.includes(note.kind as string)) return null;
  return { key, chapter, kind: note.kind as StudyCoachNote['kind'], headline, explanation, check: text(note.check, 200), route: ROUTES.includes(note.route as string) ? note.route as StudyCoachRoute : 'continue', source: note.source === 'model' ? 'model' : 'rules' };
}
export function showStudyCoach(note: StudyCoachNote) { if (state.note?.key !== note.key) publish({ note }); }
/** Closes the note and tells the server, so the same note does not come back when the classroom is opened again. */
export function dismissStudyCoach() {
  const key = state.note?.key; if (!key) return;
  publish({ note: null });
  void fetch('/api/openmaic/live/coach/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }), keepalive: true }).catch(() => undefined);
}

// ---- remarks on answers ----
const REMARKS: Record<RemarkTone, string[]> = {
  good: ['答對了！', '很好！', '沒錯！', '就是這樣！'],
  fixed: ['修正得好！', '這次對了！'],
  retry: ['再想想', '差一點', '再看一次題目'],
  done: ['全部完成！', '做得好！'],
};
const REMARK_GAP_MS = 1800, REMARK_SHOWN_MS = 2800;
let remarkTimer: ReturnType<typeof setTimeout> | undefined, lastRemark = 0, remarkId = 0;
const turns: Record<RemarkTone, number> = { good: 0, fixed: 0, retry: 0, done: 0 };
/** The line written for the next remark of this tone; the lines take turns so the same one is not repeated back to back. */
export const remarkText = (tone: RemarkTone, turn: number) => REMARKS[tone][turn % REMARKS[tone].length];
/**
 * Writes a short remark beside the lesson, the way a teacher marks a page. Answers that come quickly one after another
 * get one remark, not a pile; finishing a page always gets its remark.
 */
export function studyRemark(tone: RemarkTone, now = Date.now()) {
  if (tone !== 'done' && now - lastRemark < REMARK_GAP_MS) return;
  lastRemark = now; clearTimeout(remarkTimer);
  publish({ remark: { id: ++remarkId, text: remarkText(tone, turns[tone]++), tone } });
  remarkTimer = setTimeout(() => publish({ remark: null }), REMARK_SHOWN_MS);
}
