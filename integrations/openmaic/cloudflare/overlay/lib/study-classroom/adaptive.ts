'use client';
// Client side of adaptive routing: batches learner signals and asks the server where to go next.
// The server always answers (rules when AI is off), so a failure here falls back to the player's linear order.
import { clearStudyOperate } from '@/lib/study-classroom/operate';
import { unlockStudyPanel } from './lock';
import { saveStudyModule, savedModuleState, sceneOfFrame } from './progress';
import { useSyncExternalStore } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { signalFromKitEvent } from './kit-events';
import { answeredUnsure, sceneOffersUnsure, withUnsure } from './unsure';
import { applyDecision, buildCourseMap, chapterVariants, difficultyOf, fallbackNext, lessonScenes, misconceptionOf, previousTarget, progressNote, quickDetourTarget, routeStep, type CourseMap, type DetailLevel, type RouteDecision, type SceneInfo, keepPretestOrder } from './course-map';
import { coachShouldAsk, parseStudyCoachNote, showStudyCoach, studyRemark, type StudyCoachNote } from './coach';
import { extractSceneContext } from './scene-context';

interface Signal { concept: string; kind: 'pretest' | 'checkpoint' | 'question' | 'hint' | 'retry' | 'step' | 'ask' | 'unsure' | 'module'; correct?: boolean | null; misconception?: string | null; value?: number | null; difficulty?: 1 | 2 | 3 | null; ops?: number | null }
/** `note` is about the scene it was set for (`noteScene`); the dock shows it only there, so it never goes stale after a manual jump. */
export interface StudyAdaptiveState {
  detail: DetailLevel; routing: boolean; note: string | null; noteScene: string | null;
  /** The quiz scene whose answers were just graded: pressing continue there moves on instead of replaying it. */
  gradedScene: string | null;
  /** A learner who did not understand a step of a quick lesson is in the standard lesson `standard` and goes back to `back` when it ends. */
  detour: { standard: string; back: string } | null;
}
let state: StudyAdaptiveState = { detail: 'standard', routing: false, note: null, noteScene: null, gradedScene: null, detour: null };
const listeners = new Set<() => void>();
const publish = (next: Partial<StudyAdaptiveState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
export function useStudyAdaptive() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state, () => state);
}

let queue: Signal[] = []; let timer: ReturnType<typeof setTimeout> | undefined; let version = 0; let decidedAt = -1; let cached: RouteDecision | null = null;
type Progress = { total: number; done: number; shaky: string[] };
let progress: Progress | null = null; let prefetchTimer: ReturnType<typeof setTimeout> | undefined; const failedCheckpoints = new Set<string>();
const isStale = () => !cached || decidedAt !== version;
const scenesNow = (): SceneInfo[] => useStageStore.getState().scenes.map(scene => ({ id: scene.id, title: scene.title, type: scene.type }));
let visitedCourse = '', visitedLessons: Record<string, string> = Object.create(null);
function navigationCourse(scenes: SceneInfo[]) {
  const key = (typeof location === 'undefined' ? '' : location.pathname) + JSON.stringify(scenes);
  if (key !== visitedCourse) { visitedCourse = key; visitedLessons = Object.create(null); }
}
export function rememberStudyLesson(sceneId: string) {
  const scenes = scenesNow(); navigationCourse(scenes);
  const role = buildCourseMap(scenes).roles[sceneId];
  if (role?.role === 'content' || role?.role === 'variant') visitedLessons[role.chapter] = sceneId;
}
export function studyPreviousTarget(currentId: string | null): string | null {
  const scenes = scenesNow(); navigationCourse(scenes);
  return previousTarget(buildCourseMap(scenes), scenes, currentId, visitedLessons);
}

