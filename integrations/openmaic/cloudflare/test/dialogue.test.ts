import { afterEach, expect, test, vi } from 'vitest';
import { PlaybackEngine } from '@/lib/playback/engine';
import { splitDialogue } from '@/lib/study-classroom/dialogue';
import type { Scene } from '@/lib/types/stage';
import type { ActionEngine } from '@/lib/action/engine';
import type { AudioPlayer } from '@/lib/utils/audio-player';

vi.mock('@/lib/store/canvas', () => ({ useCanvasStore: { getState: () => ({ pauseVideo: vi.fn(), setWhiteboardOpen: vi.fn() }) } }));
const engines: PlaybackEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.stop()); vi.useRealTimers(); });
function setup() {
  const action = { execute: vi.fn(async () => {}), clearEffects: vi.fn(), resetPlaybackVisualState: vi.fn() };
  const audio = { play: vi.fn(), onEnded: vi.fn(), stop: vi.fn(), pause: vi.fn(), isPlaying: () => false, hasActiveAudio: () => false };
  const speech = vi.fn(), complete = vi.fn();
  const scene = { id: 'manual', type: 'slide', actions: [
    { id: 'a', type: 'speech', text: '先看定義。再看例子。' },
    { id: 'board', type: 'wb_draw_text', content: '原生白板', x: 10, y: 10 },
    { id: 'b', type: 'speech', text: '最後檢核。' },
  ] } as Scene;
  const engine = new PlaybackEngine([scene], action as unknown as ActionEngine, audio as unknown as AudioPlayer, { manualNarration: true, onSpeechStart: speech, onComplete: complete });
  engines.push(engine); return { engine, action, audio, speech, complete };
}
test('手動教學不啟動音訊或計時；每次點擊僅前進一句，原生白板依序執行', async () => {
  vi.useFakeTimers();
  const { engine, speech, audio, action, complete } = setup();
  engine.start();
  expect(speech).toHaveBeenLastCalledWith('先看定義。');
  await vi.advanceTimersByTimeAsync(120000);
  expect(speech).toHaveBeenCalledTimes(1); expect(audio.play).not.toHaveBeenCalled(); expect(audio.onEnded).not.toHaveBeenCalled();
  expect(engine.advanceNarration()).toBe(true);
  expect(speech).toHaveBeenLastCalledWith('再看例子。'); expect(action.execute).not.toHaveBeenCalled();
  engine.advanceNarration(); await vi.runAllTimersAsync();
  expect(action.execute).toHaveBeenCalledTimes(1); expect(speech).toHaveBeenLastCalledWith('最後檢核。'); expect(complete).not.toHaveBeenCalled();
  engine.advanceNarration(); expect(complete).toHaveBeenCalledOnce(); expect(engine.advanceNarration()).toBe(false);
});
test('暫停與繼續保留當句；停止後舊點擊不消耗新播放位置', () => {
  const { engine, speech } = setup(); engine.start(); engine.pause();
  expect(engine.advanceNarration()).toBe(false); engine.resume(); expect(speech).toHaveBeenCalledTimes(1);
  engine.advanceNarration(); expect(speech).toHaveBeenLastCalledWith('再看例子。');
  engine.stop(); expect(engine.advanceNarration()).toBe(false); engine.start(); expect(speech).toHaveBeenLastCalledWith('先看定義。');
});
test('提問中不消耗教學對話', () => {
  const { engine, speech } = setup(); engine.start(); engine.handleUserInterrupt('為什麼？');
  expect(engine.getMode()).toBe('live'); expect(engine.advanceNarration()).toBe(false); expect(speech).toHaveBeenCalledTimes(1);
});
test('跳至另一動作後不重播上一段剩餘句子', async () => {
  const { engine, speech, complete } = setup(); engine.start(); engine.advanceNarration();
  expect(await engine.jumpToAction(2, { autoplay: true })).toBe(true);
  expect(speech).toHaveBeenLastCalledWith('最後檢核。');
  engine.advanceNarration(); expect(complete).toHaveBeenCalledOnce();
});
test('切句保留小數、公式和程式碼', () => {
  const text = '取 x = 1.5。公式 $f(x)=1.5x+2$。接著看 $$a. b. c$$。最後 `x.y()`。';
  const lines = splitDialogue(text);
  expect(lines).toEqual(['取 x = 1.5。', '公式 $f(x)=1.5x+2$。', '接著看 $$a. b. c$$。', '最後 `x.y()`。']);
  expect(splitDialogue('   ')).toEqual(['']);
});
