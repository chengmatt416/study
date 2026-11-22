import { expect, test } from 'vitest';
import { STUDY_UNSURE, UNSURE_LABEL, answeredUnsure, sceneOffersUnsure, toggleChoice, withUnsure } from '@/lib/study-classroom/unsure';
import { parseTitle } from '@/lib/study-classroom/course-map';

const single = { id: 'a', type: 'single', options: [{ label: '甲', value: 'A' }, { label: '乙', value: 'B' }] };
const multiple = { id: 'b', type: 'multiple', options: [{ label: '甲', value: 'A' }] };
const text = { id: 'c', type: 'short_answer' };

test('adds "I don\'t know" to choice questions only, once, and leaves the originals alone', () => {
  const shown = withUnsure([single, multiple, text]);
  expect(shown[0].options?.map(option => option.value)).toEqual(['A', 'B', STUDY_UNSURE]);
  expect(shown[0].options?.at(-1)?.label).toBe(UNSURE_LABEL);
  expect(shown[1].options?.at(-1)?.value).toBe(STUDY_UNSURE);
  expect(shown[2]).toBe(text);
  expect(single.options).toHaveLength(2);
  expect(withUnsure(shown)[0].options).toHaveLength(3);
  expect(withUnsure([{ id: 'x', type: 'single', options: [] }])[0].options).toEqual([]);
});

test('only pretest, diagnostic and checkpoint scenes offer it', () => {
  for (const title of ['先測：能量', '前測：能量', '診斷：能量', '檢核：能量', '先測: 能量']) expect(sceneOffersUnsure(title), title).toBe(true);
  for (const title of ['能量', '課堂小測', '能量〔補強〕', '總結']) expect(sceneOffersUnsure(title), title).toBe(false);
  expect(parseTitle('前測：能量')).toEqual({ role: 'pretest', key: '能量' });
  expect(parseTitle('診斷：能量')).toEqual({ role: 'pretest', key: '能量' });
});

test('"I don\'t know" excludes the other choices in a multiple choice question', () => {
  expect(toggleChoice(['A', 'B'], STUDY_UNSURE)).toEqual([STUDY_UNSURE]);
  expect(toggleChoice([STUDY_UNSURE], 'A')).toEqual(['A']);
  expect(toggleChoice(['A'], 'B')).toEqual(['A', 'B']);
  expect(toggleChoice(['A', 'B'], 'A')).toEqual(['B']);
  expect(toggleChoice([STUDY_UNSURE], STUDY_UNSURE)).toEqual([]);
});

test('recognises an unsure answer in either answer shape', () => {
  expect(answeredUnsure(STUDY_UNSURE)).toBe(true);
  expect(answeredUnsure([STUDY_UNSURE])).toBe(true);
  expect(answeredUnsure(['A'])).toBe(false);
  expect(answeredUnsure('A')).toBe(false);
  expect(answeredUnsure(undefined)).toBe(false);
});
