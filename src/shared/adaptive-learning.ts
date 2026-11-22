// Adaptive lesson routing. Spec: docs/adaptive-learning.md.
// Pure functions only: the rule router is free and is also the fallback when the model router is off,
// over quota or returns something invalid. The model may only choose among options the lesson already has.
export const SIGNAL_KINDS = ['pretest', 'checkpoint', 'question', 'hint', 'step', 'retry', 'ask', 'unsure', 'module', 'skip', 'skipped'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
/** What a classroom may send. `skip` and `skipped` are written by the server from a route request and its answer. */
export const CLIENT_SIGNAL_KINDS = ['pretest', 'checkpoint', 'question', 'hint', 'step', 'retry', 'ask', 'unsure', 'module'] as const;
export const VARIANTS = ['standard', 'remedial', 'quick', 'enrich'] as const;
export type Variant = (typeof VARIANTS)[number];
export const DETAIL_LEVELS = ['brief', 'standard', 'detailed'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export type Mastery = 'unknown' | 'shaky' | 'mastered';

export const DIFFICULTIES = [1, 2, 3] as const;
/** 1 foundation (prerequisite), 2 core (what the chapter teaches), 3 hard (multi-step, exam trap, transfer). */
export type Difficulty = (typeof DIFFICULTIES)[number];
/** pretest: one per question. checkpoint: one per attempt (correct = passed). question: in-class quiz item. unsure: the learner chose "I don't know" instead of guessing. hint/retry/ask: counted. step: one step of an interactive module (`value` = ms spent). module: a module's summary (`value` = total ms, `ops` = controls the learner touched). skip: the learner asked to skip the chapter. skipped: the router granted that request. `difficulty` tags pretest, question and unsure signals. */
export interface LearnerSignal { concept: string; kind: SignalKind; correct?: boolean | null; misconception?: string | null; value?: number | null; difficulty?: Difficulty | null; ops?: number | null }
export interface LevelTally { right: number; wrong: number }
/**
 * What the pretest says about the learner, from the difficulty of the questions answered:
 * foundation_gap: missed a foundation question; core_gap: foundations fine, missed a core question;
 * hard_gap: foundations and core fine, missed only hard questions; core_ready: everything right but no hard question to prove it;
 * ready: everything right including a hard question (or an untagged course); unknown: no pretest.
 */
export type Readiness = 'unknown' | 'foundation_gap' | 'core_gap' | 'hard_gap' | 'core_ready' | 'ready';
export interface ConceptState {
  concept: string;
  pretest: 'none' | 'passed' | 'partial' | 'failed';
  /** Pretest answers by difficulty. Questions without a tag count as core (2). */
  pretest_levels: { d1: LevelTally; d2: LevelTally; d3: LevelTally };
  /** Pretest questions that carried a difficulty tag. */
  pretest_tagged: number;
  readiness: Readiness;
  checkpoint_attempts: number;
  checkpoint_passed: boolean;
  hints: number;
  retries: number;
  asks: number;
  unsure: number;
  /** "I don't know" on a hard question: expected, so it is kept apart from `unsure` and never makes a chapter shaky. */
  unsure_hard: number;
  wrong_questions: number;
  correct_questions: number;
  misconceptions: Record<string, number>;
  /** Interactive module use: steps taken and the time they took, finished modules with their total time and the controls touched. */
  steps: number;
  step_ms: number;
  module_runs: number;
  module_ms: number;
  controls: number;
  /** The learner asked to skip this chapter, and whether the router granted it. */
  skip_requests: number;
  skipped: boolean;
  mastery: Mastery;
}
export interface ChapterOption { id: string; variants: Variant[]; /** Chapter name, so the model knows what each id teaches. */ title?: string; /** The chapter has a 檢核 scene, so a learner can try to test out of it. */ checkpoint?: boolean }
/** `challenge`: go straight to the chapter's 檢核 to prove it instead of taking the lesson (only for a learner's skip request). */
export interface RouteDecision { next: string | null; variant: Variant; detail: DetailLevel; skip: string[]; focus: string[]; challenge?: boolean; /** Added by the route endpoint: false when `next` still needs its pretest. */ pretested?: boolean }
/** Where the learner is and why the router was asked. `skipRequest` is a chapter the learner asked to skip. */
export interface RouteContext { current?: string | null; trigger?: string; skipRequest?: string | null }

const ID = /^[A-Za-z0-9_.:-]{1,100}$/;
export const MAX_SIGNALS_PER_REQUEST = 50;
export const MAX_ROUTE_CHAPTERS = 40;

export function parseSignals(body: unknown): LearnerSignal[] | string {
  if (!Array.isArray(body) || !body.length || body.length > MAX_SIGNALS_PER_REQUEST) return `signals 必須是 1 到 ${MAX_SIGNALS_PER_REQUEST} 筆的陣列`;
  const signals: LearnerSignal[] = [];
  for (const item of body as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') return '訊號格式錯誤';
    const { concept, kind, correct, misconception, value, difficulty, ops } = item;
    if (typeof concept !== 'string' || !ID.test(concept)) return 'concept 格式錯誤';
    if (!(CLIENT_SIGNAL_KINDS as readonly unknown[]).includes(kind)) return 'kind 不在允許清單內';
    if (correct !== undefined && correct !== null && typeof correct !== 'boolean') return 'correct 必須是布林值';
    if (misconception !== undefined && misconception !== null && (typeof misconception !== 'string' || !ID.test(misconception))) return 'misconception 格式錯誤';
    if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 86400000)) return 'value 必須是 0 到 86400000 的整數';
    if (difficulty !== undefined && difficulty !== null && !DIFFICULTIES.includes(difficulty as Difficulty)) return 'difficulty 必須是 1、2 或 3';
    if (ops !== undefined && ops !== null && (typeof ops !== 'number' || !Number.isSafeInteger(ops) || ops < 0 || ops > 100000)) return 'ops 必須是 0 到 100000 的整數';
    signals.push({ concept, kind: kind as SignalKind, correct: correct as boolean | null | undefined, misconception: misconception as string | null | undefined, value: value as number | null | undefined, difficulty: difficulty as Difficulty | null | undefined, ...(ops === undefined || ops === null ? {} : { ops: ops as number }) });
  }
  return signals;
}

