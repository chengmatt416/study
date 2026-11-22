import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Button, CountUp, ErrorBox, Loading, Reveal, Ring, Sheet, Stagger, StaggerItem } from "../components/ui";
import { hasScratch, Scratchpad } from "../features/exam/Scratchpad";
import { PencilLine } from "@phosphor-icons/react";
import { ArrowCounterClockwise, CalendarBlank, Medal, Target, ThumbsUp, Timer, Trophy } from "@phosphor-icons/react";
import { celebrate } from "../lib/celebrate";
import { ExamBody, type Responses } from "../features/exam/ExamBody";
import { InstantReviewNotes } from "../features/exam/InstantFeedback";
import { Page } from "../layouts/Shell";
import type { GradeResult, PublicQuestion } from "../../shared/exam";
import type { ExamMode, InstantFeedback } from "../../shared/exam-instant";

interface AttemptRes {
  attempt: { id: string; started_at: number; submitted_at: number; duration_sec: number; submitted: boolean; mode: ExamMode };
  document: { slug: string; title: string };
  result: GradeResult;
  body: string;
  questions: PublicQuestion[];
  responses: Responses;
  selfScores: Record<string, number>;
  feedback?: Record<string, InstantFeedback>;
}

export default function ExamResult() {
  const { id } = useParams();
  return <ExamResultWorkspace key={id} id={id!} />;
}

