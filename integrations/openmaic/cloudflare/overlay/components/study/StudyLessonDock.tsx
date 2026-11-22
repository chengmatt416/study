'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, ChevronLeft, PencilLine, Loader2, ChevronRight, MessageCircle, List, BookOpen, Sparkles, Users, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { createSafeMathPlugin } from '@/lib/markdown/safe-math-plugin';
import { setStudyLiveAiSession, useStudyLiveAi } from '@/lib/study-classroom/live-ai';
import { beginStudyDetour, canSkipStudyChapter, recordStudyHint, rememberStudyLesson, studyDetourEndsAt, studySkipChapter, studyQuickDetour, useStudyAdaptive } from '@/lib/study-classroom/adaptive';
import { needsOperation, spaceContinues, splitDialogue } from '@/lib/study-classroom/dialogue';
import { clearStudyOperate, useStudyOperate } from '@/lib/study-classroom/operate';
import { lockStudyPanel, shouldUnlockPanel, unlockStudyPanel } from '@/lib/study-classroom/lock';
import { useStageStore } from '@/lib/store/stage';
import { setInkOn, useStudyInk } from '@/lib/study-classroom/ink';
import { rankVoices, setTts, shouldAutoAdvance, speak, stopSpeaking, ttsSupported, TTS_RATES, useStudyTts } from '@/lib/study-classroom/tts';
import { StudyInkBar } from './StudyInkBar';
import { StudyCoach } from './StudyCoach';
import { StudyNextSteps } from './StudyNextSteps';
import './classroom.css';

const plugins = { math: createSafeMathPlugin({ singleDollarTextMath: true }) };