export function parseChapters(body: unknown): ChapterOption[] | string {
  if (!Array.isArray(body) || !body.length || body.length > MAX_ROUTE_CHAPTERS) return `chapters 必須是 1 到 ${MAX_ROUTE_CHAPTERS} 個章節`;
  const seen = new Set<string>(); const chapters: ChapterOption[] = [];
  for (const item of body as Record<string, unknown>[]) {
    if (!item || typeof item.id !== 'string' || !ID.test(item.id) || seen.has(item.id)) return '章節 id 格式錯誤或重複';
    const variants = item.variants === undefined ? [] : item.variants;
    if (!Array.isArray(variants) || variants.some(variant => !VARIANTS.includes(variant as Variant))) return 'variants 不在允許清單內';
    if (item.title !== undefined && typeof item.title !== 'string') return 'title 必須是文字';
    // eslint-disable-next-line no-control-regex
    const title = typeof item.title === 'string' ? item.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    if (item.checkpoint !== undefined && typeof item.checkpoint !== 'boolean') return 'checkpoint 必須是布林值';
    seen.add(item.id);
    chapters.push({ id: item.id, variants: [...new Set(variants as Variant[])], ...(title ? { title } : {}), ...(item.checkpoint ? { checkpoint: true } : {}) });
  }
  return chapters;
}

