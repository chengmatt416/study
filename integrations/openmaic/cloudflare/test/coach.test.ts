import { beforeEach, expect, test, vi } from 'vitest';
import { allowCoachToAskAgain, coachShouldAsk, dismissStudyCoach, parseStudyCoachNote, remarkText, resetStudyCoach, showStudyCoach, studyCoachState, studyRemark } from '@/lib/study-classroom/coach';

beforeEach(() => resetStudyCoach());
const miss = (misconception?: string, concept = 'c1') => ({ concept, kind: 'question', correct: false, misconception });

test('asks the server only when something repeats, and once per pattern', () => {
  expect(coachShouldAsk(miss('forgot-delta-t'))).toBe(false);
  expect(coachShouldAsk({ concept: 'c1', kind: 'question', correct: true })).toBe(false);
  expect(coachShouldAsk(miss('forgot-delta-t'))).toBe(true);
  // A third miss of the same kind does not ask again; the fourth is the learner still stuck after the explanation.
  expect(coachShouldAsk(miss('forgot-delta-t'))).toBe(false);
  expect(coachShouldAsk(miss('forgot-delta-t'))).toBe(true);
  expect(coachShouldAsk(miss('forgot-delta-t'))).toBe(false);
  // Another chapter counts on its own.
  expect(coachShouldAsk(miss('forgot-delta-t', 'c2'))).toBe(false);
});

test('notices broad trouble: misses without a named misconception, hints, retries, "I do not know", a failed checkpoint', () => {
  expect([miss(), miss(), miss()].map(coachShouldAsk)).toEqual([false, false, true]);
  resetStudyCoach();
  expect(Array.from({ length: 5 }, () => coachShouldAsk({ concept: 'c1', kind: 'hint' }))).toEqual([false, false, false, true, false]);
  resetStudyCoach();
  expect(Array.from({ length: 2 }, () => coachShouldAsk({ concept: 'c1', kind: 'unsure' }))).toEqual([false, true]);
  resetStudyCoach();
  expect(coachShouldAsk({ concept: 'c1', kind: 'checkpoint', correct: true })).toBe(false);
  expect(coachShouldAsk({ concept: 'c1', kind: 'checkpoint', correct: false })).toBe(true);
  expect(coachShouldAsk({ concept: 'c1', kind: 'checkpoint', correct: false })).toBe(true);
  expect(coachShouldAsk({ concept: 'c1', kind: 'checkpoint', correct: false })).toBe(false);
  expect(coachShouldAsk({ concept: 'c1', kind: 'step' })).toBe(false);
});

test('accepts only a well-formed note from the server', () => {
  const note = { key: 'c1|m:x', chapter: 'c1', kind: 'misconception', headline: 'ΔT 是變化量', explanation: '末溫減初溫才是 ΔT。', check: '', route: 'teleport', source: 'model' };
  expect(parseStudyCoachNote(note)).toEqual({ ...note, check: null, route: 'continue' });
  expect(parseStudyCoachNote({ ...note, route: 'review', source: 'rules' })).toMatchObject({ route: 'review', source: 'rules' });
  for (const bad of [null, {}, { ...note, headline: '' }, { ...note, kind: 'other' }, { ...note, explanation: 3 }]) expect(parseStudyCoachNote(bad)).toBeNull();
});

test('writes one remark for a burst of answers, takes turns between lines, and always marks a finished page', () => {
  vi.useFakeTimers();
  try {
    expect(remarkText('good', 0)).not.toBe(remarkText('good', 1));
    expect(remarkText('good', 4)).toBe(remarkText('good', 0));
    studyRemark('good', 10_000);
    const first = studyCoachState().remark!;
    expect(first).toMatchObject({ tone: 'good', text: remarkText('good', 0) });
    // Answers checked right after one another do not pile remarks up.
    studyRemark('good', 10_500); studyRemark('retry', 11_000);
    expect(studyCoachState().remark).toBe(first);
    // Finishing the page is always marked, and the next praise uses a different line.
    studyRemark('done', 11_200);
    expect(studyCoachState().remark).toMatchObject({ tone: 'done' });
    studyRemark('good', 20_000);
    expect(studyCoachState().remark).toMatchObject({ tone: 'good', text: remarkText('good', 1) });
    // A remark clears itself.
    vi.advanceTimersByTime(3000);
    expect(studyCoachState().remark).toBeNull();
  } finally { vi.useRealTimers(); }
});

test('shows a note once and forgets it when dismissed, telling the server', () => {
  const fetchMock = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', fetchMock);
  try {
    const note = parseStudyCoachNote({ key: 'c1|m:x', chapter: 'c1', kind: 'misconception', headline: 'ΔT 是變化量', explanation: '末溫減初溫才是 ΔT。', route: 'review', source: 'model' })!;
    showStudyCoach(note); showStudyCoach({ ...note });
    expect(studyCoachState().note).toBe(note);
    dismissStudyCoach();
    expect(studyCoachState().note).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ key: 'c1|m:x' });
    dismissStudyCoach();
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

test('asks once more about a pattern after the learner turns classroom AI on', () => {
  expect([miss('unit-mix'), miss('unit-mix'), miss('unit-mix')].map(coachShouldAsk)).toEqual([false, true, false]);
  allowCoachToAskAgain();
  // The next miss of the same kind asks again, this time for the explanation.
  expect(coachShouldAsk(miss('unit-mix'))).toBe(true);
});
