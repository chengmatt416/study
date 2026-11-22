import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildCourseMap, previousTarget, type SceneInfo } from '../overlay/lib/study-classroom/course-map';

const fixture = vi.hoisted(() => ({ scenes: [] as { id: string; title: string; type: string }[] }));
vi.mock('@/lib/store/stage', () => ({ useStageStore: { getState: () => fixture } }));
vi.mock('@/lib/study-classroom/operate', () => ({ clearStudyOperate: vi.fn() }));
vi.mock('../overlay/lib/study-classroom/progress', () => ({ saveStudyModule: vi.fn(), savedModuleState: vi.fn(), sceneOfFrame: vi.fn() }));

const scene = (id: string, title: string, type = 'slide'): SceneInfo => ({ id, title, type });
const scenes = [scene('intro', '課程介紹'), scene('ap', '先測：能量', 'quiz'), scene('bp', '先測：波', 'quiz'), scene('a', '能量'), scene('ar', '能量〔補強〕'), scene('aq', '能量〔精簡〕'), scene('ac', '檢核：能量', 'quiz'), scene('b', '波'), scene('br', '波〔補強〕'), scene('bq', '波〔精簡〕'), scene('bc', '檢核：波', 'quiz'), scene('end', '課後：字卡與模考')];
const map = buildCourseMap(scenes);

beforeEach(() => { vi.resetModules(); fixture.scenes = scenes; vi.stubGlobal('location', { pathname: '/classroom/one' }); });
afterEach(() => { vi.unstubAllGlobals(); });

test.each([['intro', null], ['ap', 'intro'], ['bp', 'ap'], ['a', 'bp'], ['ar', 'a'], ['aq', 'a'], ['ac', 'a'], ['b', 'ac'], ['br', 'b'], ['bq', 'b'], ['bc', 'b'], ['end', 'bc'], ['missing', null]])('previous from %s returns %s without choosing an adjacent variant', (current, expected) => {
  expect(previousTarget(map, scenes, current)).toBe(expected);
});

test('a checkpoint returns to the actual lesson variant when known, rejecting another chapter or non-lesson entry', () => {
  expect(previousTarget(map, scenes, 'ac', { a: 'ar' })).toBe('ar');
  expect(previousTarget(map, scenes, 'ac', { a: 'aq' })).toBe('aq');
  expect(previousTarget(map, scenes, 'ac', { a: 'bq' })).toBe('a');
  expect(previousTarget(map, scenes, 'ac', { a: 'ap' })).toBe('a');
  expect(previousTarget(map, scenes, 'ac', { a: 'missing' })).toBe('a');
});

test('chapters without checkpoints and ordinary appendices skip unchosen variants on the way back', () => {
  const withoutCheckpoints = scenes.filter(item => !['ac', 'bc'].includes(item.id));
  const mapped = buildCourseMap(withoutCheckpoints);
  expect(previousTarget(mapped, withoutCheckpoints, 'b')).toBe('a');
  expect(previousTarget(mapped, withoutCheckpoints, 'end')).toBe('b');
  const ordinary = [scene('one', '一般課堂'), scene('two', '下一頁')];
  expect(previousTarget(buildCourseMap(ordinary), ordinary, 'two')).toBeNull();
});

test('remembered lesson choices stay scoped to the current classroom and scene structure', async () => {
  const adaptive = await import('../overlay/lib/study-classroom/adaptive');
  adaptive.rememberStudyLesson('ar');
  expect(adaptive.studyPreviousTarget('ac')).toBe('ar');
  adaptive.rememberStudyLesson('bq');
  expect(adaptive.studyPreviousTarget('ac')).toBe('ar');
  expect(adaptive.studyPreviousTarget('bc')).toBe('bq');
  location.pathname = '/classroom/two';
  expect(adaptive.studyPreviousTarget('ac')).toBe('a');
  adaptive.rememberStudyLesson('aq');
  expect(adaptive.studyPreviousTarget('ac')).toBe('aq');
  fixture.scenes = scenes.map(item => item.id === 'aq' ? { ...item, title: '能量〔延伸〕' } : item);
  expect(adaptive.studyPreviousTarget('ac')).toBe('a');
});

test('steps back through the scenes of a lesson, and from a checkpoint to the last of them', () => {
  const pages = [scene('p', '先測：能量', 'quiz'), scene('a1', '能量'), scene('a2', '能量｜功'), scene('a3', '能量｜動能'), scene('k', '檢核：能量', 'quiz'), scene('r1', '能量〔補強〕'), scene('r2', '能量〔補強〕｜再練')];
  const pagesMap = buildCourseMap(pages);
  expect(previousTarget(pagesMap, pages, 'a3')).toBe('a2');
  expect(previousTarget(pagesMap, pages, 'a2')).toBe('a1');
  expect(previousTarget(pagesMap, pages, 'k')).toBe('a3');
  expect(previousTarget(pagesMap, pages, 'k', { a1: 'r2' })).toBe('r2');
  expect(previousTarget(pagesMap, pages, 'r2')).toBe('r1');
  expect(previousTarget(pagesMap, pages, 'r1')).toBe('a1');
});