const tally = (): LevelTally => ({ right: 0, wrong: 0 });
const blank = (concept: string): ConceptState => ({ concept, pretest: 'none', pretest_levels: { d1: tally(), d2: tally(), d3: tally() }, pretest_tagged: 0, readiness: 'unknown', checkpoint_attempts: 0, checkpoint_passed: false, hints: 0, retries: 0, asks: 0, unsure: 0, unsure_hard: 0, wrong_questions: 0, correct_questions: 0, misconceptions: {}, steps: 0, step_ms: 0, module_runs: 0, module_ms: 0, controls: 0, skip_requests: 0, skipped: false, mastery: 'unknown' });

/** Reads the pretest answers by difficulty. Without any tag a miss is a core miss, which is how the pretest was read before difficulty existed. */
export function readinessOf(state: ConceptState): Readiness {
  const { d1, d2, d3 } = state.pretest_levels;
  if (d1.right + d1.wrong + d2.right + d2.wrong + d3.right + d3.wrong === 0) return 'unknown';
  if (d1.wrong) return 'foundation_gap';
  if (d2.wrong) return 'core_gap';
  if (d3.wrong) return 'hard_gap';
  return state.pretest_tagged > 0 && !d3.right ? 'core_ready' : 'ready';
}

export function masteryOf(state: ConceptState): Mastery {
  const failures = state.checkpoint_attempts - (state.checkpoint_passed ? 1 : 0);
  if (state.checkpoint_passed) return failures >= 2 ? 'shaky' : 'mastered';
  if (state.readiness === 'foundation_gap' || state.readiness === 'core_gap' || failures >= 1 || state.hints >= 3 || state.retries >= 3 || state.wrong_questions >= 2 || state.unsure >= 2 || Object.values(state.misconceptions).some(count => count >= 2)) return 'shaky';
  // Only a pretest that included a hard question shows mastery; a hard miss alone is a gap to teach through, not a weakness.
  return state.readiness === 'ready' && !state.wrong_questions ? 'mastered' : 'unknown';
}

/** Signals must be in time order. */
export function summarize(signals: LearnerSignal[]): Record<string, ConceptState> {
  const states: Record<string, ConceptState> = {};
  for (const signal of signals) {
    const state = (states[signal.concept] ??= blank(signal.concept));
    if (signal.kind === 'pretest') {
      if (signal.correct === true || signal.correct === false) {
        if (signal.difficulty) state.pretest_tagged++;
        state.pretest_levels[`d${signal.difficulty ?? 2}` as 'd1' | 'd2' | 'd3'][signal.correct ? 'right' : 'wrong']++;
      }
    } else if (signal.kind === 'checkpoint') {
      state.checkpoint_attempts++; if (signal.correct === true) state.checkpoint_passed = true;
    } else if (signal.kind === 'question') {
      if (signal.correct === false) state.wrong_questions++; else if (signal.correct === true) state.correct_questions++;
    } else if (signal.kind === 'hint') state.hints++;
    else if (signal.kind === 'step') { state.steps++; state.step_ms += signal.value ?? 0; }
    else if (signal.kind === 'module') { state.module_runs++; state.module_ms += signal.value ?? 0; state.controls += signal.ops ?? 0; }
    else if (signal.kind === 'skip') state.skip_requests++;
    else if (signal.kind === 'skipped') state.skipped = true;
    else if (signal.kind === 'retry') state.retries++;
    else if (signal.kind === 'ask') state.asks++;
    else if (signal.kind === 'unsure') { if (signal.difficulty === 3) state.unsure_hard++; else state.unsure++; }
    if (signal.misconception && signal.correct === false) state.misconceptions[signal.misconception] = (state.misconceptions[signal.misconception] ?? 0) + 1;
  }
  for (const state of Object.values(states)) {
    state.readiness = readinessOf(state);
    state.pretest = state.readiness === 'unknown' ? 'none' : state.readiness === 'foundation_gap' || state.readiness === 'core_gap' ? 'failed' : state.readiness === 'hard_gap' ? 'partial' : 'passed';
    state.mastery = masteryOf(state);
  }
  return states;
}

