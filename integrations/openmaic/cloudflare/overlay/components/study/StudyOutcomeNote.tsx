import type { StudyOutcome } from '../../lib/study-classroom/completion';

export function StudyOutcomeNote({ outcome, onRetry }: { outcome: StudyOutcome; onRetry?: () => void }) {
  const notes = [
    outcome.unattempted ? `${outcome.unattempted} 份檢核尚未完成` : '',
    outcome.pending ? `${outcome.pending} 份作答結果仍待同步` : '',
    outcome.unavailable ? `${outcome.unavailable} 份檢核結果暫時無法讀取` : '',
    outcome.ungraded ? `${outcome.ungraded} 題仍待比對參考答案或覆核` : '',
  ].filter(Boolean);
  return <div className="study-outcome-note" role="status">
    <b>{outcome.checking ? '正在讀取檢核結果…' : '檢核結果（不含先測）'}</b>
    {!outcome.checking && <p>{notes.length ? notes.join('；') + '。到達最後一頁不代表全部掌握。' : outcome.assessments ? `已完成 ${outcome.reviewed} / ${outcome.assessments} 份檢核；可用新題目再檢查能否獨立應用。` : '本課沒有獨立檢核；請用練習再確認理解。'}</p>}
    {!outcome.checking && (outcome.unavailable > 0 || outcome.pending > 0) && onRetry && <button type="button" onClick={onRetry}>重新讀取檢核結果</button>}
  </div>;
}
