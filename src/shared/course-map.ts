// Reads the chapter structure that a chatbot encodes in scene titles. Spec: docs/adaptive-learning.md.
// The DSL has no field for roles or variants, so the convention is visible, human-readable text:
//   先測：章名   quiz scene probing a chapter. Pretests sit at the start of the scene list, but each is played right before its own chapter.
//   檢核：章名   quiz scene that decides whether the chapter is mastered
//   章名         the standard lesson; more scenes of it are titled 章名｜小節
//   章名〔補強〕〔精簡〕〔延伸〕   remedial, quick and enrichment variants of that lesson; more scenes are titled 章名〔補強〕｜小節
// An unlabelled scene between a lesson and its checkpoint is part of the lesson, so a page is never skipped for its title alone.
// A question id ending in __m_<id> marks the misconception it probes; __d1, __d2 or __d3 before it marks its difficulty (foundation, core, hard).
export type Variant = 'standard' | 'remedial' | 'quick' | 'enrich';
export type DetailLevel = 'brief' | 'standard' | 'detailed';
export interface SceneInfo { id: string; title: string; type: string }
export interface RouteDecision { next: string | null; variant: Variant; detail: DetailLevel; skip: string[]; focus: string[]; /** Whether `next` has already been probed (its 先測 answered, its 檢核 attempted, or it was skipped). False sends the learner to that chapter's 先測 first, so each pretest is taken right before its chapter instead of all of them before the first lesson. Absent from a server that does not report it. */ pretested?: boolean; /** Go straight to the chapter's 檢核 to test out of it (a learner's skip request the router answered with a challenge). */ challenge?: boolean }
export type SceneRole = { role: 'pretest' | 'checkpoint' | 'content' | 'variant'; chapter: string };
export interface Chapter { id: string; key: string; variants: Partial<Record<Exclude<Variant, 'standard'>, string>>; checkpoint?: string; /** The chapter's 先測 scene. */ pretest?: string; /** The scenes of each path through the chapter, in play order. */ paths: Partial<Record<Variant, string[]>> }
export interface CourseMap { active: boolean; chapters: Chapter[]; roles: Record<string, SceneRole> }

const VARIANT_MARK: Record<string, Exclude<Variant, 'standard'>> = { 補強: 'remedial', 精簡: 'quick', 延伸: 'enrich' };
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

export function parseTitle(title: string): { role: 'pretest' | 'checkpoint' | 'content'; key: string; variant?: Exclude<Variant, 'standard'> } {
  const text = normalize(title);
  const prefixed = /^(先測|前測|診斷|檢核)\s*[：:]\s*(.+)$/.exec(text);
  if (prefixed) return { role: prefixed[1] === '檢核' ? 'checkpoint' : 'pretest', key: normalize(prefixed[2]) };
  const head = normalize(text.split('｜')[0]) || text;
  const marked = /^(.*?)\s*〔(補強|精簡|延伸)〕$/.exec(head);
  if (marked && marked[1]) return { role: 'content', key: normalize(marked[1]), variant: VARIANT_MARK[marked[2]] };
  return { role: 'content', key: head };
}

export function buildCourseMap(scenes: SceneInfo[]): CourseMap {
  // A lesson scene is a chapter only when a pretest, checkpoint or variant scene refers to it by title.
  const referenced = new Set<string>();
  for (const scene of scenes) {
    const parsed = parseTitle(scene.title);
    if ((parsed.role === 'pretest' || parsed.role === 'checkpoint') ? scene.type === 'quiz' : !!parsed.variant && scene.type !== 'quiz') referenced.add(parsed.key);
  }
  const chapters: Chapter[] = []; const byKey = new Map<string, Chapter>();
  for (const scene of scenes) {
    const parsed = parseTitle(scene.title);
    if (parsed.role === 'content' && !parsed.variant && scene.type !== 'quiz' && referenced.has(parsed.key) && !byKey.has(parsed.key)) {
      const chapter: Chapter = { id: scene.id, key: parsed.key, variants: {}, paths: {} }; byKey.set(parsed.key, chapter); chapters.push(chapter);
    }
  }
  const roles: Record<string, SceneRole> = {};
  for (const scene of scenes) {
    const parsed = parseTitle(scene.title); const chapter = byKey.get(parsed.key);
    if (!chapter) continue;
    if (parsed.role === 'pretest' && scene.type === 'quiz') { chapter.pretest ??= scene.id; roles[scene.id] = { role: 'pretest', chapter: chapter.id }; }
    else if (parsed.role === 'checkpoint' && scene.type === 'quiz') { chapter.checkpoint ??= scene.id; roles[scene.id] = { role: 'checkpoint', chapter: chapter.id }; }
    else if (parsed.role === 'content' && scene.type !== 'quiz') {
      if (parsed.variant) { chapter.variants[parsed.variant] ??= scene.id; (chapter.paths[parsed.variant] ??= []).push(scene.id); roles[scene.id] = { role: 'variant', chapter: chapter.id }; }
      else { (chapter.paths.standard ??= []).push(scene.id); roles[scene.id] = { role: 'content', chapter: chapter.id }; }
    }
  }
  const order = new Map(scenes.map((scene, index) => [scene.id, index]));
  for (const chapter of chapters) {
    const start = order.get(chapter.id)!, end = chapter.checkpoint === undefined ? -1 : order.get(chapter.checkpoint)!;
    if (end < start) continue;
    const unlabelled = scenes.slice(start + 1, end).filter(scene => !roles[scene.id]);
    if (!unlabelled.length) continue;
    for (const scene of unlabelled) roles[scene.id] = { role: 'content', chapter: chapter.id };
    chapter.paths.standard = [...chapter.paths.standard!, ...unlabelled.map(scene => scene.id)].sort((a, b) => order.get(a)! - order.get(b)!);
  }
  return { active: chapters.length > 0, chapters, roles };
}