const stateOf = (states: Record<string, ConceptState>, id: string) => states[id] ?? blank(id);
const topMisconceptions = (state: ConceptState) => Object.entries(state.misconceptions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([id]) => id);

export function detailFor(state: ConceptState): DetailLevel {
  if (state.mastery === 'shaky' || state.hints >= 2 || state.asks >= 2 || state.unsure >= 1) return 'detailed';
  return state.mastery === 'mastered' && !state.hints ? 'brief' : 'standard';
}
/** The learner took this chapter's 檢核 and has not passed it. Only a failed checkpoint sends anyone to the remedial version. */
const failedCheckpoint = (state: ConceptState) => state.checkpoint_attempts > 0 && !state.checkpoint_passed;
export function variantFor(state: ConceptState, available: Variant[]): Variant {
  const has = (variant: Variant) => available.includes(variant);
  if (state.mastery === 'mastered' && has('quick')) return 'quick';
  // A weak pretest, an in-lesson quiz miss, hints or questions change how much is explained (detailFor), never which version plays.
  if (failedCheckpoint(state) && has('remedial')) return 'remedial';
  return 'standard';
}

/** A learner who just failed a chapter's 檢核 goes back into that same chapter, to its 補強 version when it has one. Nothing else may be chosen. */
function checkpointRetry(chapters: ChapterOption[], states: Record<string, ConceptState>, context: RouteContext): RouteDecision | null {
  if (context.trigger !== 'checkpoint' || !context.current) return null;
  const chapter = chapters.find(item => item.id === context.current);
  const state = chapter && stateOf(states, chapter.id);
  if (!chapter || !state || !failedCheckpoint(state)) return null;
  return { next: chapter.id, variant: chapter.variants.includes('remedial') ? 'remedial' : 'standard', detail: 'detailed', skip: leadingMastered(chapters, states), focus: topMisconceptions(state) };
}

/**
 * Chapters before the first gap that the learner has already shown mastery of. A mastered chapter that has a quick
 * variant is never skipped: its exam traps and hard problems are the quick variant, so it is played instead.
 */
function leadingMastered(chapters: ChapterOption[], states: Record<string, ConceptState>): string[] {
  const skip: string[] = [];
  for (const chapter of chapters) { if (stateOf(states, chapter.id).mastery !== 'mastered' || chapter.variants.includes('quick')) break; skip.push(chapter.id); }
  return skip;
}

const isDone = (state: ConceptState) => state.checkpoint_passed || state.skipped;
/** Whether a chapter has been probed: its pretest answered (or declined with "I don't know"), its checkpoint attempted, or it was skipped. */
export function isPretested(states: Record<string, ConceptState>, chapter: string): boolean {
  const state = states[chapter];
  return !!state && (state.pretest !== 'none' || state.unsure + state.unsure_hard > 0 || state.checkpoint_attempts > 0 || state.skipped);
}
/**
 * A learner's request to skip a chapter, answered by the rules: proven mastery is granted; otherwise the learner may test out
 * through the chapter's 檢核 (pass = done, fail = 補強); a chapter with no 檢核 is simply taught.
 */
function skipAnswer(chapters: ChapterOption[], states: Record<string, ConceptState>, request: string | null | undefined): 'grant' | 'challenge' | 'teach' | null {
  const chapter = request ? chapters.find(item => item.id === request) : undefined;
  if (!chapter) return null;
  const state = stateOf(states, chapter.id);
  if (isDone(state)) return null;
  if (state.mastery === 'mastered') return 'grant';
  return chapter.checkpoint ? 'challenge' : 'teach';
}

