import { useEffect, useState } from "react";

export const PRACTICE_MOTION = ["system", "full", "subtle", "off"] as const;
export const PRACTICE_SOUND = ["clear", "soft"] as const;

export type PracticeSettings = {
  soundEnabled: boolean;
  volume: number;
  sound: (typeof PRACTICE_SOUND)[number];
  motion: (typeof PRACTICE_MOTION)[number];
};

const SETTINGS_KEY = "study-practice-settings";
const defaults: PracticeSettings = { soundEnabled: true, volume: 75, sound: "clear", motion: "system" };

function readSettings(): PracticeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<PracticeSettings>;
    return {
      soundEnabled: typeof saved.soundEnabled === "boolean" ? saved.soundEnabled : localStorage.getItem("study-practice-sound") !== "off",
      volume: typeof saved.volume === "number" && Number.isFinite(saved.volume) ? Math.round(Math.max(0, Math.min(100, saved.volume))) : defaults.volume,
      sound: PRACTICE_SOUND.includes(saved.sound!) ? saved.sound! : defaults.sound,
      motion: PRACTICE_MOTION.includes(saved.motion!) ? saved.motion! : defaults.motion,
    };
  } catch { return defaults; }
}

export function usePracticeSettings() {
  const [settings, setSettings] = useState(readSettings);
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Storage can be disabled. */ }
  }, [settings]);
  return [settings, setSettings] as const;
}

export function sheetAnimation(motion: PracticeSettings["motion"]) {
  if (motion === "off") return "none";
  if (motion === "subtle") return "reduced";
  return undefined;
}
