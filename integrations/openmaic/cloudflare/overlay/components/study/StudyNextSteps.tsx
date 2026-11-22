'use client';
import { useStudyApp } from './StudyAppContext';
import './classroom.css';

/** Navigation belongs to the parent page; generated modules remain sandboxed. */
export function StudyNextSteps({ complete = false, onReview }: { complete?: boolean; onReview?: () => void }) {
  const hosted = useStudyApp();
  if (!hosted && !complete) return null;
  return <nav className="study-next-steps" aria-label="課後學習">
    <div><b>{complete ? '已到課程最後一頁' : '把今天的理解留下來'}</b><span>{hosted ? '先用字卡回想重點，再用試題檢查掌握程度。' : '回想這次學到的重點，還不熟悉的章節可以再看一次。'}</span></div>
    {complete && onReview && <button type="button" onClick={onReview}>回看課程</button>}
    {hosted && <><a href="/decks">字卡複習 <span aria-hidden="true">→</span></a><a href="/exams">模擬試題 <span aria-hidden="true">→</span></a></>}
    <a href="/">{hosted ? '返回 STUDY' : '返回首頁'}</a>
  </nav>;
}
