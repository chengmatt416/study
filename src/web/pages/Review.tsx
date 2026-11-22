import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { animate, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowsClockwise, Brain, Check, Clock, CloudArrowUp, Shuffle, Target } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import type { Card as CardT } from "../lib/types";
import { Button, ErrorBox, IconButton, Loading, spring } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ContentTransition } from "../components/ContentTransition";
import { enqueueReview, flushReviewOutbox, pendingReviews } from "../features/decks/outbox";
import { affectsSchedule, applyRating, formatInterval, previewIntervals, retrievability, State, type ReviewSettings, type ReviewStateRow } from "../../shared/srs";
import { answerReview, createReviewSession, nextReview, reconcileReviewQueue, reviewShortcut, type ReviewQueue, type ReviewSession } from "../../shared/review-session";
import { STUDY_MOTION } from "../../shared/motion";
import "../features/decks/review.css";

type Mode = "review" | "shuffle" | "weak" | "all";
const MODE_LABEL: Record<Mode, string> = { review: "智慧複習", shuffle: "隨機練習", weak: "弱項加強", all: "依序瀏覽" };
const RATINGS = [
  { rating: 1, label: "忘記", key: "again", hint: "沒想起來或答錯" },
  { rating: 2, label: "困難", key: "hard", hint: "想了很久才答對" },
  { rating: 3, label: "記得", key: "good", hint: "順利想起答案" },
  { rating: 4, label: "熟悉", key: "easy", hint: "毫不費力地答對" },
] as const;
const dateLabel = (at: number) => new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);

export default function Review() {
  const { id, mode: rawMode } = useParams();
  const mode = (["review", "shuffle", "weak", "all"].includes(rawMode ?? "") ? rawMode : "review") as Mode;
  return <ReviewWorkspace key={`${id}:${mode}`} id={id!} mode={mode} />;
}

