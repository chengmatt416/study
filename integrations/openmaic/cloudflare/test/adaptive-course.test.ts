import { expect, test } from 'vitest';
import { applyDecision, buildCourseMap, fallbackNext, keepPretestOrder, lessonScenes, misconceptionOf, parseTitle, progressNote, quickDetourTarget, routeStep, strandedScenes, type RouteDecision, type SceneInfo } from '@/lib/study-classroom/course-map';

const scene = (id: string, title: string, type = 'slide'): SceneInfo => ({ id, title, type });
const course: SceneInfo[] = [
  scene('intro', '課程介紹'),
  scene('p1', '先測：能量', 'quiz'), scene('p2', '先測：波', 'quiz'),
  scene('e', '能量'), scene('er', '能量〔補強〕'), scene('eq', '能量〔精簡〕'), scene('ec', '檢核：能量', 'quiz'),
  scene('w', '波'), scene('wc', '檢核：波', 'quiz'),
  scene('end', '總結'),
];
const decision = (over: Partial<RouteDecision>): RouteDecision => ({ next: 'e', variant: 'standard', detail: 'standard', skip: [], focus: [], ...over });

test('reads roles and variants from readable scene titles', () => {
  expect(parseTitle('先測： 能量')).toEqual({ role: 'pretest', key: '能量' });
  expect(parseTitle('能量 〔補強〕')).toEqual({ role: 'content', key: '能量', variant: 'remedial' });
  expect(parseTitle('一般章節')).toEqual({ role: 'content', key: '一般章節' });
  const map = buildCourseMap(course);
  expect(map.active).toBe(true);
  expect(map.chapters.map(chapter => [chapter.id, chapter.checkpoint, chapter.variants])).toEqual([['e', 'ec', { remedial: 'er', quick: 'eq' }], ['w', 'wc', {}]]);
  expect(map.roles.p1).toEqual({ role: 'pretest', chapter: 'e' });
  expect(map.roles.er).toEqual({ role: 'variant', chapter: 'e' });
  expect(map.roles.intro).toBeUndefined();
});

test('stays inactive for ordinary courses and for titles that match no chapter', () => {
  expect(buildCourseMap([scene('a', '甲'), scene('b', '乙'), scene('q', '小測', 'quiz')]).active).toBe(false);
  expect(buildCourseMap([scene('a', '甲'), scene('q', '先測：不存在', 'quiz')]).active).toBe(false);
  expect(routeStep(buildCourseMap([scene('a', '甲')]), [scene('a', '甲')], 'a')).toEqual({ target: null, needsRoute: false });
});

test('reads misconception tags from question ids', () => {
  expect(misconceptionOf('q1__m_sign-error')).toBe('sign-error');
  expect(misconceptionOf('q1')).toBeNull();
});

test('moves lesson to its checkpoint, and asks the router only where the choice matters', () => {
  const map = buildCourseMap(course);
  expect(routeStep(map, course, 'intro')).toEqual({ target: null, needsRoute: false });
  expect(routeStep(map, course, 'p1')).toEqual({ target: null, needsRoute: true });
  expect(routeStep(map, course, 'p2')).toEqual({ target: null, needsRoute: true });
  expect(routeStep(map, course, 'e')).toEqual({ target: 'ec', needsRoute: false });
  expect(routeStep(map, course, 'er')).toEqual({ target: 'ec', needsRoute: false });
  expect(routeStep(map, course, 'ec')).toEqual({ target: null, needsRoute: true });
  expect(routeStep(map, course, 'wc')).toEqual({ target: null, needsRoute: true });
});

test('opens the variant the decision picks and falls back to the standard lesson', () => {
  const map = buildCourseMap(course);
  expect(applyDecision(map, course, 'p2', decision({}))).toBe('e');
  expect(applyDecision(map, course, 'ec', decision({ variant: 'remedial' }))).toBe('er');
  expect(applyDecision(map, course, 'p2', decision({ next: 'w', variant: 'remedial' }))).toBe('w');
  expect(applyDecision(map, course, 'p2', decision({ next: 'w', skip: ['e'] }))).toBe('w');
  expect(applyDecision(map, course, 'ghost', decision({ next: 'nope' }))).toBeNull();
});