export function StudyLessonDock({ text, fullText, title, sceneId, sceneIndex, sceneCount, started, completed, busy, discussionOpen, discussionLive = false, discussionStreaming = false, discussionMinimized = false, discussionUnread = 0, onResumeDiscussion, onGoToScene, onContinue, onPrevious, onNext, onToggleDiscussion, onToggleContents, contentsOpen = false, onStartPeerDiscussion }: {
  text: string;
  fullText: string;
  title: string;
  sceneId: string;
  sceneIndex: number;
  sceneCount: number;
  started: boolean;
  completed: boolean;
  busy: boolean;
  discussionOpen: boolean;
  /** A question or discussion is in progress; the sheet may be hidden while the learner reads the lesson. */
  discussionLive?: boolean;
  discussionStreaming?: boolean;
  discussionMinimized?: boolean;
  discussionUnread?: number;
  onResumeDiscussion?: () => void;
  /** Opens another scene by id (used to step back to the standard lesson from a quick one). */
  onGoToScene?: (sceneId: string) => void;
  onContinue: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleDiscussion: () => void;
  onToggleContents: () => void;
  contentsOpen?: boolean;
  onStartPeerDiscussion: () => void;
}) {
  const liveAi = useStudyLiveAi();
  const reduceMotion = useReducedMotion();
  const adaptive = useStudyAdaptive();
  useEffect(() => { rememberStudyLesson(sceneId); }, [sceneId]);
  const [expanded, setExpanded] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // A learner who needs more support gets the fuller explanation open by default.
  // On a phone the explanation is a floating sheet over the lesson, so it opens on request only.
  useEffect(() => setExpanded(adaptive.detail === 'detailed' && !(typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches)), [title, text, adaptive.detail]);
  const note = adaptive.noteScene === sceneId ? adaptive.note : null;
  const toggleAi = async () => { if (aiBusy) return; setAiError(null); setAiBusy(true); try { await setStudyLiveAiSession(!liveAi.sessionEnabled); } catch (error) { setAiError(error instanceof Error ? error.message : '無法變更課堂 AI 設定'); } finally { setAiBusy(false); } };
  const canContinue = !busy && !adaptive.routing;
  // While a discussion holds the lesson, the main button is the way back to it instead of a dead button.
  const resumeDiscussion = busy && discussionLive && !!onResumeDiscussion && !adaptive.routing;
  // A graded quiz is finished like a lesson that has reached its end, so Space and the button move on.
  const done = completed || adaptive.gradedScene === sceneId;
  const returning = done && !!adaptive.detour && studyDetourEndsAt(sceneId);
  // In a quick lesson, "I don't understand this step" means the basics are missing: go through the standard lesson first.
  const detourTo = studyQuickDetour(sceneId);
  const label = adaptive.routing ? '判斷下一步…' : resumeDiscussion ? '回到討論' : returning ? '回到精簡版' : done ? sceneIndex < sceneCount - 1 ? '下一節' : '再看一次' : started ? '繼續' : '開始學習';
  const sentence = started || completed ? splitDialogue(text)[0] : '準備好後點擊開始，依自己的步調逐步學習。';
  const operate = useStudyOperate();
  useEffect(() => { clearStudyOperate(); }, [sceneId]);
  // Space continues the lesson from anywhere on the page, including from inside an interactive module (the module forwards it).
  useEffect(() => {
    if (!canContinue) return;
    const onKey = (event: KeyboardEvent) => { if (spaceContinues(event)) { event.preventDefault(); onContinue(); } };
    const onFrame = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; v?: unknown; key?: unknown } | null;
      if (!data || data.source !== 'study-kit-key' || data.v !== 1 || data.key !== 'space' || !event.source) return;
      if (Array.from(document.querySelectorAll('iframe')).some(frame => frame.contentWindow === event.source)) onContinue();
    };
    window.addEventListener('keydown', onKey); window.addEventListener('message', onFrame);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('message', onFrame); };
  }, [canContinue, onContinue]);
  // An interactive panel stays locked until the dialogue tells the learner to operate it.
  const sceneType = useStageStore(state => state.scenes.find(scene => scene.id === sceneId)?.type);
  const interactive = sceneType === 'interactive';
  // Writing on the page works on slides and interactive modules; a quiz has its own answer boxes.
  const canWrite = sceneType === 'slide' || sceneType === 'interactive';
  const ink = useStudyInk();
  useEffect(() => { if (!canWrite && ink.on) setInkOn(false); }, [canWrite, ink.on]);
  const cue = operate ? operate.content : started && !completed && needsOperation(sentence) ? '這一步請你動手操作上方的模組' : null;
  const hasDialogue = fullText.trim().length > 0 || text.trim().length > 0;
  useEffect(() => {
    if (!interactive) return;
    if (shouldUnlockPanel({ completed, cue: cue !== null, hasDialogue })) unlockStudyPanel(sceneId);
    else lockStudyPanel(sceneId, started);
  }, [interactive, sceneId, started, completed, cue, hasDialogue]);
  // Read-aloud: each new sentence is read once. On a slide the next sentence follows by itself; the next slide, an
  // interactive module and a quiz always wait for the learner.
  const tts = useStudyTts();
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!ttsSupported()) return;
    setTtsAvailable(true);
    const update = () => setVoices(rankVoices(window.speechSynthesis.getVoices()));
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  const latest = useRef({ sceneType: sceneType as string | undefined, started, done, canContinue, onContinue });
  latest.current = { sceneType, started, done, canContinue, onContinue };
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (!tts.on || busy || !started || !sentence.trim()) return;
    const key = `${sceneId}\u0000${sentence}`;
    if (spoken.current === key) return;
    spoken.current = key;
    speak(sentence, { voiceURI: tts.voiceURI, rate: tts.rate, onEnd: () => { const state = latest.current; if (shouldAutoAdvance(state)) state.onContinue(); } });
  }, [tts.on, tts.voiceURI, tts.rate, busy, started, sentence, sceneId]);
  useEffect(() => { if (!tts.on) spoken.current = null; }, [tts.on]);
  useEffect(() => () => stopSpeaking(), [sceneId]);
  const progress = Math.round(((Math.max(0, sceneIndex) + (completed ? 1 : started ? 0.5 : 0)) / Math.max(1, sceneCount)) * 100);
  return <section className="study-lesson-dock" aria-label="逐步教學" data-pill={discussionMinimized && discussionLive ? 'true' : undefined}>
    <div className="study-lesson-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
    {canWrite && ink.on && <StudyInkBar sceneId={sceneId} />}
    {onGoToScene && <StudyCoach onNavigate={onGoToScene} />}
    {discussionMinimized && discussionLive && onResumeDiscussion && <button type="button" className="study-discussion-pill" data-unread={discussionUnread > 0 ? 'true' : undefined} onClick={onResumeDiscussion}>
      <span className="study-discussion-pill-dot" data-live={discussionStreaming ? 'true' : undefined} aria-hidden="true" />
      <span className="study-discussion-pill-text"><b>回到討論</b><span>{discussionStreaming ? '大家正在發言' : '等你加入'}</span></span>
      {discussionUnread > 0 && <i className="study-unread" aria-label={`${discussionUnread} 則新訊息`}>{discussionUnread > 9 ? '9+' : discussionUnread}</i>}
    </button>}
    <div className="study-lesson-context">
      <a className="study-wordmark" href="/">STUDY<span>課堂</span></a>
      <button type="button" className="study-lesson-context-title" onClick={onToggleContents} aria-label="開啟章節目錄" aria-expanded={contentsOpen} aria-controls="study-contents"><List size={16} /><span key={title}>{title}</span></button>
      <nav aria-label="章節導覽" className="study-lesson-navigation">
        <button type="button" onClick={onPrevious} disabled={sceneIndex <= 0} aria-label="上一章"><ChevronLeft size={18} /></button>
        <span>{Math.max(1, sceneIndex + 1)}<span className="study-lesson-count"> / {sceneCount}</span></span>
        <button type="button" onClick={onNext} disabled={sceneIndex >= sceneCount - 1 || adaptive.routing} aria-label="下一章"><ChevronRight size={18} /></button>
      </nav>
    </div>
    {cue && <div className="study-operate" role="status" aria-live="polite"><span className="study-operate-pulse" aria-hidden="true" /><b>換你操作</b><span>{cue}</span></div>}
    <div className="study-dialogue-row">
      <div className="study-dialogue-content">
        <p className="study-dialogue-label">{busy ? '課堂討論中' : done ? '本節教學完成' : '一步一步來'}</p>
        <div className="study-dialogue-text" role="button" tabIndex={canContinue ? 0 : -1} aria-disabled={!canContinue} aria-label={`教學對話，${label}`} onClick={event => { if ((event.target as HTMLElement).closest('a, button, input, textarea, select')) return; if (canContinue) onContinue(); }} onKeyDown={event => {
          if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation(); if (canContinue) onContinue();
        }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={sentence} initial={{ opacity: 0, y: reduceMotion ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }} transition={{ duration: reduceMotion ? 0 : 0.16 }} aria-live="polite" aria-atomic="true">
              <Streamdown plugins={plugins}>{sentence || '觀察這一頁的內容，準備好後點擊繼續。'}</Streamdown>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <button type="button" className="study-dialogue-continue" data-state={adaptive.routing ? 'busy' : resumeDiscussion ? 'discussion' : done ? 'next' : started ? 'continue' : 'start'} onClick={resumeDiscussion ? onResumeDiscussion : onContinue} disabled={!canContinue && !resumeDiscussion} aria-label={label} aria-busy={adaptive.routing}><span key={label}>{label}</span>{adaptive.routing ? <Loader2 size={20} className="study-spin" /> : resumeDiscussion ? <MessageCircle size={20} /> : done && sceneIndex >= sceneCount - 1 ? <Check size={20} /> : <ArrowRight size={20} />}</button>
    </div>
    <div className="study-dialogue-actions">
      <button type="button" onClick={() => {
        if (detourTo && onGoToScene) { const target = beginStudyDetour(sceneId); if (target) { onGoToScene(target); return; } }
        if (!expanded) recordStudyHint(sceneId); setExpanded(value => !value);
      }} title={detourTo ? '回到標準教學把基礎學好，學完再回來' : undefined} aria-expanded={detourTo ? undefined : expanded} aria-controls={detourTo ? undefined : 'study-lesson-detail'}><BookOpen size={15} />{expanded && !detourTo ? '收起說明' : '不懂這一步'}</button>
      {onGoToScene && canSkipStudyChapter(sceneId) && <button type="button" disabled={!canContinue} onClick={() => { void studySkipChapter(sceneId).then(target => { if (target) onGoToScene(target); }); }} title="申請跳過這一章：系統會依你的表現決定直接略過、先挑戰檢核，或繼續學"><SkipForward size={15} />跳過本章</button>}
      <button type="button" onClick={onToggleDiscussion} disabled={!liveAi.available && !discussionOpen} title={liveAi.reason ?? undefined} aria-expanded={discussionOpen}><MessageCircle size={15} />{discussionMinimized && discussionLive ? '回到討論' : discussionOpen ? '收起討論' : '提問與討論'}{discussionMinimized && discussionUnread > 0 && <i className="study-unread" aria-label={`${discussionUnread} 則新訊息`}>{discussionUnread > 9 ? '9+' : discussionUnread}</i>}</button>
      <button type="button" onClick={onStartPeerDiscussion} disabled={!liveAi.available} title={liveAi.reason ?? '和虛擬同學一起討論這一節'}><Users size={15} />找虛擬同學討論</button>
      {ttsAvailable && <button type="button" className="study-tts-toggle" onClick={() => setTts({ on: !tts.on })} aria-pressed={tts.on} title="用瀏覽器朗讀教學對話：投影片內每句講完自動接下一句，換頁、互動模組與測驗仍要手動繼續">{tts.on ? <Volume2 size={15} /> : <VolumeX size={15} />}朗讀</button>}
      {canWrite && <button type="button" className="study-ink-toggle" onClick={() => setInkOn(!ink.on)} aria-pressed={ink.on} title="在頁面上寫字、畫重點"><PencilLine size={15} />寫字</button>}
      {liveAi.providerReady && <button type="button" onClick={() => void toggleAi()} aria-pressed={liveAi.sessionEnabled} disabled={aiBusy} aria-busy={aiBusy}><Sparkles size={15} />{aiBusy ? '設定中…' : liveAi.sessionEnabled ? '關閉本次 AI' : '啟用本次 AI'}</button>}
      <span>點擊對話<span className="study-key-hint">、按 <kbd>空白鍵</kbd></span> 或「繼續」，才會進到下一句</span>
    </div>
    {ttsAvailable && tts.on && <div className="study-tts-settings" role="group" aria-label="朗讀設定">
      <label><span>聲音</span><select value={tts.voiceURI ?? ''} onChange={event => { spoken.current = null; setTts({ voiceURI: event.target.value || null }); }}>
        <option value="">預設（中文）</option>
        {voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}（{voice.lang}）</option>)}
      </select></label>
      <label><span>速度</span><select value={tts.rate} onChange={event => { spoken.current = null; setTts({ rate: Number(event.target.value) }); }}>{TTS_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}</select></label>
      <span className="study-tts-note">{sceneType === 'slide' ? '每句講完自動接下一句；本頁講完請按「下一節」' : '這一頁只朗讀，操作完再按「繼續」'}</span>
    </div>}
    {!liveAi.available && <p className="study-live-ai-status" role="status">{liveAi.reason}</p>}
    {aiError && <p className="study-live-ai-status" role="alert">{aiError}</p>}
    {(note || adaptive.detail !== 'standard') && <p className="study-live-ai-status" role="status">{[note, adaptive.detail === 'detailed' ? '解說已調整為詳細' : adaptive.detail === 'brief' ? '解說已調整為精簡' : null].filter(Boolean).join('；')}</p>}
    {/^課後\s*[：:]/.test(title) && <StudyNextSteps />}
    {expanded && <div id="study-lesson-detail" className="study-dialogue-detail"><p>回看這一段完整說明</p><Streamdown plugins={plugins}>{fullText || text || '先觀察本頁的圖形與互動內容。啟用課堂 AI 後，可開啟「提問與討論」，由教師透過即時 API 回應；未設定 key 時不提供即時 AI 回應。'}</Streamdown></div>}
  </section>;
}
