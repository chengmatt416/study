'use client';
// Read-aloud with the browser's own speech synthesis (no server, no model). The learner turns it on and picks a voice.
// On a slide, when a sentence has been read the lesson moves on to the next sentence by itself, but never to the next
// slide; on interactive modules and quizzes it only reads, and the learner continues by hand.
import { useSyncExternalStore } from 'react';

export interface TtsSettings { on: boolean; voiceURI: string | null; rate: number }
const KEY = 'study-tts';
const DEFAULTS: TtsSettings = { on: false, voiceURI: null, rate: 1 };
export const TTS_RATES = [0.8, 1, 1.2, 1.4] as const;

let settings: TtsSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();
function load() {
  if (loaded) return; loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TtsSettings> | null;
    if (saved) settings = { on: saved.on === true, voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI : null, rate: TTS_RATES.includes(saved.rate as never) ? saved.rate as number : 1 };
  } catch { /* storage blocked: defaults */ }
}
export function setTts(patch: Partial<TtsSettings>) {
  load();
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* not remembered */ }
  if (!settings.on) stopSpeaking();
  listeners.forEach((listener) => listener());
}
export function useStudyTts(): TtsSettings {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => { load(); return settings; }, () => DEFAULTS);
}
export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

/** Only slides continue by themselves, and only within the slide: the last sentence leaves the move to the next slide to the learner. */
export function shouldAutoAdvance(state: { sceneType: string | undefined; started: boolean; done: boolean; canContinue: boolean }): boolean {
  return state.sceneType === 'slide' && state.started && !state.done && state.canContinue;
}

const GREEK: Record<string, string> = { alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta', theta: 'theta', lambda: 'lambda', mu: 'mu', pi: 'pi', sigma: 'sigma', omega: 'omega', Omega: 'omega', rho: 'rho', epsilon: 'epsilon' };
/** What to say for a line of Markdown with LaTeX: no symbols read out as punctuation, math written in words a voice can say. */
export function speakableText(markdown: string): string {
  const math = (tex: string) => tex
    .replace(/\\(?:ce|text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1 / $2')
    .replace(/\\sqrt\{([^{}]*)\}/g, '根號 $1')
    .replace(/\^\{?2\}?/g, ' 平方').replace(/\^\{?3\}?/g, ' 立方').replace(/\^\{([^{}]*)\}|\^(\S)/g, ' 的 $1$2 次方')
    .replace(/_\{([^{}]*)\}|_(\S)/g, ' $1$2')
    .replace(/\\times|\\cdot/g, ' 乘 ').replace(/\\div/g, ' 除以 ').replace(/\\approx/g, ' 約等於 ').replace(/\\(?:leq?|le)\b/g, ' 小於等於 ').replace(/\\(?:geq?|ge)\b/g, ' 大於等於 ').replace(/\\(?:rightarrow|to)\b/g, ' 變成 ')
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => GREEK[name] ?? ' ')
    .replace(/=/g, ' 等於 ').replace(/[{}]/g, ' ');
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$((?:\\.|[^$\n])+)\$/g, (_, a, b, c, d) => math(a ?? b ?? c ?? d ?? ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1').replace(/[*_~#>|]/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Voices for the picker: the lesson language first (Chinese), then English, then the rest. */
export function rankVoices<V extends { lang: string; name: string; localService?: boolean }>(voices: readonly V[]): V[] {
  const rank = (voice: V) => /^zh[-_](TW|Hant)/i.test(voice.lang) ? 0 : /^zh/i.test(voice.lang) ? 1 : /^en/i.test(voice.lang) ? 2 : 3;
  return [...voices].sort((a, b) => rank(a) - rank(b) || Number(!!b.localService) - Number(!!a.localService) || a.name.localeCompare(b.name));
}

let current: SpeechSynthesisUtterance | null = null;
export function stopSpeaking() {
  if (!ttsSupported()) return;
  current = null;
  window.speechSynthesis.cancel();
}
/** Reads one sentence; onEnd runs only when this sentence finished on its own (not when it was cut off). */
export function speak(text: string, options: { voiceURI: string | null; rate: number; onEnd?: () => void }) {
  if (!ttsSupported()) return;
  const words = speakableText(text);
  window.speechSynthesis.cancel();
  if (!words) { options.onEnd?.(); return; }
  const utterance = new SpeechSynthesisUtterance(words);
  const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === options.voiceURI);
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else utterance.lang = 'zh-TW';
  utterance.rate = options.rate;
  current = utterance;
  utterance.onend = () => { if (current === utterance) { current = null; options.onEnd?.(); } };
  utterance.onerror = () => { if (current === utterance) current = null; };
  window.speechSynthesis.speak(utterance);
}