test('takes each pretest right before its own chapter instead of all of them before the first lesson', () => {
  const map = buildCourseMap(course);
  expect(map.chapters.map(chapter => chapter.pretest)).toEqual(['p1', 'p2']);
  // After the first pretest the learner goes to that chapter, past the second chapter's pretest.
  expect(applyDecision(map, course, 'p1', decision({ pretested: true }))).toBe('e');
  // The next chapter has not been probed: its pretest comes first, then its lesson.
  expect(applyDecision(map, course, 'ec', decision({ next: 'w', pretested: false }))).toBe('p2');
  expect(applyDecision(map, course, 'p2', decision({ next: 'w', pretested: true }))).toBe('w');
  // A pretest left unanswered does not trap the learner on it, and a chapter without a pretest is simply taught.
  expect(applyDecision(map, course, 'p2', decision({ next: 'w', pretested: false }))).toBe('w');
  const bare = course.filter(item => item.id !== 'p2');
  expect(applyDecision(buildCourseMap(bare), bare, 'ec', decision({ next: 'w', pretested: false }))).toBe('w');
  // Testing out of a chapter still goes straight to its checkpoint.
  expect(applyDecision(map, course, 'e', decision({ next: 'w', pretested: false, challenge: true }))).toBe('wc');
});

test('keeps the old pretest order when the server does not say whether the next chapter was probed', () => {
  const map = buildCourseMap(course);
  expect(keepPretestOrder(map, course, 'p1', decision({}))).toBe(true);
  expect(keepPretestOrder(map, course, 'p2', decision({}))).toBe(false);
  expect(keepPretestOrder(map, course, 'p1', decision({ pretested: true }))).toBe(false);
  expect(keepPretestOrder(map, course, 'ec', decision({}))).toBe(false);
});

test('finishing every chapter continues to scenes that are not part of the chapters', () => {
  const map = buildCourseMap(course);
  expect(applyDecision(map, course, 'wc', decision({ next: null }))).toBe('end');
  expect(applyDecision(map, course, 'end', decision({ next: null }))).toBeNull();
  const noTail = course.slice(0, -1);
  expect(applyDecision(buildCourseMap(noTail), noTail, 'wc', decision({ next: null }))).toBeNull();
});

test('when routing cannot answer, the fallback never drops into a variant lesson', () => {
  const map = buildCourseMap(course);
  // Linear order after "e" is its remedial and quick variants; the fallback skips both and lands on the checkpoint.
  expect(fallbackNext(map, course, 'e')).toBe('ec');
  expect(fallbackNext(map, course, 'w')).toBeNull();
  const direct: SceneInfo[] = [scene('e', '能量'), scene('er', '能量〔補強〕'), scene('eq', '能量〔精簡〕'), scene('ec', '檢核：能量', 'quiz'), scene('w', '波'), scene('wc', '檢核：波', 'quiz')];
  expect(fallbackNext(buildCourseMap(direct), direct, 'e')).toBe('ec');
  expect(fallbackNext(buildCourseMap(direct), direct, 'er')).toBe('ec');
  expect(fallbackNext(buildCourseMap(direct), direct, 'ec')).toBeNull();
  expect(fallbackNext(buildCourseMap([scene('a', '甲'), scene('b', '乙')]), [scene('a', '甲'), scene('b', '乙')], 'a')).toBeNull();
  expect(fallbackNext(map, course, null)).toBeNull();
});

test('tells a learner who finished what they hold and what to revisit', () => {
  const title = (id: string) => ({ e: '能量', w: '波' }[id] ?? '');
  expect(progressNote({ total: 2, done: 2, shaky: [] }, title)).toBe('全部章節完成，掌握 2 / 2 章');
  expect(progressNote({ total: 2, done: 1, shaky: ['e', 'w'] }, title)).toBe('全部章節完成，掌握 1 / 2 章；建議再複習：能量、波');
  expect(progressNote(null, title)).toBe('全部章節完成');
  expect(progressNote({ total: 0, done: 0, shaky: [] }, title)).toBe('全部章節完成');
});

test('only a quick lesson sends the learner back to the standard lesson', () => {
  const map = buildCourseMap(course);
  expect(quickDetourTarget(map, 'eq')).toBe('e');
  expect(quickDetourTarget(map, 'e')).toBeNull();
  expect(quickDetourTarget(map, 'er')).toBeNull();
  expect(quickDetourTarget(map, 'ec')).toBeNull();
  expect(quickDetourTarget(map, 'intro')).toBeNull();
  expect(quickDetourTarget(buildCourseMap([scene('a', '甲'), scene('b', '乙')]), 'a')).toBeNull();
});

