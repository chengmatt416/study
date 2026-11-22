'use client';
import { useEffect, useState } from 'react';
import { Check, Eraser, Highlighter, Pen, Trash2, Undo2 } from 'lucide-react';
import { INK_COLORS, inkClear, inkUndo, setInkColor, setInkOn, setInkTool, useStudyInk, type InkColor, type InkTool } from '@/lib/study-classroom/ink';
import './classroom.css';

const TOOLS: { id: InkTool; label: string; icon: typeof Pen }[] = [
  { id: 'pen', label: '筆', icon: Pen }, { id: 'highlighter', label: '螢光筆', icon: Highlighter }, { id: 'eraser', label: '橡皮擦', icon: Eraser },
];

/** The pen's tools: floats above the lesson dock while the learner is writing. */
export function StudyInkBar({ sceneId }: { sceneId: string }) {
  const ink = useStudyInk();
  const count = ink.counts[sceneId] ?? 0;
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const timer = setTimeout(() => setArmed(false), 2600); return () => clearTimeout(timer); }, [armed]);
  useEffect(() => { if (count === 0) setArmed(false); }, [count]);
  return <div className="study-ink-bar" role="toolbar" aria-label="寫字工具">
    <div className="study-ink-group" role="group" aria-label="工具">
      {TOOLS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className="study-ink-btn" aria-pressed={ink.tool === id} aria-label={label} title={label} onClick={() => setInkTool(id)}><Icon size={18} /></button>)}
    </div>
    <span className="study-ink-sep" aria-hidden="true" />
    <div className="study-ink-group" role="group" aria-label="顏色">
      {(Object.keys(INK_COLORS) as InkColor[]).map(color => <button key={color} type="button" className="study-ink-dot" aria-pressed={ink.color === color && ink.tool !== 'eraser'} aria-label={INK_COLORS[color].label} title={INK_COLORS[color].label} style={{ '--ink': INK_COLORS[color].light, '--ink-dark': INK_COLORS[color].dark } as React.CSSProperties} onClick={() => setInkColor(color)} />)}
    </div>
    <span className="study-ink-sep" aria-hidden="true" />
    <div className="study-ink-group">
      <button type="button" className="study-ink-btn" aria-label="復原上一筆" title="復原上一筆" disabled={count === 0} onClick={() => inkUndo(sceneId)}><Undo2 size={18} /></button>
      <button type="button" className="study-ink-btn" data-armed={armed ? 'true' : undefined} aria-label={armed ? '再按一次清除這一頁所有筆跡' : '清除這一頁的筆跡'} title="清除這一頁的筆跡" disabled={count === 0}
        onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); inkClear(sceneId); }}><Trash2 size={18} />{armed && <span className="study-ink-confirm">再按確認</span>}</button>
    </div>
    <button type="button" className="study-ink-done" onClick={() => setInkOn(false)}><Check size={16} />完成</button>
  </div>;
}
