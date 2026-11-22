import { useEffect, useRef } from "react";
import type { PracticeSettings } from "./settings";

const MELODIES = {
  click: [[659, 0]],
  correct: [[587, 0], [784, 0.09]],
  streak: [[587, 0], [784, 0.08], [988, 0.16]],
  retry: [[440, 0], [392, 0.10]],
  reveal: [[523, 0]],
} as const;

export function usePracticeSound(settings: PracticeSettings) {
  const sound = useRef<{ context: AudioContext; output: GainNode } | null>(null);
  const latest = useRef(settings);
  latest.current = settings;

  useEffect(() => () => {
    const active = sound.current;
    sound.current = null;
    // Let the navigation click finish after the practice page unmounts.
    if (active) window.setTimeout(() => { void active.context.close().catch(() => {}); }, 150);
  }, []);
  useEffect(() => {
    const active = sound.current;
    if (active) active.output.gain.value = settings.soundEnabled ? settings.volume / 100 : 0;
  }, [settings.soundEnabled, settings.volume]);

  // Call from a tap or key press to unlock Web Audio before the answer request.
  function prepare({ soundEnabled, volume } = latest.current) {
    if (!soundEnabled || !volume) return;
    try {
      if (!sound.current) {
        const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Audio) return;
        const context = new Audio();
        const output = context.createGain();
        output.connect(context.destination);
        sound.current = { context, output };
      }
      sound.current.output.gain.value = volume / 100;
      if (sound.current.context.state !== "running") void sound.current.context.resume().catch(() => {});
      return sound.current;
    } catch {
      // Feedback remains available on devices that block Web Audio.
    }
  }

  function play(cue: keyof typeof MELODIES, settings = latest.current) {
    const active = prepare(settings);
    if (!active) return;
    const { context, output } = active;
    const now = context.currentTime;
    const soft = settings.sound === "soft";
    const click = cue === "click";
    const attack = click ? (soft ? 0.012 : 0.006) : (soft ? 0.035 : 0.015);
    const release = click ? (soft ? 0.10 : 0.07) : (soft ? 0.28 : 0.22);
    try {
      for (const [frequency, delay] of MELODIES[cue]) {
        const start = now + delay;
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = soft ? "sine" : "triangle";
        oscillator.frequency.value = frequency * (soft ? 0.8 : 1);
        envelope.gain.setValueAtTime(0, start);
        envelope.gain.linearRampToValueAtTime(click ? 0.085 : 0.15, start + attack);
        envelope.gain.exponentialRampToValueAtTime(0.001, start + release);
        oscillator.connect(envelope).connect(output);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + (click ? release + 0.01 : 0.29));
      }
    } catch {
      // Audio can be interrupted by the operating system during feedback.
    }
  }

  return { prepare, play };
}
