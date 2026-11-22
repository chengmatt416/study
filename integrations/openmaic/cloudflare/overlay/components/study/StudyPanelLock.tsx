'use client';
import { Lock, Play } from 'lucide-react';
import { unlockStudyPanel, useStudyPanelLock } from '@/lib/study-classroom/lock';
import './classroom.css';

/** Covers an interactive panel until the teacher's dialogue says to operate it. The panel stays visible but cannot be touched. */
export function StudyPanelLock({ sceneId }: { sceneId: string }) {
  const lock = useStudyPanelLock(sceneId);
  const waiting = lock?.phase === 'waiting';
  return <div className="study-panel-lock" data-locked={lock ? 'true' : 'false'} aria-hidden={lock ? undefined : 'true'}>
    {lock && <div className="study-panel-lock-card" role="status">
      <span className="study-panel-lock-icon" aria-hidden="true">{waiting ? <Play size={18} /> : <Lock size={18} />}</span>
      <div className="study-panel-lock-text">
        <b>{waiting ? '按「開始學習」跟著老師操作' : '先聽老師說明'}</b>
        <span>{waiting ? '老師會一步步告訴你什麼時候動手' : '說到要你動手時，這個面板就會解鎖'}</span>
      </div>
      <button type="button" className="study-panel-lock-skip" onClick={() => unlockStudyPanel(sceneId)}>先自己試試</button>
    </div>}
  </div>;
}