// A chapter taught over several scenes: every one is on the way to the checkpoint, whatever it was titled.
const pages = [
  scene('p1', '先測：能量', 'quiz'), scene('p2', '先測：波', 'quiz'),
  scene('e1', '能量'), scene('e2', '能量｜功與能'), scene('ei', '能量｜動手做', 'interactive'), scene('e3', '能量的例題（沒照命名）'), scene('ec', '檢核：能量', 'quiz'),
  scene('er1', '能量〔補強〕'), scene('er2', '能量〔補強〕｜再練一次'), scene('eq1', '能量〔精簡〕'), scene('eq2', '能量〔精簡〕｜考試陷阱'),
  scene('w1', '波'), scene('w2', '波'), scene('wc', '檢核：波', 'quiz'),
  scene('end', '課後：字卡與模考', 'interactive'),
];
test('walks every lesson scene in order before the checkpoint', () => {
  const map = buildCourseMap(pages);
  expect(map.chapters.map(chapter => chapter.id)).toEqual(['e1', 'w1']);
  expect(lessonScenes(map, 'e1')).toEqual(['e1', 'e2', 'ei', 'e3']);
  expect(lessonScenes(map, 'w1')).toEqual(['w1', 'w2']);
  for (const [from, to] of [['e1', 'e2'], ['e2', 'ei'], ['ei', 'e3'], ['e3', 'ec'], ['w1', 'w2'], ['w2', 'wc']]) expect(routeStep(map, pages, from), from).toEqual({ target: to, needsRoute: false });
  for (const id of ['e2', 'ei', 'e3']) expect(map.roles[id]).toEqual({ role: 'content', chapter: 'e1' });
  expect(strandedScenes(map, pages)).toEqual([]);
});
test('walks a variant the same way and keeps the router choosing between chapters by their first scene', () => {
  const map = buildCourseMap(pages);
  expect(routeStep(map, pages, 'er1')).toEqual({ target: 'er2', needsRoute: false });
  expect(routeStep(map, pages, 'er2')).toEqual({ target: 'ec', needsRoute: false });
  expect(routeStep(map, pages, 'eq1')).toEqual({ target: 'eq2', needsRoute: false });
  expect(map.chapters[0].variants).toEqual({ remedial: 'er1', quick: 'eq1' });
  const decision = (variant: RouteDecision['variant']): RouteDecision => ({ next: 'e1', variant, detail: 'standard', skip: [], focus: [] });
  expect(applyDecision(map, pages, 'ec', decision('remedial'))).toBe('er1');
  expect(applyDecision(map, pages, 'p2', decision('standard'))).toBe('e1');
});
test('sends every scene of a quick path to the standard lesson for a detour', () => {
  const map = buildCourseMap(pages);
  expect(quickDetourTarget(map, 'eq1')).toBe('e1');
  expect(quickDetourTarget(map, 'eq2')).toBe('e1');
  expect(quickDetourTarget(map, 'er2')).toBeNull();
});
test('reports an unlabelled scene left between two chapters, but not the opening or closing', () => {
  const stray = [scene('intro', '課程介紹'), ...pages.slice(0, 11), scene('gap', '單元補充'), ...pages.slice(11)];
  const map = buildCourseMap(stray);
  expect(strandedScenes(map, stray).map(item => item.id)).toEqual(['gap']);
  expect(strandedScenes(buildCourseMap([scene('a', '甲'), scene('b', '乙')]), [scene('a', '甲'), scene('b', '乙')])).toEqual([]);
});
test('does not claim scenes for a chapter whose checkpoint comes first', () => {
  const backwards = [scene('k', '檢核：甲', 'quiz'), scene('x', '別的內容'), scene('a', '甲')];
  const map = buildCourseMap(backwards);
  expect(lessonScenes(map, 'a')).toEqual(['a']);
  expect(map.roles.x).toBeUndefined();
});
test('only full-width bars split a section, so an ordinary pipe in a title stays part of it', () => {
  expect(parseTitle('能量｜功與能')).toEqual({ role: 'content', key: '能量' });
  expect(parseTitle('能量〔補強〕｜再練')).toEqual({ role: 'content', key: '能量', variant: 'remedial' });
  expect(parseTitle('NTHU | 離散')).toEqual({ role: 'content', key: 'NTHU | 離散' });
});