export function ruleRoute(chapters: ChapterOption[], states: Record<string, ConceptState>, context: RouteContext = {}): RouteDecision {
  const retry = checkpointRetry(chapters, states, context);
  if (retry) return retry;
  const answer = skipAnswer(chapters, states, context.skipRequest);
  const leading = leadingMastered(chapters, states);
  if (answer === 'challenge') return { next: context.skipRequest!, variant: 'standard', detail: 'standard', skip: leading, focus: [], challenge: true };
  const granted = answer === 'grant' ? context.skipRequest! : null;
  const skip = granted && !leading.includes(granted) ? [...leading, granted] : leading;
  const chapter = chapters.find(item => !skip.includes(item.id) && !isDone(stateOf(states, item.id)));
  if (!chapter) return { next: null, variant: 'standard', detail: 'standard', skip, focus: [] };
  const state = stateOf(states, chapter.id);
  return { next: chapter.id, variant: variantFor(state, chapter.variants), detail: detailFor(state), skip, focus: topMisconceptions(state) };
}

/** How far through the course the learner is: chapters done (checkpoint passed or already mastered) and those worth another look. */
export function progressOf(chapters: ChapterOption[], states: Record<string, ConceptState>): { total: number; done: number; shaky: string[] } {
  let done = 0; const shaky: string[] = [];
  for (const chapter of chapters) { const state = stateOf(states, chapter.id); if (isDone(state) || state.mastery === 'mastered') done++; if (state.mastery === 'shaky') shaky.push(chapter.id); }
  return { total: chapters.length, done, shaky };
}

const LEVEL_NAMES = { d1: 'foundation', d2: 'core', d3: 'hard' } as const;
/** "right/answered" for each difficulty that was asked, e.g. {"foundation":"2/2","core":"1/2","hard":"0/2"}. */
const pretestProfile = (state: ConceptState) => Object.fromEntries((['d1', 'd2', 'd3'] as const).filter(key => state.pretest_levels[key].right + state.pretest_levels[key].wrong > 0).map(key => [LEVEL_NAMES[key], `${state.pretest_levels[key].right}/${state.pretest_levels[key].right + state.pretest_levels[key].wrong}`]));
/** How the learner operated this chapter's interactive modules, when they did: steps and pace, finished modules, controls touched. */
function moduleUse(state: ConceptState) {
  if (!state.steps && !state.module_runs) return null;
  return {
    ...(state.steps ? { steps: state.steps, avg_step_seconds: Math.round(state.step_ms / state.steps / 1000) } : {}),
    ...(state.module_runs ? { finished: state.module_runs, total_seconds: Math.round(state.module_ms / 1000), controls: state.controls } : {}),
  };
}
const RECENT_LIMIT = 8;
/** The last few things the learner did in one chapter, oldest first: what just happened is often more telling than the totals. */
export function recentSignals(signals: LearnerSignal[], concept: string | null, limit = RECENT_LIMIT) {
  if (!concept) return [];
  return signals.filter(signal => signal.concept === concept).slice(-limit).map(signal => ({
    kind: signal.kind,
    ...(signal.correct === true || signal.correct === false ? { correct: signal.correct } : {}),
    ...(signal.difficulty ? { level: LEVEL_NAMES[`d${signal.difficulty}` as 'd1' | 'd2' | 'd3'] } : {}),
    ...(signal.misconception ? { misconception: signal.misconception } : {}),
    ...(signal.kind === 'step' || signal.kind === 'module' ? { seconds: Math.round((signal.value ?? 0) / 1000) } : {}),
    ...(signal.kind === 'module' ? { controls: signal.ops ?? 0 } : {}),
  }));
}

/**
 * Compact input for the model router. Ids are echoed back, so they must stay short.
 * Chapters the learner has not touched are just id, title and variants; the rest carry what is known about them.
 */