function ExamResultWorkspace({ id }: { id: string }) {
  const { hash } = useLocation();
  const { data, error, refetch } = useQuery({ queryKey: ["attempt", id], queryFn: () => api.get<AttemptRes>(`/api/exams/attempts/${id}`) });
  const [selfScores, setSelfScores] = useState<Record<string, number>>({});
  const [savingScore, setSavingScore] = useState(false);
  const [selfError, setSelfError] = useState<string | null>(null);
  const selfLock = useRef(false);
  const [scratch, setScratch] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  useEffect(() => {
    if (id) hasScratch(`scratch:${id}`).then(setScratch);
  }, [id]);
  useEffect(() => {
    if (data?.selfScores) setSelfScores(data.selfScores);
  }, [data]);
  useEffect(() => {
    if (data?.result && data.result.max && data.result.score / data.result.max >= 0.8) celebrate("big");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.attempt.id]);
  useEffect(() => {
    if (!data || !hash) return;
    const frame = requestAnimationFrame(() => {
      let target: string;
      try { target = decodeURIComponent(hash.slice(1)); } catch { return; }
      const element = document.getElementById(target);
      if (element) { element.scrollIntoView({ block: "start" }); element.tabIndex = -1; element.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [data, hash]);

  if (error) return <Page><ErrorBox error={error} /><Button className="mt-3" onClick={() => void refetch()}>重新載入作答結果</Button><Link to="/me" className="ml-4 underline">返回學習紀錄</Link></Page>;
  if (!data) return <Loading />;
  if (!data.attempt.submitted) return <ErrorBox error="尚未交卷" />;
  const r = data.result;
  const instant = data.attempt.mode === "instant";
  const pct = r.max ? Math.round((r.score / r.max) * 100) : 0;

  const self = async (key: string, score: number) => {
    if (selfLock.current) return;
    selfLock.current = true;
    const previous = selfScores[key];
    setSavingScore(true);
    setSelfError(null);
    setSelfScores((s) => ({ ...s, [key]: score }));
    try {
      await api.post(`/api/exams/attempts/${id}/self-grade`, { scores: { [key]: score } });
      void refetch();
    } catch (e) {
      setSelfScores(scores => {
        const next = { ...scores };
        if (previous === undefined) delete next[key]; else next[key] = previous;
        return next;
      });
      setSelfError(errorMessage(e));
    } finally {
      selfLock.current = false;
      setSavingScore(false);
    }
  };

  return (
    <Page>
      <Reveal>
        <div className="relative mb-8 overflow-hidden rounded-[32px] bg-aurora p-6 text-on-accent shadow-[var(--shadow-lift)] md:p-8">
          <div className="aurora-blob -top-20 -right-10 h-64 w-64 bg-white/15" />
          <div className="relative flex flex-wrap items-center gap-6">
            <div className="rounded-full bg-white/15 p-2 ring-1 ring-white/25 backdrop-blur">
              <Ring value={pct / 100} size={128} stroke={10} className="text-white">
                <div className="text-center">
                  <div className="font-display text-4xl font-semibold"><CountUp value={pct} /><span className="text-xl">%</span></div>
                </div>
              </Ring>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm text-white/75">
                {pct >= 80 ? <Trophy size={18} weight="fill" /> : pct >= 60 ? <ThumbsUp size={18} weight="fill" /> : <Target size={18} weight="fill" />}
                {pct >= 80 ? "表現優異" : pct >= 60 ? "穩定進步中" : "還有進步空間，看看錯題吧"}
              </div>
              <h1 className="mt-1 font-display text-2xl font-semibold md:text-3xl">{data.document.title}</h1>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/80">
                <span className="flex items-center gap-1.5"><Medal size={16} /> {r.score} / {r.max} 分</span>
                <span className="flex items-center gap-1.5"><Timer size={16} /> {Math.round(data.attempt.duration_sec / 60)} 分鐘</span>
                <span className="flex items-center gap-1.5"><CalendarBlank size={16} /> {fmtDate(data.attempt.submitted_at)}</span>
                {instant && <span>Instant 即時練習</span>}
              </div>
              {r.pendingSelfGrade > 0 && <div className="mt-2 text-sm text-amber-200">有 {r.pendingSelfGrade} 題非選題待自評（往下對照參考答案）</div>}
            </div>
            <Link to={`/exams/${data.document.slug}`} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-ink-900 shadow-lg transition hover:-translate-y-0.5">
              <ArrowCounterClockwise size={18} /> 再做一次
            </Link>
          </div>
          <Stagger className="relative mt-6 flex flex-wrap gap-2" gap={0.03}>
            {r.questions.map((q, i) => (
              <StaggerItem key={q.id}>
                <a href={`#q-${q.id}`} aria-label={`第 ${i + 1} 題${q.correct === true ? "，正確" : q.correct === null ? "，待自評" : q.correct === "partial" ? "，部分正確" : "，錯誤"}`} className={`grid h-11 w-11 place-items-center rounded-xl text-xs font-bold shadow-lg ring-1 ring-white/30 transition hover:-translate-y-0.5 ${q.correct === true ? "bg-emerald-400 text-emerald-950" : q.correct === "partial" ? "bg-amber-300 text-amber-950" : q.correct === null ? "bg-white/30 text-white" : "bg-rose-500 text-white"}`}>
                  {i + 1}
                </a>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </Reveal>
      {scratch && (
        <div className="mb-6 flex justify-end">
          <Button onClick={() => setScratchOpen(true)}>
            <PencilLine size={18} /> 查看我的書寫板
          </Button>
        </div>
      )}
      <Sheet open={scratchOpen} onClose={() => setScratchOpen(false)} title="我的書寫板（唯讀）" wide>
        <div className="h-[75vh]">
          <Scratchpad storageKey={`scratch:${id}`} readOnly />
        </div>
      </Sheet>
      {savingScore && <p role="status" className="mb-4 text-sm text-slate-500">正在儲存自評…</p>}
      {selfError && <p role="alert" className="mb-4 text-sm text-rose-600 dark:text-rose-300">自評尚未儲存：{selfError}。請重新選擇分數重試。</p>}
      <ExamBody selfScoreBusy={savingScore} md={data.body} questions={data.questions} responses={data.responses} results={r.questions} selfScores={selfScores} onSelfScore={self} mode="exam-review" />
      {instant && r.questions.map((question, index) => {
        const marks = data.feedback?.[question.id]?.review;
        return marks && <section key={question.id} className="mt-4 space-y-2" aria-label={`第 ${index + 1} 題的 AI 複核`}>
          <a href={`#q-${question.id}`} className="text-sm underline">第 {index + 1} 題</a>
          <InstantReviewNotes marks={marks} questionId={question.id} />
        </section>;
      })}
    </Page>
  );
}
