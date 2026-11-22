import { SpeakerHigh } from "@phosphor-icons/react";
import { Sheet } from "../../components/ui";
import { PRACTICE_MOTION, PRACTICE_SOUND, sheetAnimation, type PracticeSettings } from "./settings";

const MOTION_LABELS: Record<PracticeSettings["motion"], string> = {
  system: "跟隨系統", full: "完整", subtle: "精簡", off: "關閉",
};
const SOUND_LABELS: Record<PracticeSettings["sound"], string> = { clear: "清脆", soft: "柔和" };

export function PracticeSettingsSheet({ open, settings, onChange, onClose, preview }: {
  open: boolean;
  settings: PracticeSettings;
  onChange: (patch: Partial<PracticeSettings>) => void;
  onClose: () => void;
  preview: () => void;
}) {
  return <Sheet open={open} onClose={onClose} title="音效與動畫" animation={sheetAnimation(settings.motion)}>
    <div className="practice-settings">
      <label className="practice-settings-row">
        <strong>複習音效</strong>
        <input type="checkbox" role="switch" data-practice-sound-toggle="" checked={settings.soundEnabled} onChange={event => onChange({ soundEnabled: event.target.checked })} />
      </label>
      <label className="practice-volume">
        <span>音量 <output>{settings.volume}%</output></span>
        <input type="range" aria-label="音量" min="0" max="100" step="5" value={settings.volume} disabled={!settings.soundEnabled}
          onChange={event => onChange({ volume: Number(event.target.value) })} />
      </label>
      <fieldset className="practice-config-field" disabled={!settings.soundEnabled}>
        <legend>音色</legend>
        <div className="practice-segments">
          {PRACTICE_SOUND.map(sound => <label key={sound}><input type="radio" name="practice-sound-style" checked={settings.sound === sound} onChange={() => onChange({ sound })} />{SOUND_LABELS[sound]}</label>)}
        </div>
      </fieldset>
      <button type="button" className="practice-audio-preview" data-practice-sound-preview="" onClick={preview} disabled={!settings.soundEnabled || !settings.volume}><SpeakerHigh size={18} />試聽音效</button>
      <fieldset className="practice-config-field">
        <legend>動畫</legend>
        <div className="practice-segments">
          {PRACTICE_MOTION.map(motion => <label key={motion}><input type="radio" name="practice-motion" checked={settings.motion === motion} onChange={() => onChange({ motion })} />{MOTION_LABELS[motion]}</label>)}
        </div>
      </fieldset>
    </div>
  </Sheet>;
}