function ReviewWorkspace({ id, mode }: { id: string; mode: Mode }) {
  const user = useUser();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const scheduled = affectsSchedule(mode);
  const deck = useQuery({ queryKey: ["deck", id], queryFn: () => api.get<{ deck: { title: string }; cards: CardT[]; settings: ReviewSettings }>(`/api/decks/${id}`) });
  const queue = useQuery({
    queryKey: ["queue", id, mode, user.id],
    queryFn: async () => {
      await flushReviewOutbox(user.id);
      const result = await api.get<ReviewQueue>(`/api/decks/${id}/queue?mode=${mode === "review" ? "smart" : mode}`);
      return { result, pending: await pendingReviews(user.id) };
    },
    staleTime: Infinity, gcTime: 0, retry: false,
  });
  const cardMap = useMemo(() => new Map((deck.data?.cards ?? []).map((c) => [c.id, c])), [deck.data]);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [limit, setLimit] = useState(20);
  const [states, setStates] = useState<Record<string, ReviewStateRow>>({});
  const [flipped, setFlipped] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [ended, setEnded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [answerNumber, setAnswerNumber] = useState(0);
  const [feedback, setFeedback] = useState("");
  const ratingLock = useRef(false);
  const shownAt = useRef(Date.now());
  const revealButton = useRef<HTMLButtonElement>(null);
  const ready = useMemo(() => queue.data && reconcileReviewQueue(queue.data.result, queue.data.pending.filter((p) => cardMap.has(p.card_id)), id, Date.now(), mode), [queue.data, queue.dataUpdatedAt, cardMap, id, mode]);
  const current = session ? nextReview(session, clock) : undefined;
  const card = current ? cardMap.get(current.id) : undefined;
  const finished = !!session && (ended || session.pending.length === 0);
  const waiting = !!session && !finished && !current;
  const nextDue = session?.pending.length ? Math.min(...session.pending.map((p) => p.due)) : null;
  const settings = queue.data?.result.settings ?? deck.data?.settings;
  const intervals = useMemo(() => card && scheduled ? previewIntervals(states[card.id], new Date(clock), settings?.target_date, settings?.request_retention, card.id) : null, [card, scheduled, states, clock, settings]);

  useEffect(() => {
    shownAt.current = Date.now();
    if (card) revealButton.current?.focus({ preventScroll: true });
  }, [card?.id, answerNumber]);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  useEffect(() => () => {
    void qc.invalidateQueries({ queryKey: ["decks"] });
    void qc.invalidateQueries({ queryKey: ["deck", id] });
  }, [qc, id]);

  const rate = useCallback(async (rating: 1 | 2 | 3 | 4) => {
    if (!card || !session || !flipped || ratingLock.current || !settings) return;
    ratingLock.current = true;
    setSaving(true);
    setSaveError("");
    const at = new Date();
    try {
      const next = scheduled ? applyRating(states[card.id], rating, at, { cardId: card.id, deckId: id }, settings.target_date, settings.request_retention) : undefined;
      await enqueueReview(user.id, { id: crypto.randomUUID(), card_id: card.id, rating, mode: mode === "review" ? "smart" : mode, reviewed_at: at.getTime(), duration_ms: Math.min(86400000, Math.max(0, at.getTime() - shownAt.current)) });
      if (next) setStates((s) => ({ ...s, [card.id]: next }));
      setSession(answerReview(session, card.id, rating, next));
      setFeedback(`${RATINGS[rating - 1].label} · ${next ? `下次約 ${formatInterval(next.due - at.getTime())}` : "練習已記錄，排程不變"}`);
      setFlipped(false);
      setClock(at.getTime());
      setAnswerNumber((n) => n + 1);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      ratingLock.current = false;
      setSaving(false);
    }
  }, [card, session, flipped, settings, scheduled, states, id, mode, user.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.target instanceof Element && event.target.closest("a,button") && !/^[1-4]$/.test(event.key)) return;
      const action = reviewShortcut(event, flipped, !scheduled);
      if (!action || !card || saving || finished) return;
      event.preventDefault();
      if (action === "reveal") setFlipped(true);
      else void rate(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped, scheduled, card, saving, finished, rate]);

  const eligibleIds = useMemo(() => ready?.ids.filter(cardId => cardMap.has(cardId)) ?? [], [ready, cardMap]);

  const start = () => {
    if (!ready || eligibleIds.length === 0) return;
    setStates(ready.states);
    setSession(createReviewSession(eligibleIds, limit, Date.now()));
    setClock(Date.now());
    setEnded(false);
  };
  const another = async () => {
    setSession(null);
    setEnded(false);
    setFeedback("");
    setFlipped(false);
    setSaveError("");
    await queue.refetch();
  };

  if (deck.error || queue.error) return <div className="p-6"><ErrorBox error={deck.error ?? queue.error} /><Button onClick={() => { void deck.refetch(); void queue.refetch(); }}>重新載入</Button></div>;
  if (!deck.data || !ready || !settings) return <Loading />;
  const freshCount = ready.ids.filter((cardId) => !ready.states[cardId] || ready.states[cardId].state === State.New).length;
  const memory = card && states[card.id];
  const recall = memory?.last_review ? Math.round(retrievability(memory, new Date(clock)) * 100) : null;
  const progress = session?.total ? session.seen.length / session.total : 0;

  return <div className="review-workspace">
    <header className="review-header">
      <Link to={`/decks/${id}`} className="review-back" aria-label="返回字卡組"><ArrowLeft size={20} /></Link>
      <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{deck.data.deck.title}</div><div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">{mode === "shuffle" ? <Shuffle size={13} /> : mode === "weak" ? <Target size={13} /> : <Brain size={13} />}{MODE_LABEL[mode]}{!scheduled && " · 不影響排程"}</div></div>
      {session && !finished && <><span className="hidden text-xs tabular-nums text-slate-500 sm:inline">初次作答 {session.seen.length} / {session.total}</span><Button size="sm" disabled={saving} onClick={() => setEnded(true)}>結束本輪</Button></>}
    </header>
    {session && <div className="review-progress" role="progressbar" aria-label="本輪初次作答進度" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={session.seen.length}><motion.div initial={false} animate={{ scaleX: finished && !session.pending.length ? 1 : progress }} transition={reduced ? { duration: 0 } : spring} /></div>}
    <main className="review-main">
      {!session ? <ContentTransition id="prepare"><section className="review-intro">
        <p className="review-eyebrow">{scheduled ? "SPACED REPETITION" : "FREE PRACTICE"}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">{ready.ids.length ? "留一點時間，\n把知識記牢。" : "給記憶一點時間。"}</h1>
        <p className="review-description">{scheduled ? "先回想，再揭曉。依實際回想的感覺評分，讓下一次複習更適合你。" : "自由瀏覽與練習，保留你的智慧複習排程。"}</p>
        <div className="review-overview">
          <div><strong>{ready.ids.length}</strong><span>{mode === "review" ? "本次可複習" : "可練習"}</span></div>
          {scheduled && <><div><strong>{freshCount}</strong><span>新卡</span></div><div><strong>{Math.round(settings.request_retention * 100)}<small>%</small></strong><span>目標記憶率</span></div></>}
        </div>
        {mode === "review" && <div className="review-coach"><p>優先重學與遺忘風險較高的到期卡，再穿插新卡。今日已學 {ready.summary.new_today} 張新卡；每日上限 {settings.new_per_day} 張（UTC+8）。</p>{ready.summary.deferred_new > 0 && <p>待複習量較多，暫緩 {ready.summary.deferred_new} 張新卡，先消化舊知識。</p>}{ready.summary.suggested_new_per_day !== null && ready.summary.suggested_new_per_day > settings.new_per_day && <p>若要在考試前學完未學卡片，平均每天需約 {ready.summary.suggested_new_per_day} 張新卡；可到字卡組設定調整。</p>}</div>}
        {eligibleIds.length > 0 ? <>
          <fieldset className="review-length"><legend>本輪張數</legend>{[10, 20, 50, Infinity].map((n) => <button type="button" key={n} aria-pressed={limit === n} onClick={() => setLimit(n)}>{n === Infinity ? "全部" : n}</button>)}</fieldset>
          <Button variant="primary" size="lg" className="w-full" onClick={start}>開始{scheduled ? "複習" : "練習"} · {Math.min(eligibleIds.length, limit)} 張</Button>
        </> : <div className="space-y-3"><p className="text-sm text-slate-500">{ready.summary.next_due ? `下次到期：${dateLabel(ready.summary.next_due)}` : mode === "weak" ? "先完成一些智慧複習，再回來檢查弱項。" : "目前沒有待複習卡片，可回字卡組調整每日新卡上限。"}</p><Button className="w-full" onClick={() => void queue.refetch()}>重新檢查</Button></div>}
        <Link className="review-text-link" to={`/decks/${id}`}>返回字卡組與設定</Link>
      </section></ContentTransition> : finished ? <ContentTransition id="complete"><section className="review-intro">
        <div className="review-complete-icon"><Check size={30} /></div><p className="review-eyebrow">SESSION SUMMARY</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{session.pending.length ? "這一輪，先到這裡。" : "本輪完成。"}</h1>
        <p className="review-description">已練習 {session.seen.length} 張不同卡片，共 {session.ratings.reduce((a, b) => a + b, 0)} 次作答。{session.pending.length > 0 ? `還有 ${session.pending.length} 張保留於後續排程，隨時可以繼續。` : "下次再見面時，從適合的間隔接著複習。"}</p>
        <div className="review-summary-grid">{RATINGS.filter((r) => scheduled || r.rating === 1 || r.rating === 3).map((r) => <div key={r.rating}><strong>{session.ratings[r.rating - 1]}</strong><span>{r.label}</span></div>)}</div>
        <p className="review-coach flex items-start gap-2"><CloudArrowUp size={18} className="shrink-0" />作答已儲存在此裝置；連線時會自動同步。智慧複習依同步後的記憶狀態安排下一次。</p>
        <Button variant="primary" size="lg" className="w-full" onClick={() => void another()}>查看剩餘複習</Button><Link className="review-text-link" to={`/decks/${id}`}>返回字卡組</Link>
      </section></ContentTransition> : waiting ? <ContentTransition id="waiting"><section className="review-intro">
        <Clock size={32} /><p className="review-eyebrow mt-6">LET IT SETTLE</p><h1 className="font-display text-3xl font-semibold">讓剛學的內容沉澱一下。</h1>
        <p className="review-description">{session.pending.length} 張卡片等待重學。會在排定時間到期後出現，避免連續重看造成已經記住的錯覺。</p>
        <div className="review-wait-time" role="timer" aria-label="距離下次重學">{nextDue ? `${Math.floor(Math.max(0, nextDue - clock) / 60000)}:${String(Math.floor(Math.max(0, nextDue - clock) / 1000) % 60).padStart(2, "0")}` : "—"}</div>
        <p className="text-sm text-slate-500">可以稍作休息，或結束這一輪，下次再繼續。</p><Button variant="primary" className="mt-6 w-full" onClick={() => setEnded(true)}>先結束本輪</Button>
      </section></ContentTransition> : card ? <div className="review-active">
        <div className="review-context"><span>{current?.repeat ? "間隔重學" : !memory ? "新卡片" : memory.state === State.Relearning || memory.state === State.Learning ? "學習中" : "記憶複習"}</span><span>{recall !== null ? `估計可回想率 ${recall}%` : "先試著用自己的話回答"}</span><IconButton label="正反面對調" active={reverse} disabled={saving} onClick={() => { setReverse((r) => !r); setFlipped(false); }}><ArrowsClockwise size={17} /></IconButton></div>
        <div className="review-card-stage"><AnimatePresence initial={false} mode="wait"><ReviewCard key={`${card.id}:${answerNumber}`} flipped={flipped} disabled={saving} onReveal={() => setFlipped(true)} onRate={(r) => void rate(r)} front={reverse ? card.back : card.front} back={reverse ? card.front : card.back} /></AnimatePresence></div>
        <div className="review-controls">
          {saveError && <p role="alert" className="mb-3 text-sm text-rose-600 dark:text-rose-300">{saveError}。這張卡尚未評分，請重試。</p>}
          {!flipped ? <button ref={revealButton} type="button" className="review-reveal" onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }} onClick={() => setFlipped(true)}>顯示答案 <span className="hidden text-xs opacity-60 sm:inline">Space</span></button> : <>
            <div className={clsx("review-ratings", !scheduled && "is-practice")}>{RATINGS.filter((r) => scheduled || r.rating === 1 || r.rating === 3).map((r) => <motion.button key={r.rating} type="button" onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }} disabled={saving} title={r.hint} onClick={() => void rate(r.rating)} whileTap={reduced ? undefined : { scale: 0.98 }} className={clsx("review-rating", r.rating === 3 && "is-recommended")}><span className="review-rating-key" aria-hidden>{!scheduled && r.rating === 3 ? "2" : r.rating}</span><strong>{r.label}</strong><span className="review-rating-interval">{scheduled ? intervals?.[r.key] : "排程不變"}</span><span className="review-rating-hint">{r.hint}</span></motion.button>)}</div>
            <p className="review-help">{saving ? "正在儲存…" : scheduled ? "依回想感受評分 · 1–4 快捷鍵 · 答錯請選「忘記」" : "1 不會 · 2 會 · 自由練習不改變智慧排程"}</p>
          </>}
          <div className="review-feedback" role="status" aria-live="polite">{feedback || "先回想答案，再翻面確認。"}</div>
          {(memory?.lapses ?? 0) >= 3 && <p className="review-help">這張卡已多次忘記。可回字卡組把問題拆小，或補上例子，再繼續練習。</p>}
        </div>
      </div> : <div><ErrorBox error={new Error("卡片已更新，請重新建立複習佇列")} /><Button onClick={() => void another()}>重新載入</Button></div>}
    </main>
  </div>;
}

