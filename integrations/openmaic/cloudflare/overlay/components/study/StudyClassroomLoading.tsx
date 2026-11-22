'use client';
import { useEffect, useState } from 'react';
import { tipAt } from '@/lib/study-classroom/tips';
import './classroom.css';

/** Honest about the wait: the first open after a quiet period starts the service; later opens are quick. */
export function loadingMessage(seconds: number, ready: boolean): string {
  if (ready) return '教材讀好了，正在排好第一頁。';
  if (seconds < 5) return '正在讀取你的課堂。';
  if (seconds < 25) return '首次開啟需要啟動課堂服務，約 20 到 30 秒；之後會快很多。這個步驟不會呼叫 AI。';
  return '比平常久一點，還在連線。已儲存的教材與作答都會保留，不用重複點擊。';
}

const STEPS = ['課堂介面已就緒', '讀取預先生成的教材', '準備第一頁'] as const;

export function StudyClassroomLoading({ ready = false, onRetry }: { ready?: boolean; onRetry?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [tip, setTip] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { const timer = setInterval(() => setTip(value => value + 1), 6500); return () => clearInterval(timer); }, []);
  const current = ready ? 2 : 1;
  return <main className="study-load" aria-busy="true">
    <div className="study-load-inner">
      <p className="study-load-eyebrow">STUDY 課堂</p>
      <div className="study-load-head"><h1 role="status">{ready ? '正在準備課堂畫面' : '正在讀取你的課堂'}</h1><span aria-hidden="true">已等待 {elapsed} 秒</span></div>
      <div className="study-load-grid">
        <div className="study-load-preview" aria-hidden="true">
          <div className="study-load-bar study-load-bar-title" /><div className="study-load-card"><span className="study-load-bar" /><span className="study-load-bar study-load-bar-short" /><span className="study-load-bar" /></div>
          <div className="study-load-figure" /><div className="study-load-dock"><span className="study-load-bar" /><span className="study-load-pill" /></div>
        </div>
        <div className="study-load-side">
          <ol className="study-load-steps" aria-label="準備進度">
            {STEPS.map((label, index) => {
              const state = index < current ? 'done' : index === current ? 'current' : 'todo';
              return <li key={label} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="study-load-mark">{state === 'done' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}</span>
                <span className="study-load-label">{label}{state === 'current' ? '…' : ''}{state === 'current' && <i aria-hidden="true" className="study-load-shimmer" />}</span>
              </li>;
            })}
          </ol>
          <p className="study-load-message" role="status">{loadingMessage(elapsed, ready)}</p>
          <div className="study-load-tip"><p>學習小提示</p><p key={tip}>{tipAt(tip)}</p></div>
        </div>
      </div>
      {elapsed >= 20 && <div className="study-load-actions">{onRetry && <button type="button" onClick={onRetry}>重新讀取</button>}<a href="/">先返回 STUDY</a></div>}
    </div>
  </main>;
}
