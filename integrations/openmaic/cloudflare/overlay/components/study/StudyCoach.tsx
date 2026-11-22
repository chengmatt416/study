'use client';

import { Streamdown } from 'streamdown';
import { X } from 'lucide-react';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import { studyCoachTarget } from '@/lib/study-classroom/adaptive';
import { dismissStudyCoach, useStudyCoach } from '@/lib/study-classroom/coach';
import './classroom.css';

const plugins = { math: createSafeMathPlugin({ singleDollarTextMath: true }) };

/**
 * The learning coach's place in the classroom, above the lesson dock:
 * - a remark written by hand when an answer is checked (the teacher's mark beside the page);
 * - when the learner keeps getting the same thing wrong, a note: the key idea, a short explanation,
 *   a question to check it clicked, and where to go next. The learner chooses whether to follow it.
 */
export function StudyCoach({ onNavigate }: { onNavigate: (sceneId: string) => void }) {
  const { note, remark } = useStudyCoach();
  const follow = () => { if (!note) return; const target = studyCoachTarget(note); dismissStudyCoach(); if (target) onNavigate(target); };
  return <>
    {remark && !note && <div key={remark.id} className="study-remark" data-tone={remark.tone} aria-hidden="true">{remark.text}</div>}
    {note && <aside className="study-coach" role="status" aria-live="polite" aria-label="學習教練">
      <header className="study-coach-head">
        <span className="study-coach-tag">{note.source === 'model' ? 'AI 學習教練' : '學習教練'}</span>
        <button type="button" className="study-coach-close" aria-label="關閉" onClick={dismissStudyCoach}><X size={16} aria-hidden="true" /></button>
      </header>
      <h3 className="study-coach-headline">{note.headline}</h3>
      <div className="study-coach-text"><Streamdown plugins={plugins}>{note.explanation}</Streamdown></div>
      {note.check && <p className="study-coach-check"><b>想一想：</b>{note.check}</p>}
      {note.aiOff && <p className="study-coach-hint">開啟下方的「課堂 AI」後，教練可以針對這個錯誤解釋原因。</p>}
      <div className="study-coach-actions">
        {note.route !== 'continue' && <button type="button" className="study-coach-go" onClick={follow}>{note.route === 'remedial' ? '看補強版' : '回去看這段講解'}</button>}
        <button type="button" className="study-coach-stay" onClick={dismissStudyCoach}>{note.route === 'continue' ? '懂了，繼續' : '先繼續作答'}</button>
      </div>
    </aside>}
  </>;
}