/** The ordered scenes of the path through a chapter that `sceneId` is on, or null when it is on no lesson path. */
function pathOf(map: CourseMap, sceneId: string): string[] | null {
  const role = map.roles[sceneId];
  if (role?.role !== 'content' && role?.role !== 'variant') return null;
  const paths = map.chapters.find(chapter => chapter.id === role.chapter)?.paths ?? {};
  return Object.values(paths).find(path => path?.includes(sceneId)) ?? null;
}

/** The standard lesson's scenes in play order. */
export function lessonScenes(map: CourseMap, chapterId: string): string[] {
  return map.chapters.find(chapter => chapter.id === chapterId)?.paths.standard ?? [chapterId];
}

/** Scenes "next" never opens: no chapter claims them, and they are neither the opening nor the closing of the course. */
export function strandedScenes(map: CourseMap, scenes: SceneInfo[]): SceneInfo[] {
  const claimed = scenes.flatMap((scene, index) => map.roles[scene.id] ? [index] : []);
  if (!claimed.length) return [];
  return scenes.filter((scene, index) => index > claimed[0] && index < claimed[claimed.length - 1] && !map.roles[scene.id]);
}

/** The standard lesson a learner is sent back to from a quick (精簡) lesson, or null when `sceneId` is not on a chapter's quick path. */
export function quickDetourTarget(map: CourseMap, sceneId: string): string | null {
  const role = map.active ? map.roles[sceneId] : undefined;
  if (role?.role !== 'variant') return null;
  const chapter = map.chapters.find(item => item.id === role.chapter);
  return chapter?.paths.quick?.includes(sceneId) ? chapter.id : null;
}

export const chapterVariants = (chapter: Chapter): Variant[] => Object.keys(chapter.variants) as Variant[];

/** Difficulty a question id declares: `__d1` foundation, `__d2` core, `__d3` hard, placed before any `__m_<id>` suffix (q4__d3__m_sign). */
export function difficultyOf(questionId: string): 1 | 2 | 3 | null {
  const level = /__d([123])(?:__m_[A-Za-z0-9.:-]{1,64})?$/.exec(questionId)?.[1];
  return level ? Number(level) as 1 | 2 | 3 : null;
}

export function misconceptionOf(questionId: string): string | null {
  return /__m_([A-Za-z0-9.:-]{1,64})$/.exec(questionId)?.[1] ?? null;
}

/**
 * Where "next" should go, or null to keep the player's own linear order.
 * `needsRoute` reports whether the decision matters for this step, so callers only ask the server when it does.
 */
export function routeStep(map: CourseMap, scenes: SceneInfo[], currentId: string | null): { target: string | null; needsRoute: boolean } {
  if (!map.active || !currentId) return { target: null, needsRoute: false };
  const index = scenes.findIndex(scene => scene.id === currentId);
  if (index < 0) return { target: null, needsRoute: false };
  const current = map.roles[currentId]; const following = scenes[index + 1] ? map.roles[scenes[index + 1].id] : undefined;
  if (current?.role === 'content' || current?.role === 'variant') {
    const path = pathOf(map, currentId) ?? [currentId], following = path[path.indexOf(currentId) + 1];
    if (following) return { target: following, needsRoute: false };
    const checkpoint = map.chapters.find(chapter => chapter.id === current.chapter)?.checkpoint;
    if (checkpoint) return { target: checkpoint, needsRoute: false };
    return { target: null, needsRoute: true };
  }
  if (current?.role === 'checkpoint') return { target: null, needsRoute: true };
  // Every pretest is followed by a decision: the learner goes on to that chapter, not to the next chapter's pretest.
  if (current?.role === 'pretest') return { target: null, needsRoute: true };
  return { target: null, needsRoute: !!following && following.role !== 'pretest' };
}