export function ReviewCard({ front, back, flipped, disabled, onReveal, onRate }: { front: string; back: string; flipped: boolean; disabled: boolean; onReveal: () => void; onRate: (rating: 1 | 3) => void }) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-250, 250], [-4, 4]);
  const dragged = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { if (flipped && present) content.current?.focus({ preventScroll: true }); }, [flipped, present]);
  const side = useTransform(x, (value): string => value > 75 ? "記得 →" : value < -75 ? "← 忘記" : "");
  return <motion.article className="review-card-shell" inert={!present} aria-label={flipped ? "答案" : "題目"} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -8 }} transition={{ duration: reduced ? 0 : 0.2, ease: STUDY_MOTION.ease }} style={{ x, rotate: reduced ? 0 : rotate }} drag={flipped && !disabled && present ? "x" : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18} onDragStart={() => { dragged.current = true; }} onDragEnd={(_, info) => {
    if (info.offset.x > 120) onRate(3);
    else if (info.offset.x < -120) onRate(1);
    void animate(x, 0, reduced ? { duration: 0 } : spring);
  }} onClick={(event) => { if (dragged.current) { dragged.current = false; return; } if (!flipped && !disabled && !(event.target instanceof Element && event.target.closest("a,button,input,textarea,select"))) onReveal(); }}>
    <div className="review-card-core"><div className="review-card-label">{flipped ? "ANSWER" : "QUESTION"}<motion.span aria-hidden>{side}</motion.span></div>
      {flipped && <div className="review-question-reminder" role="region" aria-label="原題" tabIndex={0}><Markdown md={front} /></div>}
      <motion.div ref={content} role="region" aria-label={flipped ? "答案內容" : "題目內容"} tabIndex={0} key={flipped ? "back" : "front"} className={clsx("review-card-content", flipped && "is-answer")} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : STUDY_MOTION.instruction, ease: STUDY_MOTION.ease }}><Markdown md={flipped ? back || "這張卡尚未填寫答案。" : front} /></motion.div>
      {!flipped && <p className="review-card-caption">先在心中回答，再揭曉答案</p>}
    </div>
  </motion.article>;
}
