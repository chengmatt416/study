import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { BookletViewer } from "../features/reader/BookletViewer";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowsIn,
  ArrowsInSimple,
  ArrowsOut,
  BookOpenText,
  Calculator,
  Check,
  CornersIn,
  CornersOut,
  Flag,
  Pause,
  PencilLine,
  Play,
  SquaresFour,
  Timer,
} from "@phosphor-icons/react";
import { flushExamInk, Scratchpad } from "../features/exam/Scratchpad";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { useDevice } from "../lib/device";
import { idb } from "../lib/idb";
import { BottomPanel, Button, ErrorBox, IconButton, Loading, Ring, Sheet, toast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { ExamBody, InlineQuestionMarkdown, type Responses } from "../features/exam/ExamBody";
import { ExamPaneToggle, ExamSplitHandle, ExamStage, useExamPane, useExamSplit } from "../features/exam/ExamStage";
import { InstantFeedbackPanel } from "../features/exam/InstantFeedback";
import { PassagePane, type EvidenceTarget } from "../features/exam/PassagePane";
import { QuestionControl, StemWithGap } from "../features/exam/QuestionControls";
import { hasOpenModalDialog, isInteractiveTarget, isTypingTarget } from "../features/exam/useOptionShortcuts";
import { FloatingWindow, ToolPanel, TOOLS, type ToolId } from "../features/tools/ToolPanel";
import { GAP_TOKEN, type EvidenceResponse, type PublicQuestion, type Response } from "../../shared/exam";
import { examQuestionAnswered, hasExamResponse } from "../../shared/exam-progress";
import type { ExamMode, InstantFeedback } from "../../shared/exam-instant";
import { parseExamPaper, QUESTION_TYPE_LABELS, type PassageHighlight } from "../../shared/exam-paper";

interface Paper {
  document: { id: string; slug: string; title: string };
  booklet: { id: string; title: string } | null;
  body: string;
  frontmatter: Record<string, unknown>;
  questions: PublicQuestion[] | null;
  ready: boolean;
}

type NavFilter = "all" | "unanswered" | "flagged";

interface AttemptStart {
  id: string;
  mode: ExamMode;
  started_at: number;
  paused_at: number | null;
  paused_ms: number;
  current_question_id: string | null;
  responses: Responses;
  feedback?: Record<string, InstantFeedback>;
}

export default function ExamTake() {
  const { slug } = useParams();
  const [search] = useSearchParams();
  const mode = search.get("mode") === "instant" ? "instant" : "exam";
  const resumeId = search.get("attempt");
  return <ExamTakeWorkspace key={`${slug}:${mode}:${resumeId ?? ""}`} slug={slug!} mode={mode} resumeId={resumeId} />;
}

function ExamTakeWorkspace({ slug, mode, resumeId }: { slug: string; mode: ExamMode; resumeId: string | null }) {
  const navigate = useNavigate();
  const device = useDevice();
  const reduced = useReducedMotion();
  const instant = mode === "instant";
  const attempt = useQuery({
    queryKey: ["attempt-start", slug, mode, resumeId],
    queryFn: () => {
      const search = new URLSearchParams({ mode, ...(resumeId ? { attempt: resumeId } : {}) });
      return api.post<AttemptStart>(`/api/exams/${slug}/attempts?${search}`);
    },
    staleTime: Infinity,
    gcTime: 0,
  });
  const paper = useQuery({
    queryKey: ["paper", slug, attempt.data?.id],
    queryFn: () => api.get<Paper>(`/api/exams/${slug}/paper?attempt=${attempt.data!.id}`),
    enabled: !!attempt.data,
  });

  const [responses, setResponses] = useState<Responses>({});
  const [feedback, setFeedback] = useState<Record<string, InstantFeedback>>({});
  const [checking, setChecking] = useState(false);
  const [checkErrors, setCheckErrors] = useState<Record<string, string>>({});
  const checkLock = useRef(false);
  const feedbackSnapshot = useRef(feedback);
  const [now, setNow] = useState(Date.now());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"step" | "full">("step");
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { view: paneView, show: showPaneView, reset: resetPaneView } = useExamPane(stageRef);
  const [focusMode, setFocusMode] = useState(false);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [bookletOpen, setBookletOpen] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const scratchSplit = useExamSplit("dyshibdp-exam-scratch-split", 50);
  const scratchWide = scratchSplit.split < 50;
  // 平板側欄：開過一次就保持掛載（切換只是隱藏），計算機內容不會遺失
  const [mountedPanels, setMountedPanels] = useState<Set<string>>(() => new Set());
  const [navOpen, setNavOpen] = useState(false);
  const [navFilter, setNavFilter] = useState<NavFilter>("all");

  // 暫停：paused_at 有值＝計時停止；paused_ms＝累計已暫停的時間（不計入作答時間）
  const [pause, setPause] = useState<{ at: number | null; ms: number }>({ at: null, ms: 0 });
  const [pauseBusy, setPauseBusy] = useState(false);
  useEffect(() => {
    if (attempt.data) setPause({ at: attempt.data.paused_at, ms: attempt.data.paused_ms });
  }, [attempt.data]);

  const [submitting, setSubmitting] = useState(false);
  const [submitPrompt, setSubmitPrompt] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [restoredAttempt, setRestoredAttempt] = useState<string | null>(null);
  const [restoredQuestion, setRestoredQuestion] = useState(false);

  const submissionLock = useRef(false);
  const autoSubmittedFor = useRef<string | null>(null);
  const syncing = useRef<Promise<unknown> | null>(null);
  const responseSnapshot = useRef(responses);
  responseSnapshot.current = responses;
  const pausePanel = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLElement>(null);
  const passageRef = useRef<HTMLElement>(null);
  const wasPaused = useRef(false);
  const dirty = useRef(false);
  const localKey = attempt.data ? `attempt:${attempt.data.id}` : null;
  const position = useRef<string | null>(null);

  const rememberQuestion = useCallback((qid: string) => {
    if (position.current === qid) return;
    position.current = qid;
    dirty.current = true;
    if (localKey) void idb.set(`${localKey}:question`, qid);
  }, [localKey]);

  useEffect(() => {
    if (focusMode) document.documentElement.dataset.examFocus = "1";
    else delete document.documentElement.dataset.examFocus;
    return () => {
      delete document.documentElement.dataset.examFocus;
    };
  }, [focusMode]);

  // 還原：伺服器暫存與本機暫存取較新者（本機為主，避免斷線遺失）
  useEffect(() => {
    if (!attempt.data || !localKey) return;
    let active = true;
    const saved = attempt.data;
    Promise.all([idb.get<Responses>(localKey), idb.get<string>(`${localKey}:question`)]).then(([local, question]) => {
      if (!active) return;
      const checks = saved.feedback ?? {};
      const merged = { ...saved.responses, ...(local ?? {}) };
      for (const id of Object.keys(checks)) merged[id] = saved.responses[id];
      responseSnapshot.current = merged;
      setResponses(merged);
      feedbackSnapshot.current = checks;
      setFeedback(checks);
      position.current = question ?? saved.current_question_id ?? null;
      setRestoredAttempt(saved.id);
    });
    return () => {
      active = false;
    };
  }, [attempt.data, localKey]);
  const responsesReady = !!attempt.data && restoredAttempt === attempt.data.id;
  useEffect(() => {
    const questions = paper.data?.questions;
    if (!responsesReady || !questions || restoredQuestion) return;
    const saved = position.current;
    const lastAnswered = Object.keys(responseSnapshot.current).reverse().find(id =>
      questions.some(q => q.id === id) && hasExamResponse(responseSnapshot.current[id]));
    const index = questions.findIndex(q => q.id === saved);
    const fallback = questions.findIndex(q => q.id === lastAnswered);
    const nextIndex = index >= 0 ? index : Math.max(0, fallback);
    setCurrentIndex(nextIndex);
    position.current = questions[nextIndex]?.id ?? null;
    setRestoredQuestion(true);
  }, [paper.data, responsesReady, restoredQuestion]);

  const onChange = useCallback(
    (qid: string, v: unknown) => {
      if (Object.hasOwn(feedbackSnapshot.current, qid)) return;
      const next = { ...responseSnapshot.current, [qid]: v } as Responses;
      responseSnapshot.current = next;
      setResponses(next);
      if (localKey) void idb.set(localKey, next);
      if (!qid.startsWith("__")) rememberQuestion(qid);
      dirty.current = true;
    },
    [localKey, rememberQuestion],
  );

  // 每 10 秒同步到伺服器
  useEffect(() => {
    if (!attempt.data) return;
    const t = setInterval(() => {
      if (!dirty.current || pause.at || syncing.current || submissionLock.current) return;
      dirty.current = false;
      syncing.current = api
        .put(`/api/exams/attempts/${attempt.data!.id}`, { responses: responseSnapshot.current, current_question_id: position.current })
        .catch(() => {
          dirty.current = true;
        })
        .finally(() => {
          syncing.current = null;
        });
    }, 10_000);
    return () => clearInterval(t);
  }, [attempt.data, pause.at]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const limitMin = instant ? 0 : Number(paper.data?.frontmatter.time_limit_min ?? 0);
  const elapsed = attempt.data ? Math.max(0, Math.floor(((pause.at ?? now) - attempt.data.started_at - pause.ms) / 1000)) : 0;
  const remaining = limitMin ? limitMin * 60 - elapsed : null;
  const paused = pause.at !== null;
  const timedOut = remaining !== null && remaining <= 0;

  useEffect(() => {
    if (paused) pausePanel.current?.focus();
    else if (wasPaused.current) document.getElementById("exam-pause")?.focus();
    wasPaused.current = paused;
  }, [paused]);

  const doPause = useCallback(async () => {
    if (!attempt.data || pauseBusy || !responsesReady || submissionLock.current || checkLock.current) return false;
    if (pause.at) return true;
    setPauseBusy(true);
    try {
      flushExamInk(workspaceRef.current);
      await syncing.current;
      const r = await api.post<{ paused_at: number; paused_ms: number }>(`/api/exams/attempts/${attempt.data.id}/pause`, {
        responses: responseSnapshot.current,
        current_question_id: position.current,
      });
      dirty.current = false;
      setPause({ at: r.paused_at, ms: r.paused_ms });
      setToolsOpen(false);
      setBookletOpen(false);
      setScratchOpen(false);
      return true;
    } catch (e) {
      toast(errorMessage(e), "err");
      return false;
    } finally {
      setPauseBusy(false);
    }
  }, [attempt.data, pauseBusy, pause.at, responsesReady]);

  const doResume = async () => {
    if (!attempt.data || pauseBusy) return;
    setPauseBusy(true);
    try {
      const r = await api.post<{ paused_ms: number }>(`/api/exams/attempts/${attempt.data.id}/resume`);
      setPause({ at: null, ms: r.paused_ms });
      setNow(Date.now());
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setPauseBusy(false);
    }
  };

  const calcs = paper.data?.frontmatter.calculators;
  const allowed = useMemo(
    () => (Array.isArray(calcs) ? (calcs as string[]).filter((c) => TOOLS.some((t) => t.id === c)) as ToolId[] : undefined),
    [calcs],
  );

  const submit = useCallback(async () => {
    if (!attempt.data || submissionLock.current || !responsesReady || !paper.data?.ready || paused || pauseBusy || checkLock.current) return;
    submissionLock.current = true;
    setSubmitPrompt(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      flushExamInk(workspaceRef.current);
      await syncing.current;
      await api.post(`/api/exams/attempts/${attempt.data.id}/submit`, { responses: responseSnapshot.current });
      if (localKey) await Promise.all([idb.del(localKey), idb.del(`${localKey}:question`)]);
      navigate(`/attempts/${attempt.data.id}`, { replace: true });
    } catch (e) {
      setSubmitError(errorMessage(e));
      setSubmitting(false);
    } finally {
      submissionLock.current = false;
    }
  }, [attempt.data, responsesReady, paper.data, paused, pauseBusy, localKey, navigate]);

  useEffect(() => {
    if (timedOut && responsesReady && paper.data?.ready && attempt.data && !paused && !pauseBusy && autoSubmittedFor.current !== attempt.data.id) {
      autoSubmittedFor.current = attempt.data.id;
      toast("時間到，正在交卷");
      void submit();
    }
  }, [timedOut, responsesReady, paper.data?.ready, attempt.data, submit, paused, pauseBusy]);

  const qs = paper.data?.questions ?? [];
  const parsed = useMemo(
    () => (paper.data ? parseExamPaper(paper.data.body, qs) : null),
    [paper.data, qs],
  );
  const safeIndex = qs.length ? Math.min(currentIndex, qs.length - 1) : 0;
  const currentView = parsed?.questions[safeIndex] ?? null;
  const currentQ = currentView?.question ?? null;
  const currentFeedback = currentQ && Object.hasOwn(feedback, currentQ.id) ? feedback[currentQ.id] : null;
  const currentPassage = currentView?.passageId && parsed ? (parsed.passagesById[currentView.passageId] ?? null) : null;
  const sharedStemMd = currentView?.pinStemToPassagePane ? currentView.stemMd : null;
  const hasLeftMaterial = Boolean(currentPassage || sharedStemMd);

  async function checkQuestion(review = false) {
    if (!instant || !attempt.data || !currentQ || checkLock.current || submissionLock.current || paused || pauseBusy) return;
    const q = currentQ;
    flushExamInk(deckRef.current);
    checkLock.current = true;
    setChecking(true);
    setCheckErrors(errors => ({ ...errors, [q.id]: "" }));
    try {
      const response = responseSnapshot.current[q.id];
      const payload = review ? { review: true } : { response };
      const saved = await api.post<{ response: Response; feedback: InstantFeedback }>(
        `/api/exams/attempts/${attempt.data.id}/check/${encodeURIComponent(q.id)}`, payload,
      );
      onChange(q.id, saved.response);
      const next = { ...feedbackSnapshot.current, [q.id]: saved.feedback };
      feedbackSnapshot.current = next;
      setFeedback(next);
      requestAnimationFrame(() => {
        document.getElementById("exam-instant-feedback")?.focus({ preventScroll: true });
        document.getElementById("exam-instant-feedback")?.scrollIntoView({ block: "nearest" });
      });
    } catch (e) {
      setCheckErrors(errors => ({ ...errors, [q.id]: errorMessage(e) }));
    } finally {
      checkLock.current = false;
      setChecking(false);
    }
  }

  const goToQuestion = useCallback(
    (nextIdx: number) => {
      if (!qs.length || checkLock.current) return;
      const clamped = Math.max(0, Math.min(qs.length - 1, nextIdx));
      flushExamInk(deckRef.current);
      if (clamped === safeIndex) {
        showPaneView("question");
        return;
      }
      const apply = () => {
        flushSync(() => {
          setCurrentIndex(clamped);
          resetPaneView();
        });
      };
      const motionOk = !reduced && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
      if (viewMode === "step" && motionOk && "startViewTransition" in document) {
        const root = document.documentElement;
        root.dataset.examTransition = "";
        void document
          .startViewTransition(apply)
          .finished.catch(() => undefined)
          .finally(() => {
            delete root.dataset.examTransition;
          });
      } else {
        apply();
      }
      requestAnimationFrame(() => {
        deckRef.current?.scrollTo({ top: 0, behavior: motionOk ? "smooth" : "auto" });
      });
    },
    [qs, safeIndex, reduced, viewMode, showPaneView, resetPaneView],
  );

  // Typeform「按 Enter 下一題」+ Alt+左右方向鍵切題
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (paused || submitting || viewMode !== "step" || hasOpenModalDialog()) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        if (event.key === "ArrowLeft" && safeIndex > 0) {
          event.preventDefault();
          goToQuestion(safeIndex - 1);
          return;
        }
        if (event.key === "ArrowRight" && safeIndex < qs.length - 1) {
          event.preventDefault();
          goToQuestion(safeIndex + 1);
          return;
        }
      }
      if (
        event.key !== "Enter" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      const isOptionRadioOrCheck =
        target instanceof HTMLInputElement && (target.type === "radio" || target.type === "checkbox");
      if (!isOptionRadioOrCheck && isInteractiveTarget(target)) return;
      const btn = document.querySelector<HTMLButtonElement>(".exam-deck [data-primary-step-action]:not(:disabled)");
      if (!btn) return;
      event.preventDefault();
      btn.click();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paused, submitting, viewMode, safeIndex, qs.length, goToQuestion]);

  if (attempt.error || paper.error) {
    return (
      <div className="space-y-3 p-6">
        <ErrorBox error={attempt.error ?? paper.error} />
        <Button onClick={() => (attempt.error ? void attempt.refetch() : void paper.refetch())}>重新載入試卷</Button>
      </div>
    );
  }
  if (!paper.data || !responsesReady || !parsed) return <Loading />;
  if (!paper.data.ready || !paper.data.questions) return <ErrorBox error="此試卷尚未設定答案" />;
  if (qs.length === 0) return <ErrorBox error="此試卷尚無題目" />;
  if (!restoredQuestion) return <Loading />;

  // 標記待檢查與文章螢光標記（存在 responses 內以 __ 開頭，自動隨伺服器與本機暫存同步）
  const rawFlags = (responses as Record<string, unknown>).__flags;
  const flags = Array.isArray(rawFlags) ? (rawFlags as string[]) : [];
  const flaggedSet = new Set(flags);
  const toggleFlag = (qid: string) => {
    const next = flaggedSet.has(qid) ? flags.filter((f) => f !== qid) : [...flags, qid];
    onChange("__flags", next);
  };

  const rawHighlights = (responses as Record<string, unknown>).__highlights;
  const highlights: PassageHighlight[] = Array.isArray(rawHighlights) ? (rawHighlights as PassageHighlight[]) : [];
  const addHighlight = (h: Omit<PassageHighlight, "id">) => {
    const dup = highlights.some(
      (x) => x.passageId === h.passageId && x.blockId === h.blockId && x.startOffset === h.startOffset && x.endOffset === h.endOffset,
    );
    if (dup) return;
    onChange("__highlights", [...highlights, { ...h, id: crypto.randomUUID() }]);
  };
  const removeHighlight = (id: string) => onChange("__highlights", highlights.filter((h) => h.id !== id));
  const clearHighlights = (passageId: string) =>
    onChange("__highlights", highlights.filter((h) => h.passageId !== passageId));

  const isDone = (q: PublicQuestion) => instant ? Object.hasOwn(feedback, q.id) : examQuestionAnswered(q, responses[q.id]);
  const doneCount = qs.filter(isDone).length;
  const unansweredQs = qs.map((q, idx) => ({ q, idx })).filter(({ q }) => !isDone(q));
  const flaggedQs = qs.map((q, idx) => ({ q, idx })).filter(({ q }) => flaggedSet.has(q.id));
  const fmtT = (s: number) => `${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;

  function togglePanel(name: "tools" | "booklet" | "scratch") {
    const setters = { tools: setToolsOpen, booklet: setBookletOpen, scratch: setScratchOpen };
    const current = { tools: toolsOpen, booklet: bookletOpen, scratch: scratchOpen }[name];
    if (device !== "desktop" && !current) {
      for (const k of Object.keys(setters) as (keyof typeof setters)[]) if (k !== name) setters[k](false);
    }
    setters[name](!current);
    if (!current) setMountedPanels((m) => new Set(m).add(name));
  }

  // 原文舉證題：找出目前題目或子題可接收文章反白引用的目標
  let evidenceTarget: EvidenceTarget | null = null;
  const activeEvidenceSpans: { blockId: string; startOffset?: number; endOffset?: number }[] = [];
  if (!currentFeedback && !checking && currentQ?.type === "evidence") {
    evidenceTarget = {
      label: "設為本題答案",
      onSelectEvidence: (ev) => onChange(currentQ.id, ev),
    };
    const curVal = responses[currentQ.id] as EvidenceResponse | undefined;
    if (curVal && typeof curVal === "object" && "type" in curVal && curVal.type === "SPAN") {
      activeEvidenceSpans.push(curVal);
    }
  } else if (!currentFeedback && !checking && currentQ?.type === "multipart" && currentQ.parts?.length) {
    const qResp = (responses[currentQ.id] && typeof responses[currentQ.id] === "object" && !Array.isArray(responses[currentQ.id])
      ? (responses[currentQ.id] as Record<string, Response>)
      : {}) as Record<string, Response>;
    const evParts = currentQ.parts.filter((p) => p.type === "evidence");
    for (const p of evParts) {
      const pv = qResp[p.id] as EvidenceResponse | undefined;
      if (pv && typeof pv === "object" && "type" in pv && pv.type === "SPAN") activeEvidenceSpans.push(pv);
    }
    const targetPart = evParts.find((p) => !examQuestionAnswered(p, qResp[p.id])) ?? evParts[0];
    if (targetPart) {
      evidenceTarget = {
        label: `設為 (${targetPart.id}) 答案`,
        onSelectEvidence: (ev) => onChange(currentQ.id, { ...qResp, [targetPart.id]: ev }),
      };
    }
  }

  const stageLayout = viewMode === "full" ? "full" : hasLeftMaterial ? "split" : "single";
  const scratchDocked = device !== "phone" && scratchOpen;
  const captionText =
    viewMode === "full"
      ? `全卷瀏覽 · 已完成 ${doneCount} / ${qs.length} 題`
      : currentQ
        ? [
            instant && "Instant",
            currentView?.sectionTitle,
            `第 ${safeIndex + 1} / ${qs.length} 題`,
            QUESTION_TYPE_LABELS[currentQ.type],
            `${currentQ.points} 分`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

  const currentChoiceAnswerText =
    currentQ?.type === "single_choice" && typeof responses[currentQ.id] === "string"
      ? currentQ.optionTexts?.[responses[currentQ.id] as string] ??
        currentView?.choices?.find((c) => c.key.toLowerCase() === String(responses[currentQ.id]).toLowerCase())?.md ??
        String(responses[currentQ.id])
      : null;

  const isFlagged = currentQ ? flaggedSet.has(currentQ.id) : false;

  const navigatorSheet = (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", `全部 (${qs.length})`],
            ["unanswered", `未作答 (${unansweredQs.length})`],
            ["flagged", `待檢查 (${flaggedQs.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setNavFilter(k)}
            className={clsx(
              "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              navFilter === k ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-slate-900/5 text-slate-600 dark:bg-white/10 dark:text-slate-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {parsed.sections.map((sec, sIdx) => {
          const visible = sec.questionIndices.filter((qIdx) => {
            const q = qs[qIdx];
            if (navFilter === "unanswered") return !isDone(q);
            if (navFilter === "flagged") return flaggedSet.has(q.id);
            return true;
          });
          if (visible.length === 0) return null;
          return (
            <div key={`${sec.title ?? "sec"}-${sIdx}`} className="space-y-2">
              {sec.title && <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{sec.title}</div>}
              <div className="grid grid-cols-5 gap-2">
                {visible.map((qIdx) => {
                  const q = qs[qIdx];
                  const answered = isDone(q);
                  const flagged = flaggedSet.has(q.id);
                  const isCur = qIdx === safeIndex && viewMode === "step";
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        if (viewMode === "full") {
                          document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
                        } else {
                          goToQuestion(qIdx);
                        }
                        setNavOpen(false);
                      }}
                      className={clsx(
                        "relative h-11 rounded-xl text-sm font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-white",
                        answered
                          ? "bg-aurora text-on-accent shadow-[var(--shadow-glow)]"
                          : "bg-slate-900/5 hover:bg-slate-900/10 dark:bg-white/10",
                        isCur && "ring-2 ring-amber-500 ring-offset-2 dark:ring-offset-ink-900",
                      )}
                    >
                      {qIdx + 1}
                      {flagged && (
                        <span
                          aria-label="已標記待檢查"
                          className="absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-amber-400 dark:border-ink-900"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="exam-shell"
      data-layout={stageLayout}
      data-view={paneView}
      data-scratch-docked={scratchDocked || undefined}
    >
      <header inert={paused} className="exam-bar">
        <button
          type="button"
          className="exam-exit-btn"
          disabled={pauseBusy || submitting || checking}
          title={timedOut ? "返回試卷（本機作答已保留）" : "暫停並離開（進度已保存，計時停止）"}
          onClick={async () => (timedOut || (await doPause())) && navigate(`/exams/${slug}`)}
        >
          <ArrowLeft size={18} />
          <span className="hidden sm:inline">暫停離開</span>
        </button>

        <div className="exam-bar-heading">
          <h1>{paper.data.document.title}</h1>
          {captionText && <p className="exam-bar-caption">{captionText}</p>}
        </div>

        {stageLayout === "split" && <ExamPaneToggle view={paneView} onChange={showPaneView} />}

        <div className="exam-bar-tools">
          <button
            type="button"
            aria-label={`題號導覽，已完成 ${doneCount} / ${qs.length} 題${flaggedQs.length ? `，${flaggedQs.length} 題待檢查` : ""}`}
            onClick={() => setNavOpen(true)}
            className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-slate-900/5 px-2.5 py-1 text-xs font-semibold hover:bg-slate-900/10 dark:bg-white/10"
          >
            <Ring value={qs.length ? doneCount / qs.length : 0} size={18} stroke={3} />
            <span className="tabular-nums">
              {doneCount}/{qs.length}
            </span>
            {flaggedQs.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                <Flag size={10} weight="fill" /> {flaggedQs.length}
              </span>
            )}
          </button>

          <motion.span
            role="timer"
            aria-label={remaining !== null ? "剩餘時間" : "作答時間"}
            animate={!reduced && remaining !== null && remaining < 300 ? { scale: [1, 1.06, 1] } : {}}
            transition={{ repeat: Infinity, duration: 1 }}
            className={clsx(
              "flex min-h-10 shrink-0 items-center gap-1 rounded-xl px-2.5 py-1 font-mono text-xs font-semibold tabular-nums sm:text-sm",
              remaining !== null && remaining < 300
                ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200"
                : "bg-slate-900/5 dark:bg-white/10",
            )}
          >
            <Timer size={14} />
            {remaining !== null ? fmtT(remaining) : fmtT(elapsed)}
          </motion.span>

          <IconButton
            id="exam-pause"
            className="h-10 w-10"
            label="暫停考試（計時停止、題目隱藏）"
            onClick={() => void doPause()}
            disabled={pauseBusy || submitting || timedOut || checking}
          >
            <Pause size={17} weight="fill" />
          </IconButton>

          {!instant && <IconButton
            className="h-10 w-10"
            label={viewMode === "step" ? "切換為全卷瀏覽" : "切換為逐題作答"}
            active={viewMode === "full"}
            onClick={() => setViewMode((m) => (m === "step" ? "full" : "step"))}
          >
            <SquaresFour size={17} />
          </IconButton>}

          {paper.data.booklet && (
            <IconButton
              className="h-10 w-10"
              disabled={submitting}
              label={`資料手冊：${paper.data.booklet.title}`}
              active={bookletOpen}
              onClick={() => togglePanel("booklet")}
            >
              <BookOpenText size={17} />
            </IconButton>
          )}

          {(allowed === undefined || allowed.length > 0) && (
            <IconButton
              className="h-10 w-10"
              disabled={submitting}
              label="計算機"
              active={toolsOpen}
              onClick={() => togglePanel("tools")}
            >
              <Calculator size={17} />
            </IconButton>
          )}

          <IconButton
            id="exam-scratch-toggle"
            className="h-10 w-10"
            disabled={submitting}
            label="書寫板（演算紙）"
            active={scratchOpen}
            aria-pressed={scratchOpen}
            onClick={() => togglePanel("scratch")}
          >
            <PencilLine size={17} />
          </IconButton>

          {device === "desktop" && (
            <IconButton
              className="hidden h-10 w-10 lg:grid"
              label={focusMode ? "退出專注全螢幕" : "專注全螢幕（隱藏側欄）"}
              active={focusMode}
              onClick={() => setFocusMode((v) => !v)}
            >
              {focusMode ? <CornersIn size={17} /> : <CornersOut size={17} />}
            </IconButton>
          )}

          <Button
            size="sm"
            className="h-10"
            variant="primary"
            onClick={() => (timedOut ? void submit() : setSubmitPrompt(true))}
            disabled={submitting || pauseBusy || checking}
          >
            {submitting ? "交卷中…" : "交卷"}
          </Button>
        </div>

        {/* 底部邊緣分段進度條：每題一段，點擊可跳題 */}
        {qs.length > 0 && (
          <nav aria-label="題目進度" className="exam-progress-rail">
            {qs.map((q, idx) => {
              const answered = isDone(q);
              const flagged = flaggedSet.has(q.id);
              const isCur = viewMode === "step" && idx === safeIndex;
              const state = isCur ? "current" : answered ? "done" : "upcoming";
              return (
                <button
                  key={q.id}
                  type="button"
                  className="exam-progress-seg"
                  data-state={state}
                  data-flagged={flagged || undefined}
                  aria-label={`跳至第 ${idx + 1} 題（${answered ? "已作答" : "未作答"}${flagged ? "、待檢查" : ""}）`}
                  aria-current={isCur ? "step" : undefined}
                  onClick={() => {
                    if (viewMode === "full") {
                      document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
                    } else {
                      goToQuestion(idx);
                    }
                  }}
                >
                  <span className="exam-progress-tip">
                    Q{idx + 1} · {answered ? "已作答" : "未作答"}
                    {flagged ? " · 待檢查" : ""}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {submitError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"
        >
          <p className="min-w-0 flex-1">交卷未成功：{submitError}。作答仍保留在此裝置，請確認連線後重試。</p>
          <Button size="sm" className="h-10" disabled={submitting} onClick={() => void submit()}>
            重試交卷
          </Button>
        </div>
      )}
      {submitting && (
        <p role="status" className="px-4 py-2 text-sm text-slate-500">
          正在儲存作答並交卷，請稍候…
        </p>
      )}

      <div ref={workspaceRef} className="flex min-h-0 min-w-0 flex-1"
        style={scratchDocked ? ({ "--scratch-width": (100 - scratchSplit.split) / 100 } as CSSProperties) : undefined}>
        <ExamStage stageRef={stageRef} passage={stageLayout === "split" && (
          <section
            aria-label={currentPassage?.title ?? "閱讀材料"}
            className="exam-passage-pane"
            inert={paused || pauseBusy || submitting || timedOut}
            ref={passageRef}
          >
            <PassagePane
              passage={currentPassage}
              sharedStemMd={sharedStemMd}
              sharedStemTitle={`第 ${safeIndex + 1} 題 · 共用題幹與資料`}
              highlights={highlights}
              activeEvidenceSpans={activeEvidenceSpans}
              evidenceTarget={evidenceTarget}
              onAddHighlight={addHighlight}
              onRemoveHighlight={removeHighlight}
              onClearHighlights={clearHighlights}
              onBackToQuestion={() => showPaneView("question")}
            />
          </section>
        )}>
          {viewMode === "full" ? (
            <main inert={paused || pauseBusy || submitting || timedOut} className="exam-deck">
              <div className="mx-auto max-w-3xl px-4 py-6" style={{ paddingBottom: "calc(8rem + var(--mvk-h, 0px))" }}>
                <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 text-xs text-slate-600 dark:border-white/10 dark:bg-ink-900 dark:text-slate-300">
                  <span>目前為全卷瀏覽模式</span>
                  <button
                    type="button"
                    onClick={() => setViewMode("step")}
                    className="font-semibold text-ink-900 underline underline-offset-2 dark:text-white"
                  >
                    切回逐題作答介面
                  </button>
                </div>
                <ExamBody md={paper.data.body} questions={qs} responses={responses} onChange={onChange} mode="exam" />
                <Button
                  variant="primary"
                  size="lg"
                  className="mt-6 w-full"
                  onClick={() => setSubmitPrompt(true)}
                  disabled={submitting || pauseBusy}
                >
                  交卷並批改
                </Button>
              </div>
            </main>
          ) : (
            <>
              <main
                aria-label="題目作答區"
                aria-busy={submitting || pauseBusy}
                className="exam-deck"
                inert={paused || pauseBusy || submitting || timedOut}
                ref={deckRef}
              >
                <div className="exam-deck-inner" key={currentQ?.id ?? safeIndex}>
                  {hasLeftMaterial && (
                    <button
                      type="button"
                      className="exam-open-passage"
                      onClick={() => showPaneView("passage")}
                    >
                      <BookOpenText size={17} />
                      {currentPassage ? "查看閱讀文章" : "查看題幹資料"}
                    </button>
                  )}

                  {currentQ && currentView && (
                    <>
                      <div className="exam-step-header">
                        <p className="exam-step-kicker">
                          <span>第 {safeIndex + 1} 題</span>
                          <ArrowRight size={14} />
                          <span className="exam-step-badge">{QUESTION_TYPE_LABELS[currentQ.type]}</span>
                          <span className="exam-step-badge">{currentQ.points} 分</span>
                          {currentQ.commandTerm && <span className="exam-step-badge">{currentQ.commandTerm}</span>}
                        </p>
                        <button
                          type="button"
                          aria-pressed={isFlagged}
                          onClick={() => toggleFlag(currentQ.id)}
                          className="exam-flag-btn"
                        >
                          <Flag size={14} weight={isFlagged ? "fill" : "regular"} />
                          {isFlagged ? "已標記待檢查" : "標記待檢查"}
                        </button>
                      </div>

                      {currentQ.instructions && <p className="exam-question-instructions">{currentQ.instructions}</p>}

                      <div inert={checking && !currentFeedback} className="contents">
                      {currentQ.type === "multipart" && currentQ.parts ? (
                        <>
                          {!currentView.pinStemToPassagePane && currentView.stemMd.trim() && (
                            <div className="exam-question-statement">
                              <Markdown md={currentView.stemMd} mode="exam" />
                            </div>
                          )}
                          <div className="exam-subparts">
                            {currentQ.parts.map((part) => {
                              const partView = currentView.parts?.find((pv) => pv.id === part.id);
                              const qResp = (
                                responses[currentQ.id] && typeof responses[currentQ.id] === "object" && !Array.isArray(responses[currentQ.id])
                                  ? (responses[currentQ.id] as Record<string, Response>)
                                  : {}
                              ) as Record<string, Response>;
                              const partVal = qResp[part.id];
                              const partResult = currentFeedback?.result.parts?.find(result => result.id === part.id);
                              const partDone = examQuestionAnswered(part, partVal);
                              const setPartVal = (v: Response) => onChange(currentQ.id, { ...(responseSnapshot.current[currentQ.id] as Record<string, Response>), [part.id]: v });
                              const choiceCount = currentQ.parts!.filter((p) => ["single_choice", "multi_choice", "true_false", "tfng", "ynng"].includes(p.type)).length;
                              return (
                                <section key={part.id} className="exam-subpart-card" data-answered={partDone || undefined}>
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-sm font-bold">({part.id})</span>
                                      <span className="exam-step-badge">{QUESTION_TYPE_LABELS[part.type]}</span>
                                      <span className="exam-step-badge">{part.points} 分</span>
                                    </div>
                                    <span
                                      className={clsx(
                                        "inline-flex items-center gap-1 text-xs font-semibold",
                                        partDone ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400",
                                      )}
                                    >
                                      {partDone ? <Check size={13} weight="bold" /> : null}
                                      {partDone ? "已作答" : "未作答"}
                                    </span>
                                  </div>
                                  {part.instructions && <p className="exam-question-instructions mb-2">{part.instructions}</p>}
                                  {partView?.hasInlineBlanks ? (
                                    <InlineQuestionMarkdown md={partView.md} q={part} value={partVal} result={partResult} readOnly={!!currentFeedback} onChange={setPartVal} />
                                  ) : (
                                    <>
                                      {partView?.md && (
                                        <div className="prose-md mb-3">
                                          <Markdown md={partView.md} mode="exam" />
                                        </div>
                                      )}
                                      <QuestionControl
                                        typedOnly={instant}
                                        q={part}
                                        value={partVal}
                                        result={partResult}
                                        readOnly={!!currentFeedback}
                                        onChange={setPartVal}
                                        choices={partView?.choices}
                                        shortcuts={!checking && choiceCount === 1}
                                        passage={currentPassage}
                                        onOpenPassage={hasLeftMaterial ? () => showPaneView("passage") : undefined}
                                      />
                                    </>
                                  )}
                                </section>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          {currentView.hasInlineBlanks ? (
                            <InlineQuestionMarkdown
                              md={currentView.stemMd}
                              q={currentQ}
                              value={responses[currentQ.id]}
                              result={currentFeedback?.result}
                              readOnly={!!currentFeedback}
                              onChange={(v) => onChange(currentQ.id, v)}
                            />
                          ) : (
                            <>
                              {currentView.stemMd.trim() && (
                                <div className="exam-question-statement">
                                  {currentQ.type === "single_choice" && currentView.stemMd.includes(GAP_TOKEN) ? (
                                    <StemWithGap md={currentView.stemMd} filledText={currentChoiceAnswerText} />
                                  ) : (
                                    <Markdown md={currentView.stemMd} mode="exam" />
                                  )}
                                </div>
                              )}
                              <QuestionControl
                                typedOnly={instant}
                                q={currentQ}
                                value={responses[currentQ.id]}
                                result={currentFeedback?.result}
                                readOnly={!!currentFeedback}
                                onChange={(v) => onChange(currentQ.id, v)}
                                choices={currentView.choices}
                                shortcuts={!checking}
                                passage={currentPassage}
                                onOpenPassage={hasLeftMaterial ? () => showPaneView("passage") : undefined}
                              />
                            </>
                          )}
                        </>
                      )}
                      </div>

                      {currentFeedback && <div id="exam-instant-feedback" tabIndex={-1}>
                        <InstantFeedbackPanel feedback={currentFeedback} question={currentQ} reviewing={checking} onReview={() => void checkQuestion(true)} />
                      </div>}
                      {checking && !currentFeedback && <p role="status" className="text-sm">正在檢查答案…</p>}
                      {checkErrors[currentQ.id] && <ErrorBox error={checkErrors[currentQ.id]} />}

                      <div className="exam-actions">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={safeIndex === 0 || checking}
                            onClick={() => goToQuestion(safeIndex - 1)}
                          >
                            <ArrowLeft size={16} /> 上一題
                          </Button>
                        </div>

                        <div className="flex items-center gap-3">
                          {!instant && <span className="exam-enter-hint" aria-hidden="true">
                            按 <kbd>Enter ↵</kbd> {safeIndex < qs.length - 1 ? "下一題" : "檢查交卷"}
                          </span>}
                          {instant && !currentFeedback ? (
                            <div className="flex flex-wrap gap-2">
                              {safeIndex < qs.length - 1 && <Button type="button" variant="ghost" disabled={checking} onClick={() => goToQuestion(safeIndex + 1)}>略過</Button>}
                              <Button type="button" variant="primary" data-primary-step-action disabled={checking} onClick={() => void checkQuestion()}>
                                <Check size={16} weight="bold" /> {checking ? "檢查中…" : "檢查答案"}
                              </Button>
                            </div>
                          ) : safeIndex < qs.length - 1 ? (
                            <Button
                              type="button"
                              variant="primary"
                              data-primary-step-action
                              disabled={checking}
                              onClick={() => goToQuestion(safeIndex + 1)}
                            >
                              下一題 <ArrowRight size={16} />
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="primary"
                              data-primary-step-action
                              disabled={submitting || pauseBusy || checking}
                              onClick={() => (timedOut ? void submit() : setSubmitPrompt(true))}
                            >
                              <Check size={16} weight="bold" /> 檢查並交卷
                            </Button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </main>
            </>
          )}
        </ExamStage>

        {/* 平板側欄工具（維持掛載避免 GeoGebra / Qalculate 重載） */}
        {device === "tablet" && (toolsOpen || bookletOpen || scratchOpen) && (
          <div
            className={clsx(
              "relative min-w-80 shrink-0 border-l border-slate-200 bg-white transition-[width] duration-300 dark:border-slate-800 dark:bg-ink-900",
              bookletOpen ? "w-[46%] max-w-2xl" : "w-[42%] max-w-xl",
              scratchDocked && "hidden",
            )}
          >
            {mountedPanels.has("tools") && (
              <div className={clsx("absolute inset-0", !toolsOpen && "hidden")}>
                <ToolPanel allowed={allowed} compactTabs />
              </div>
            )}
            {mountedPanels.has("booklet") && paper.data.booklet && (
              <div className={clsx("absolute inset-0", !bookletOpen && "hidden")}>
                <BookletViewer bookId={paper.data.booklet.id} />
              </div>
            )}
          </div>
        )}

        {scratchDocked && <ExamSplitHandle container={workspaceRef} {...scratchSplit} initial={50}
          label="調整題目與書寫板欄寬度" className="exam-scratch-divider" />}
        {device !== "phone" && mountedPanels.has("scratch") && attempt.data && (
          <aside
            aria-label="書寫板"
            className="exam-scratch-dock"
            hidden={!scratchDocked}
            inert={paused || pauseBusy || submitting || timedOut}
          >
            <div className="flex shrink-0 items-center gap-1 border-b border-black/5 px-3 py-1.5 text-sm font-semibold dark:border-white/10">
              <PencilLine size={16} /> <span className="flex-1">書寫板</span>
              <IconButton label={scratchWide ? "縮小書寫板" : "放大書寫板"} onClick={() => scratchSplit.save(scratchWide ? 50 : 34)}>
                {scratchWide ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
              </IconButton>
              <IconButton label="收起書寫板" onClick={() => {
                setScratchOpen(false);
                document.getElementById("exam-scratch-toggle")?.focus();
              }}>
                <ArrowsInSimple size={16} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1">
              <Scratchpad storageKey={`scratch:${attempt.data.id}`} />
            </div>
          </aside>
        )}
      </div>

      {device === "desktop" && toolsOpen && (
        <FloatingWindow title="計算機" onClose={() => setToolsOpen(false)}>
          <ToolPanel allowed={allowed} />
        </FloatingWindow>
      )}
      {device === "desktop" && bookletOpen && paper.data.booklet && (
        <FloatingWindow title={`資料手冊：${paper.data.booklet.title}`} onClose={() => setBookletOpen(false)}>
          <BookletViewer bookId={paper.data.booklet.id} />
        </FloatingWindow>
      )}
      {device === "phone" && paper.data.booklet && (
        <BottomPanel open={bookletOpen} onClose={() => setBookletOpen(false)} title={paper.data.booklet.title}>
          <BookletViewer bookId={paper.data.booklet.id} />
        </BottomPanel>
      )}
      {device === "phone" && (
        <BottomPanel open={toolsOpen} onClose={() => setToolsOpen(false)} title="計算機">
          <ToolPanel allowed={allowed} compactTabs />
        </BottomPanel>
      )}
      {device === "phone" && attempt.data && (
        <BottomPanel open={scratchOpen} onClose={() => setScratchOpen(false)} title="書寫板" height="92dvh">
          <Scratchpad storageKey={`scratch:${attempt.data.id}`} />
        </BottomPanel>
      )}

      <AnimatePresence>
        {paused && (
          <motion.div
            key="paused"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-white p-6 dark:bg-ink-950"
            role="dialog"
            aria-modal="true"
            aria-label="考試已暫停"
            ref={pausePanel}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const buttons = [...(pausePanel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
              const first = buttons[0],
                last = buttons.at(-1);
              if (event.shiftKey && (document.activeElement === first || document.activeElement === pausePanel.current)) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <motion.div
              initial={{ y: 16, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className="w-full max-w-sm text-center"
            >
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-aurora text-on-accent shadow-[var(--shadow-lift)]">
                <Pause size={36} weight="fill" />
              </div>
              <h2 className="mt-6 font-display text-2xl font-semibold">考試已暫停</h2>
              <p className="mt-2 text-sm text-slate-500">{paper.data.document.title}</p>
              <div className="mt-5 flex justify-center gap-6 text-sm">
                <div>
                  <div className="font-mono text-2xl font-semibold">{fmtT(elapsed)}</div>
                  <div className="text-xs text-slate-500">已作答時間</div>
                </div>
                {remaining !== null && (
                  <div>
                    <div className="font-mono text-2xl font-semibold">{fmtT(Math.max(0, remaining))}</div>
                    <div className="text-xs text-slate-500">剩餘時間</div>
                  </div>
                )}
                <div>
                  <div className="font-mono text-2xl font-semibold">
                    {doneCount}/{qs.length}
                  </div>
                  <div className="text-xs text-slate-500">已作答</div>
                </div>
              </div>
              <p className="mt-5 text-xs text-slate-400">暫停期間不計時；進度已保存，換裝置也能繼續。</p>
              <Button variant="primary" size="lg" className="mt-6 w-full" onClick={doResume} disabled={pauseBusy}>
                <Play size={18} weight="fill" /> 繼續考試
              </Button>
              <button
                onClick={() => navigate(`/exams/${slug}`)}
                className="mt-3 text-sm text-slate-500 underline-offset-2 hover:underline"
              >
                先離開，稍後再繼續
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet
        open={submitPrompt}
        onClose={() => {
          if (!submitting) setSubmitPrompt(false);
        }}
        title="確認交卷"
      >
        <div className="space-y-4 p-5">
          <p className="text-sm leading-6">
            {instant ? `已檢查 ${doneCount} / ${qs.length} 題。交卷後只計入已檢查的作答。` : doneCount < qs.length
              ? `已完成 ${doneCount} / ${qs.length} 題，還有 ${qs.length - doneCount} 題尚未完成。`
              : `已完成全部 ${qs.length} 題。確認交卷並查看批改結果？`}
          </p>

          {unansweredQs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-500">點擊跳回未作答題目：</div>
              <div className="flex flex-wrap gap-1.5">
                {unansweredQs.map(({ q, idx }) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setSubmitPrompt(false);
                      setViewMode("step");
                      goToQuestion(idx);
                    }}
                    className="rounded-lg bg-slate-900/5 px-2.5 py-1 font-mono text-xs font-semibold hover:bg-slate-900/10 dark:bg-white/10"
                  >
                    Q{idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {flaggedQs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">已標記待檢查題目：</div>
              <div className="flex flex-wrap gap-1.5">
                {flaggedQs.map(({ q, idx }) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      setSubmitPrompt(false);
                      setViewMode("step");
                      goToQuestion(idx);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1 font-mono text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-200"
                  >
                    <Flag size={11} weight="fill" /> Q{idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button className="min-h-11 flex-1" onClick={() => setSubmitPrompt(false)}>
              返回檢查
            </Button>
            <Button className="min-h-11 flex-1" variant="primary" disabled={submitting} onClick={() => void submit()}>
              確認交卷
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet open={navOpen} onClose={() => setNavOpen(false)} title="題號導覽">
        {navigatorSheet}
      </Sheet>
    </div>
  );
}
