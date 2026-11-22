'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import { useStageStore } from '@/lib/store/stage';
import { useStudyPhone } from '@/lib/study-classroom/phone';
import { discussionLog, logMessageCount, type ChatLike } from '@/lib/study-classroom/discussion';
import './classroom.css';

const plugins = { math: createSafeMathPlugin({ singleDollarTextMath: true }) };
const TYPE_LABEL = { qa: '提問', discussion: '討論' } as const;

/** Everything said in this scene's questions and discussions, newest at the bottom, scrollable. Phone only: the desktop roundtable shows it its own way. */
export function StudyDiscussionLog({ live, streaming }: { live: boolean; streaming: boolean }) {
  const phone = useStudyPhone();
  const chats = useStageStore(state => state.chats) as unknown as ChatLike[];
  const sceneId = useStageStore(state => state.currentSceneId);
  const log = useMemo(() => discussionLog(chats, sceneId), [chats, sceneId]);
  const total = logMessageCount(log);
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [away, setAway] = useState(false);
  const lastText = log.at(-1)?.messages.at(-1)?.text ?? '';
  // Follow the conversation while the learner is at the bottom; once they scroll up to reread, stay put and offer a way down.
  useEffect(() => {
    const node = box.current; if (!node) return;
    if (stuck.current) node.scrollTo({ top: node.scrollHeight, behavior: total <= 1 ? 'auto' : 'smooth' });
    else setAway(true);
  }, [total, lastText, streaming]);
  useEffect(() => { const node = box.current; if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'auto' }); }, [phone]);
  if (!phone) return null;
  const onScroll = () => {
    const node = box.current; if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    stuck.current = atBottom; if (atBottom) setAway(false);
  };
  const down = () => { stuck.current = true; setAway(false); box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' }); };
  const waiting = live && streaming && log.at(-1)?.messages.at(-1)?.role === 'user';
  return <div className="study-discussion-log-wrap">
    <div ref={box} className="study-discussion-log" role="log" aria-label="提問與討論的完整對話" aria-live="polite" tabIndex={0} onScroll={onScroll}>
      {!total && <p className="study-log-empty">{live ? '大家馬上就會發言…' : '在下面輸入問題，老師會回答；也可以找虛擬同學一起討論。'}</p>}
      {log.map((session, index) => <section key={session.id} className="study-log-session">
        <h3 className="study-log-divider"><span>{TYPE_LABEL[session.type]}{session.title && session.type === 'discussion' ? `：${session.title}` : ''}{index < log.length - 1 || !live ? '' : ' · 進行中'}</span></h3>
        {session.messages.map(message => <article key={message.id} className="study-log-message" data-role={message.role}>
          {message.role !== 'user' && <span className="study-log-avatar" aria-hidden="true" style={message.color ? { background: message.color } : undefined}>{message.name.slice(0, 1)}</span>}
          <div className="study-log-bubble">
            {message.role !== 'user' && <b className="study-log-name">{message.name}</b>}
            <Streamdown plugins={plugins}>{message.text}</Streamdown>
          </div>
        </article>)}
      </section>)}
      {waiting && <p className="study-log-typing" role="status"><i /><i /><i /><span className="study-sr-only">正在回覆</span></p>}
    </div>
    {away && <button type="button" className="study-log-down" onClick={down}><ArrowDown size={16} aria-hidden="true" />新訊息</button>}
  </div>;
}