export function applyDecision(map: CourseMap, scenes: SceneInfo[], currentId: string, decision: RouteDecision): string | null {
  if (decision.next === null) {
    let last = -1;
    scenes.forEach((scene, index) => { if (map.roles[scene.id] && map.roles[scene.id].role !== 'pretest') last = index; });
    const after = scenes.slice(last + 1).find(scene => !map.roles[scene.id]);
    return after && after.id !== currentId ? after.id : null;
  }
  const chapter = map.chapters.find(item => item.id === decision.next);
  if (!chapter) return null;
  if (decision.challenge && chapter.checkpoint) return chapter.checkpoint === currentId ? null : chapter.checkpoint;
  // A chapter that has not been probed yet starts with its own pretest. Leaving that pretest unanswered still moves on to the lesson.
  if (decision.pretested === false && chapter.pretest && chapter.pretest !== currentId) return chapter.pretest;
  const target = decision.variant === 'standard' ? chapter.id : chapter.variants[decision.variant] ?? chapter.id;
  return target === currentId ? null : target;
}

/**
 * True when the linear order should be kept after a pretest: the server did not say whether the next chapter was probed
 * (an older server), and another pretest follows. Jumping to the lesson then would leave the later pretests never taken.
 */
export function keepPretestOrder(map: CourseMap, scenes: SceneInfo[], currentId: string, decision: RouteDecision): boolean {
  if (decision.pretested !== undefined || map.roles[currentId]?.role !== 'pretest') return false;
  const following = scenes[scenes.findIndex(scene => scene.id === currentId) + 1];
  return !!following && map.roles[following.id]?.role === 'pretest';
}

/** Linear order that never drops into a variant lesson the router did not pick. Null when the very next scene is fine as it is. */
export function fallbackNext(map: CourseMap, scenes: SceneInfo[], currentId: string | null): string | null {
  if (!map.active || !currentId) return null;
  const index = scenes.findIndex(scene => scene.id === currentId);
  const next = index >= 0 ? scenes[index + 1] : undefined;
  if (!next || map.roles[next.id]?.role !== 'variant') return null;
  return scenes.slice(index + 1).find(scene => map.roles[scene.id]?.role !== 'variant')?.id ?? null;
}

/** Previous follows the learning path, so a checkpoint never opens an unchosen neighbouring variant. */
export function previousTarget(map: CourseMap, scenes: SceneInfo[], currentId: string | null, visited: Record<string, string> = {}): string | null {
  if (!map.active || !currentId) return null;
  const index = scenes.findIndex(scene => scene.id === currentId);
  if (index < 0) return null;
  const path = pathOf(map, currentId), at = path ? path.indexOf(currentId) : -1;
  if (path && at > 0) return path[at - 1];
  const role = map.roles[currentId];
  if (role?.role === 'checkpoint' || role?.role === 'variant') {
    const standard = map.chapters.find(chapter => chapter.id === role.chapter)?.id;
    const previous = role.role === 'checkpoint' ? visited[role.chapter] : undefined;
    const previousRole = previous ? map.roles[previous] : undefined;
    if (previous && previousRole?.chapter === role.chapter && (previousRole.role === 'content' || previousRole.role === 'variant')) return previous;
    if (!standard) return null;
    return role.role === 'checkpoint' ? lessonScenes(map, standard).at(-1) ?? standard : standard;
  }
  return scenes.slice(0, index).reverse().find(scene => map.roles[scene.id]?.role !== 'variant')?.id ?? null;
}

/** What to tell a learner who finished every chapter: how many they hold, and which are worth another look. */
export function progressNote(progress: { total: number; done: number; shaky: string[] } | null, titleOf: (id: string) => string): string {
  if (!progress || !progress.total) return '全部章節完成';
  const review = progress.shaky.map(titleOf).filter(Boolean);
  return `全部章節完成，掌握 ${progress.done} / ${progress.total} 章${review.length ? `；建議再複習：${review.join('、')}` : ''}`;
}