export function routeDigest(chapters: ChapterOption[], states: Record<string, ConceptState>, current: string | null, trigger: string, recent: ReturnType<typeof recentSignals> = [], skipRequest: string | null = null) {
  return {
    trigger, current,
    ...(skipRequest ? { skip_requested: skipRequest } : {}),
    ...(recent.length ? { recent_in_current: recent } : {}),
    chapters: chapters.map(chapter => {
      const base = { id: chapter.id, ...(chapter.title ? { title: chapter.title } : {}), variants: chapter.variants, ...(chapter.checkpoint ? { has_checkpoint: true } : {}) };
      const state = states[chapter.id];
      if (!state) return base;
      return {
        ...base, mastery: state.mastery, readiness: state.readiness, pretest_by_level: pretestProfile(state),
        checkpoint_attempts: state.checkpoint_attempts, checkpoint_passed: state.checkpoint_passed,
        hints: state.hints, retries: state.retries, asks: state.asks, unsure: state.unsure, unsure_hard: state.unsure_hard,
        wrong_questions: state.wrong_questions, correct_questions: state.correct_questions, misconceptions: topMisconceptions(state),
        ...(moduleUse(state) ? { module_use: moduleUse(state) } : {}),
        ...(state.skipped ? { skipped: true } : {}),
      };
    }),
  };
}
export const ROUTE_SYSTEM_PROMPT = [
  'You route a learner through a pre-generated lesson, choosing what they should study next. Reply with JSON only, no prose: {"next":string|null,"variant":"standard"|"remedial"|"quick"|"enrich","detail":"brief"|"standard"|"detailed","skip":string[],"focus":string[],"challenge":boolean}.',
  'Rules for the fields: "next" and "skip" use chapter ids from the input; "variant" must be one the chapter lists or "standard"; "skip" only chapters already mastered that have no "quick" variant (a mastered chapter with a quick variant is played as quick: a recap of formulas and exam traps, then hard problems); "focus" lists misconception ids from the input; use null for "next" when every chapter is done.',
  'Chapters are listed in dependency order: an earlier chapter is a prerequisite of later ones. Teach the earliest chapter that still has a gap; go back to an earlier chapter only when the evidence points at it.',
  'Read the evidence by difficulty ("pretest_by_level": right/answered for foundation, core and hard questions; the pretest asks hard questions on purpose):',
  'The "remedial" version is only for a learner who failed this chapter\'s checkpoint (檢核). A pretest, an in-lesson quiz, hints or questions never send a learner to "remedial"; they only change "detail".',
  '- readiness "foundation_gap": prerequisite knowledge is missing. Use "standard" with detail "detailed".',
  '- "core_gap": the chapter\'s own idea is not understood yet. Use "standard" with detail "detailed".',
  '- "hard_gap": foundation and core are fine and only hard questions were missed. This learner is NOT weak: use "standard", detail "standard", never "remedial" or "quick"; the hard part is what the lesson is for.',
  '- "core_ready": everything answered was right, but no hard question was asked, so mastery is unproven: use "standard".',
  '- "ready" (mastery "mastered"): foundation, core and hard all right. Use "quick" if available, detail "brief".',
  '"unsure_hard" (saying "I don\'t know" to a hard question) is normal and is not a weakness. "unsure", "hints", "asks" and repeated misconceptions mean more support: detail "detailed".',
  'After a failed checkpoint ("trigger" is "checkpoint", "checkpoint_attempts" above 0 and "checkpoint_passed" false), the next step is always the SAME chapter with "remedial" if it has one (else "standard"), detail "detailed"; never another chapter. After a passed checkpoint, move to the next chapter that is not passed. "recent_in_current" is what the learner just did, oldest first.',
  'Interactive modules ("module_use": "steps" taken and "avg_step_seconds" per step, "finished" modules with "total_seconds" and "controls" touched; the recent list shows each step\'s "seconds"): very quick steps with few controls and wrong answers mean the learner is clicking through (use detail "detailed", not "quick"); long steps, many hints or retries mean they are struggling (detail "detailed", put the misconceptions they hit in "focus"); a fast, accurate run with few hints supports "brief". Module use changes "detail", "focus" and the order of chapters, never "remedial".',
  'A learner may ask to skip a chapter ("skip_requested" is its id). You decide, with one of: (1) grant it, by listing the id in "skip" with "next" set to the next chapter that is not done; only for a chapter whose mastery is "mastered"; (2) let the learner test out, by setting "next" to that chapter and "challenge": true; only if it "has_checkpoint". Passing the checkpoint completes the chapter, failing it sends the learner to "remedial"; use this when mastery is not proven but the learner could plausibly know it (good pretest, fast accurate module use); (3) refuse, by setting "next" to that chapter with "challenge": false, and the lesson plays; use this when there are real gaps (foundation_gap, core_gap, wrong answers, many hints). Never grant a skip without proof of mastery. Omit "challenge" when no skip was requested.',
].join('\n');