export async function flushStudySignals(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  while (queue.length) {
    const batch = queue.splice(0, 50);
    try { await fetch('/api/openmaic/live/signals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signals: batch }), keepalive: true }); }
    catch { /* A lost signal only makes routing slightly less informed. */ }
  }
}
/** `taught: false` marks an answer given before the chapter was taught (a pretest): the coach does not treat it as being stuck. */
function record(signal: Signal, taught = true) {
  queue.push(signal); version++;
  if (taught && coachShouldAsk(signal)) scheduleCoach(signal.concept);
  if (queue.length >= 50) void flushStudySignals(); else timer ??= setTimeout(() => void flushStudySignals(), 1500);
}

// ---- learning coach: asks the server what the learner keeps getting wrong, once a pattern shows ----
let coachTimer: ReturnType<typeof setTimeout> | undefined;
/** The learner first sees the feedback on the answer itself; the coach speaks a moment later. */
function scheduleCoach(chapter: string) { clearTimeout(coachTimer); coachTimer = setTimeout(() => { void askCoach(chapter).catch(() => undefined); }, 2500); }
/** The text of a chapter's standard lesson, which is what the coach may explain from. */
function lessonText(map: CourseMap, chapter: string): string {
  const ids = new Set(lessonScenes(map, chapter)); let text = '';
  for (const scene of useStageStore.getState().scenes) {
    if (!ids.has(scene.id) || text.length >= COACH_LESSON_CHARS) continue;
    const part = extractSceneContext(scene as never, 2400);
    if (part) text += `\n## ${scene.title}\n${part}`;
  }
  return text.trim().slice(0, COACH_LESSON_CHARS);
}
const COACH_LESSON_CHARS = 6000;
async function askCoach(chapter: string): Promise<void> {
  const map = buildCourseMap(scenesNow());
  if (!map.active || !map.chapters.some(item => item.id === chapter)) return;
  clearTimeout(timer); timer = undefined;
  const pending = queue.splice(0, 50);
  const chapters = map.chapters.map(item => ({ id: item.id, title: item.key, variants: chapterVariants(item), checkpoint: !!item.checkpoint }));
  const response = await fetch('/api/openmaic/live/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapters, current: chapter, lesson: lessonText(map, chapter), ...(pending.length ? { signals: pending } : {}) }), signal: AbortSignal.timeout(30000) }).catch((error: unknown) => { queue.unshift(...pending); throw error; });
  if (!response.ok) { queue.unshift(...pending); return; }
  const body = (await response.json()) as { coach?: unknown; reason?: unknown };
  const note = parseStudyCoachNote(body.coach);
  if (note) showStudyCoach({ ...note, aiOff: body.reason === 'session_not_enabled' });
}
/**
 * The learner takes the coach's advice. Returns the scene to open: the chapter's lesson from its start, or its remedial
 * version. From a quick or remedial page the learner is brought back afterwards, the same way the quick-lesson detour works.
 */
export function studyCoachTarget(note: StudyCoachNote): string | null {
  const map = buildCourseMap(scenesNow()); const chapter = map.chapters.find(item => item.id === note.chapter);
  const current = useStageStore.getState().currentSceneId;
  if (!chapter || note.route === 'continue') return null;
  const target = note.route === 'remedial' ? chapter.variants.remedial ?? chapter.id : chapter.id;
  if (target === current) return null;
  // Going back for help is support the router should know about.
  record({ concept: chapter.id, kind: 'hint' }, false);
  const fromVariant = !!current && map.roles[current]?.role === 'variant' && target === chapter.id;
  publish({ ...(fromVariant ? { detour: { standard: chapter.id, back: current! } } : {}), note: note.route === 'remedial' ? NOTES.remedial : fromVariant ? '看完這段講解會回到剛才的地方' : '重新看一次這段講解，再回來作答', noteScene: target });
  return target;
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void flushStudySignals());

const chapterOf = (sceneId: string): string | null => {
  const scenes = scenesNow(); const map = buildCourseMap(scenes);
  return map.active ? map.roles[sceneId]?.chapter ?? null : null;
};
export const isStudyQuizGraded = (sceneId: string | null) => !!sceneId && state.gradedScene === sceneId;
/** Restore the view's completion marker without replaying its learner signals. */
export function setStudyQuizGraded(sceneId: string, reviewed: boolean) {
  if (reviewed && state.gradedScene !== sceneId) publish({ gradedScene: sceneId });
  else if (!reviewed && state.gradedScene === sceneId) publish({ gradedScene: null });
}

/** The standard lesson behind a quick lesson, or null when this scene is not a quick lesson. */
export function studyQuickDetour(sceneId: string): string | null { return quickDetourTarget(buildCourseMap(scenesNow()), sceneId); }

/** Whether finishing this scene ends the standard lesson of the running detour, so "next" returns to the quick lesson. */
export function studyDetourEndsAt(sceneId: string): boolean {
  const detour = state.detour;
  return !!detour && lessonScenes(buildCourseMap(scenesNow()), detour.standard).at(-1) === sceneId;
}

/** "I don't understand this step" inside a quick lesson: go learn the basics in the standard lesson, then come back. Returns the scene to open. */
export function beginStudyDetour(fromId: string): string | null {
  const standard = studyQuickDetour(fromId); if (!standard) return null;
  recordStudyHint(fromId);
  publish({ detour: { standard, back: fromId }, note: '先把基礎概念學好，學完會回到精簡版', noteScene: standard });
  return standard;
}
export function recordStudyHint(sceneId: string) { const concept = chapterOf(sceneId); if (concept) record({ concept, kind: 'hint' }); }
export function recordStudyAsk() { const id = useStageStore.getState().currentSceneId; const concept = id ? chapterOf(id) : null; if (concept) record({ concept, kind: 'ask' }); }

/** The questions to show for a scene: pretest and checkpoint choice questions also offer "I don't know". */
export function studyQuestionsFor<T extends { type: string; options?: { label: string; value: string }[] }>(sceneId: string, questions: T[]): T[] {
  const scene = useStageStore.getState().scenes.find(item => item.id === sceneId);
  return scene && sceneOffersUnsure(scene.title) ? withUnsure(questions) : questions;
}

export function recordStudyQuiz(sceneId: string, questions: { id: string }[], results: { correct: boolean | null }[], answers?: Record<string, string | string[]>) {
  setStudyQuizGraded(sceneId, true);
  const map = buildCourseMap(scenesNow()); const role = map.active ? map.roles[sceneId] : undefined;
  if (!role || (role.role !== 'pretest' && role.role !== 'checkpoint')) return;
  const graded = questions.map((question, index) => ({ id: question.id, correct: results[index]?.correct ?? null })).filter(item => item.correct !== null);
  for (const item of graded) {
    // "I don't know" is a gap in knowledge, not a misconception, and is kept apart from a wrong guess.
    const unsure = answeredUnsure(answers?.[item.id]);
    const difficulty = difficultyOf(item.id);
    if (unsure) record({ concept: role.chapter, kind: 'unsure', difficulty }, role.role !== 'pretest');
    const misconception = item.correct === false && !unsure ? misconceptionOf(item.id) : null;
    if (role.role === 'pretest') record({ concept: role.chapter, kind: 'pretest', correct: item.correct, misconception, difficulty }, false);
    else if (item.correct === false) record({ concept: role.chapter, kind: 'question', correct: false, misconception, difficulty });
  }
  if (role.role === 'checkpoint' && graded.length) {
    const passed = graded.every(item => item.correct === true);
    record({ concept: role.chapter, kind: 'checkpoint', correct: passed });
    if (passed) { failedCheckpoints.delete(role.chapter); studyRemark('done'); } else failedCheckpoints.add(role.chapter);
  }
  // The learner reads the explanations first; by the time they press continue the next step is already decided.
  const scenes = scenesNow();
  if (routeStep(map, scenes, sceneId).needsRoute) {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => { void requestDecision(map, sceneId).catch(() => false); }, 1200);
  }
}

const NOTES: Record<string, string> = { remedial: '檢核沒通過，改看補強版，最後有復測', quick: '先測全對，跳過講解，直接練考試陷阱與難題', enrich: '進入延伸內容' };

/** Asks the server where to go next (rules, or the model when the learner opted in), and remembers the answer. */
async function requestDecision(map: CourseMap, currentId: string, skipRequest?: string): Promise<boolean> {
  const seen = version;
  // Anything not yet sent goes with this request (one round trip). If it fails, it goes back in the queue.
  clearTimeout(timer); timer = undefined;
  const pending = queue.splice(0, 50);
  // The chapter name tells the router what each id teaches.
  const chapters = map.chapters.map(chapter => ({ id: chapter.id, title: chapter.key, variants: chapterVariants(chapter), checkpoint: !!chapter.checkpoint }));
  const role = map.roles[currentId]?.role;
  const trigger = role === 'checkpoint' ? 'checkpoint' : role === 'pretest' ? 'pretest' : 'step';
  const response = await fetch('/api/openmaic/live/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapters, current: map.roles[currentId]?.chapter, trigger, ...(skipRequest ? { skip_request: skipRequest } : {}), ...(pending.length ? { signals: pending } : {}) }), signal: AbortSignal.timeout(15000) }).catch((error: unknown) => { queue.unshift(...pending); throw error; });
  if (!response.ok) { queue.unshift(...pending); return false; }
  const body = await response.json() as { decision?: RouteDecision; progress?: Progress };
  if (!body.decision) return false;
  cached = body.decision; progress = body.progress ?? null; decidedAt = seen === version ? version : -1;
  return true;
}

const titleOf = (map: CourseMap, id: string) => map.chapters.find(chapter => chapter.id === id)?.key ?? '';
function noteFor(map: CourseMap, currentId: string, decision: RouteDecision): string | null {
  if (decision.next === null) return progressNote(progress, id => titleOf(map, id));
  const again = map.roles[currentId]?.role === 'checkpoint' && map.roles[currentId]?.chapter === decision.next;
  return NOTES[decision.variant] ?? (again ? '檢核還沒通過，回到這一章再看一次' : null);
}

/** Scene id to open when the learner presses continue, or null to keep the player's linear order. */
export async function studyAdaptiveTarget(currentId: string | null): Promise<string | null> {
  const scenes = scenesNow(); const map = buildCourseMap(scenes);
  // A learner who stepped back to the standard lesson from a quick lesson returns there once the standard lesson is done.
  const detour = state.detour;
  if (detour && currentId) {
    const lesson = lessonScenes(map, detour.standard);
    if (currentId === lesson.at(-1) && scenes.some(scene => scene.id === detour.back)) {
      publish({ detour: null, note: '基礎概念完成，回到精簡版繼續', noteScene: detour.back });
      return detour.back;
    }
    if (currentId !== detour.back && !lesson.includes(currentId)) publish({ detour: null });
  }
  const step = routeStep(map, scenes, currentId);
  if (!currentId || (!step.target && !step.needsRoute)) return null;
  if (step.target) {
    const chapter = map.roles[step.target]?.chapter;
    publish({ note: map.roles[step.target]?.role === 'checkpoint' && chapter && failedCheckpoints.has(chapter) ? '準備好了就再挑戰一次：按下方的「重試」重新作答' : null, noteScene: step.target });
    return step.target;
  }
  publish({ routing: true });
  try {
    // A chapter with no checkpoint scene counts as done once its lesson has been completed.
    const role = map.roles[currentId];
    if (role && (role.role === 'content' || role.role === 'variant')) record({ concept: role.chapter, kind: 'checkpoint', correct: true });
    if (isStale() && !(await requestDecision(map, currentId))) return null;
    if (!cached || keepPretestOrder(map, scenes, currentId, cached)) return null;
    const target = applyDecision(map, scenes, currentId, cached);
    const probing = !!target && target !== currentId && map.roles[target]?.role === 'pretest';
    publish({ detail: cached.detail, note: probing ? '先看看這一章你已經會多少，不確定就選「我不會」；全對可以跳過講解' : noteFor(map, currentId, cached), noteScene: target ?? currentId });
    return target;
  } catch { return null; }
  finally { publish({ routing: false }); }
}

/** Whether this scene belongs to a chapter, so the learner may ask to skip it. */
export function canSkipStudyChapter(sceneId: string | null): boolean {
  const map = buildCourseMap(scenesNow()); const role = sceneId && map.active ? map.roles[sceneId] : undefined;
  return !!role && role.role !== 'checkpoint';
}

/**
 * The learner asks to skip the chapter they are in. The router decides: grant it (proven mastery), let them test out through the
 * chapter's 檢核 (pass = done, fail = 補強), or keep teaching it. Returns the scene to open, or null to stay where they are.
 */
export async function studySkipChapter(currentId: string | null): Promise<string | null> {
  const scenes = scenesNow(); const map = buildCourseMap(scenes);
  const role = currentId && map.active ? map.roles[currentId] : undefined;
  if (!currentId || !role) return null;
  publish({ routing: true });
  try {
    if (!(await requestDecision(map, currentId, role.chapter)) || !cached) return null;
    const decision = cached; cached = null;
    const name = titleOf(map, role.chapter);
    const granted = decision.skip.includes(role.chapter) && decision.next !== role.chapter;
    const note = granted ? `已略過「${name}」` : decision.challenge ? `直接挑戰「${name}」的檢核：通過就完成這章，沒通過會進補強` : `先把「${name}」學完：目前的表現還需要這一章`;
    const target = applyDecision(map, scenes, currentId, decision);
    publish({ detail: decision.detail, note, noteScene: target ?? currentId });
    return target;
  } catch { return null; }
  finally { publish({ routing: false }); }
}

/** Used when routing could not answer: the next scene in order, but never an unpicked variant. */
export function studyFallbackTarget(currentId: string | null): string | null {
  const scenes = scenesNow();
  return fallbackNext(buildCourseMap(scenes), scenes, currentId);
}

// Feedback from kit-built modules arrives by postMessage from the sandboxed iframe, so the sender is checked
// against the page's own iframes and each frame is rate limited.
const frameRate = new WeakMap<object, { start: number; count: number }>();
let bridged = false;
export function installStudyKitBridge() {
  if (bridged || typeof window === 'undefined') return;
  bridged = true;
  window.addEventListener('message', event => {
    const progress = event.data as { source?: unknown; v?: unknown; ready?: unknown; state?: unknown } | null;
    if (progress && progress.source === 'study-kit-state' && progress.v === 1 && event.source) {
      const sceneId = sceneOfFrame(event.source); if (!sceneId) return;
      if (progress.ready === true) {
        // A kit page has started: hand it back what the learner had done in it, and open its panel since they already worked in it.
        void savedModuleState(sceneId).then(state => { if (state) { unlockStudyPanel(sceneId); (event.source as Window).postMessage({ type: 'STUDY_KIT_RESTORE', state }, '*'); } });
      } else if (progress.state && typeof progress.state === 'object' && !Array.isArray(progress.state)) saveStudyModule(sceneId, progress.state as Record<string, unknown>);
      return;
    }
    const data = event.data as { source?: unknown; v?: unknown; event?: unknown } | null;
    if (!data || data.source !== 'study-kit' || data.v !== 1 || !event.source) return;
    if (!Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) return;
    if ((data.event as { kind?: unknown } | null)?.kind === 'operate') { clearStudyOperate(); return; }
    const now = Date.now(); const rate = frameRate.get(event.source) ?? { start: now, count: 0 };
    if (now - rate.start > 60000) { rate.start = now; rate.count = 0; }
    if (++rate.count > 120) { frameRate.set(event.source, rate); return; }
    frameRate.set(event.source, rate);
    const sceneId = useStageStore.getState().currentSceneId; const concept = sceneId ? chapterOf(sceneId) : null;
    const signal = concept ? signalFromKitEvent(data.event, concept) : null;
    if (signal) record(signal);
    // The module shows its own feedback; this is the teacher's mark beside it.
    const kit = data.event as { kind?: unknown; correct?: unknown; attempt?: unknown } | null;
    if (kit?.kind === 'answer' && typeof kit.correct === 'boolean') studyRemark(kit.correct ? (typeof kit.attempt === 'number' && kit.attempt > 1 ? 'fixed' : 'good') : 'retry');
  });
}
