import { expect, test } from 'vitest';
import { rankVoices, shouldAutoAdvance, speakableText } from '@/lib/study-classroom/tts';

test('read-aloud continues by itself only between sentences of a slide', () => {
  const base = { started: true, done: false, canContinue: true };
  expect(shouldAutoAdvance({ ...base, sceneType: 'slide' })).toBe(true);
  // The last sentence of a slide has been read: moving to the next slide is the learner's click.
  expect(shouldAutoAdvance({ ...base, sceneType: 'slide', done: true })).toBe(false);
  // Interactive modules and quizzes are read aloud but never advanced.
  expect(shouldAutoAdvance({ ...base, sceneType: 'interactive' })).toBe(false);
  expect(shouldAutoAdvance({ ...base, sceneType: 'quiz' })).toBe(false);
  // A discussion or the router holds the lesson.
  expect(shouldAutoAdvance({ ...base, sceneType: 'slide', canContinue: false })).toBe(false);
  expect(shouldAutoAdvance({ ...base, sceneType: 'slide', started: false })).toBe(false);
});

test('speaks math and Markdown as words, not symbols', () => {
  expect(speakableText('**動能**是 $E_k = \\frac{1}{2}mv^2$。')).toBe('動能 是 E k 等於 1 / 2mv 平方。');
  expect(speakableText('看 [課本](https://x.test) 與 `code`')).toBe('看 課本 與 code');
  expect(speakableText('$$\\Delta x \\approx 3$$')).toBe('delta x 約等於 3');
});

test('lists Taiwanese Chinese voices first, then other Chinese, then English', () => {
  const voices = [{ name: 'Daniel', lang: 'en-GB' }, { name: 'Tingting', lang: 'zh-CN' }, { name: 'Meijia', lang: 'zh-TW' }, { name: 'Anna', lang: 'de-DE' }];
  expect(rankVoices(voices).map(v => v.name)).toEqual(['Meijia', 'Tingting', 'Daniel', 'Anna']);
});