/** Validate the model's JSON against what the lesson really has. Returns null when it cannot be trusted. */
export function parseRouteDecision(raw: unknown, chapters: ChapterOption[], states: Record<string, ConceptState>, context: RouteContext = {}): RouteDecision | null {
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return null; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { next, variant, detail, skip, focus, challenge } = value as Record<string, unknown>;
  const ids = new Map(chapters.map(chapter => [chapter.id, chapter]));
  // Whatever the model says, a failed 檢核 goes back to that chapter's 補強.
  const retry = checkpointRetry(chapters, states, context);
  if (retry && DETAIL_LEVELS.includes(detail as DetailLevel) && VARIANTS.includes(variant as Variant) && (next === null || (typeof next === 'string' && ids.has(next)))) return retry;
  if (next !== null && (typeof next !== 'string' || !ids.has(next))) return null;
  if (!DETAIL_LEVELS.includes(detail as DetailLevel) || !VARIANTS.includes(variant as Variant)) return null;
  if (skip !== undefined && !Array.isArray(skip)) return null;
  if (focus !== undefined && !Array.isArray(focus)) return null;
  const chosen = next === null ? null : ids.get(next)!;
  let allowedVariant = chosen && (variant === 'standard' || chosen.variants.includes(variant as Variant)) ? variant as Variant : 'standard';
  // The model may pick among versions, but not against the evidence: quick is for proven mastery, remedial only after a failed checkpoint (檢核).
  const chosenState = chosen ? stateOf(states, chosen.id) : null;
  if (chosenState && allowedVariant === 'quick' && chosenState.mastery !== 'mastered') allowedVariant = 'standard';
  if (chosenState && allowedVariant === 'remedial' && !failedCheckpoint(chosenState)) allowedVariant = 'standard';
  // A learner's skip request is the router's call, but a skip needs proof of mastery and a test-out needs a 檢核 to take.
  const answer = skipAnswer(chapters, states, context.skipRequest);
  const requested = context.skipRequest ?? null;
  const modelSkips = Array.isArray(skip) && requested !== null && (skip as unknown[]).includes(requested);
  if (answer && modelSkips && answer !== 'grant') return ruleRoute(chapters, states, context);
  if (answer === 'challenge' && challenge === true && next === requested && chosen?.checkpoint) return { next, variant: 'standard', detail: detail as DetailLevel, skip: [], focus: [], challenge: true };
  const skipped = [...new Set((skip as unknown[] | undefined ?? []).filter((id): id is string => typeof id === 'string' && ids.has(id) && id !== next && ((stateOf(states, id).mastery === 'mastered' && !ids.get(id)!.variants.includes('quick')) || (answer === 'grant' && id === requested))))];
  const known = chosen ? Object.keys(stateOf(states, chosen.id).misconceptions) : [];
  const focused = [...new Set((focus as unknown[] | undefined ?? []).filter((id): id is string => typeof id === 'string' && known.includes(id)))].slice(0, 3);
  return { next, variant: allowedVariant, detail: detail as DetailLevel, skip: skipped, focus: focused };
}
