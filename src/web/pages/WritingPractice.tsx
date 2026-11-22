import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, BookOpenText, Check, ClipboardText, PencilSimple, Plus } from "@phosphor-icons/react";
import { STUDY_MOTION } from "../../shared/motion";
import type { WritingPractice, WritingLanguage, WritingStatus, WritingSummary } from "../../shared/writing-practice";
import { Button, Empty, ErrorBox, Loading, PageHeader, Sheet, inputCls, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { linkCatalogFont } from "../lib/fonts/loader";
import { ExamPaneToggle, ExamStage, useExamPane } from "../features/exam/ExamStage";
import { HandwritingEditor, blockTransfer } from "../features/writing/HandwritingEditor";
import { WritingControls } from "../features/writing/WritingControls";
import { AnnotatedDraft, CorrectionReview, WritingFeedbackView } from "../features/writing/WritingFeedback";
import "../features/writing/writing.css";

const STATUS: Record<WritingStatus, string> = {
  draft: "待寫初稿",
  awaiting_feedback: "等待批改",
  revision: "可複習及寫定稿",
  complete: "已完成",
};
const LANGUAGES: Record<WritingLanguage, string> = { en: "英文", zh: "中文" };
const listKey = (userId: string) => ["writing-practices", userId] as const;

async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("無法存取剪貼簿，請確認瀏覽器的剪貼簿權限");
  }
}

function GenerationSheet({ onClose }: { onClose: () => void }) {
  const [language, setLanguage] = useState<WritingLanguage>("en");
  const [topic, setTopic] = useState("");
  const instruction = `請使用已連線的 STUDY MCP，呼叫 create_writing_practice 為我建立一題${LANGUAGES[language]}寫作練習${topic.trim() ? `。我想練習：${topic.trim()}` : ""}。出題時請一併設定 markscheme，包含各項配分與給分條件。完成後請給我作答網址。`;
  return <Sheet open title="讓 chatbot 出題" onClose={onClose}>
    <div className="space-y-4">
      <p className="writing-muted">選擇語言，將指令貼到已連線 STUDY MCP 的 chatbot。完成後可從 chatbot 提供的網址進入，或回此頁重新整理。</p>
      <label className="grid gap-2 text-sm font-medium">作答語言
        <select className={inputCls} value={language} onChange={(event) => setLanguage(event.target.value as WritingLanguage)}>
          <option value="en">英文</option><option value="zh">中文</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">想練習的主題、文體或難度（選填）
        <input className={inputCls} value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} />
      </label>
      <Button type="button" variant="primary" onClick={() => void copyText(instruction, "已複製出題指令")}><ClipboardText size={18} />複製 MCP 出題指令</Button>
    </div>
  </Sheet>;
}

function WritingList() {
  const user = useUser();
  const [generate, setGenerate] = useState(false);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: listKey(user.id), queryFn: () => api.get<{ practices: WritingSummary[] }>("/api/writing"),
  });
  return <Page>
    <PageHeader title="Writing Practice" subtitle="練習寫作、閱讀紅筆批註，再依評語完成定稿。"
      actions={<>
        <Button type="button" disabled={isFetching} onClick={() => void refetch()}>重新整理</Button>
        {user.access?.features.ai !== false && <Button type="button" variant="primary" onClick={() => setGenerate(true)}><Plus size={18} />MCP 出題</Button>}
      </>} />
    {isPending ? <Loading label="載入寫作練習" rows={2} /> : error ? <ErrorBox error={errorMessage(error)} /> :
      data.practices.length ? <ul className="writing-list">
        {data.practices.map((practice) => <li key={practice.id}>
          <Link to={`/writing/${practice.id}`}>
            <div><h2>{practice.title}</h2><p>{LANGUAGES[practice.language]} · {STATUS[practice.status]}</p></div>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </li>)}
      </ul> : <Empty icon={<PencilSimple size={32} />} title="還沒有寫作練習" />}
    {generate && <GenerationSheet onClose={() => setGenerate(false)} />}
  </Page>;
}

function useLocalWriting(key: string) {
  const [text, setText] = useState(() => {
    try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; }
  });
  function save(value: string) {
    setText(value);
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch { /* Editing still works if browser storage is disabled. */ }
  }
  return [text, save] as const;
}

type Scene = "draft" | "awaiting_feedback" | "review" | "revision" | "complete";
const STAGES = ["初稿", "批改與複習", "Final draft"];

function WritingWorkspace({ practice }: { practice: WritingPractice }) {
  const user = useUser();
  const query = useQueryClient();
  const device = useDevice();
  const reduce = useReducedMotion();
  const workspace = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deck = useRef<HTMLElement>(null);
  const { view, show: showPane } = useExamPane(stageRef);
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus({ preventScroll: true }), []);
  const [panel, setPanel] = useState<"review" | "revision" | null>(null);
  const [draft, setDraft] = useLocalWriting(`writing:${user.id}:${practice.id}:draft`);
  const [finalDraft, setFinalDraft] = useLocalWriting(`writing:${user.id}:${practice.id}:final`);
  const scene: Scene = practice.status === "revision" ? panel ?? "review" : practice.status === "complete" && panel === "review" ? "review" : practice.status;
  const editing = scene === "draft" || scene === "revision";
  const stage = scene === "draft" ? 0 : scene === "awaiting_feedback" || scene === "review" ? 1 : 2;
  const gradePrompt = `請使用已連線的 STUDY MCP 批改我的 Writing Practice 初稿。先以 get_writing_draft 讀取 practice_id ${practice.id} 的原文與 markscheme，再依各項規準評分。用 submit_writing_feedback 提交各項評語、總評與紅筆批註，逐字引用需修改的片段並提供單字、文法等修正。完成後請給我練習網址。`;

  useEffect(() => {
    const chinese = practice.language === "zh";
    void linkCatalogFont(chinese ? "LXGW WenKai TC" : "Caveat");
    void linkCatalogFont(chinese ? "Noto Serif TC" : "Source Serif 4");
  }, [practice.language]);

  useEffect(() => {
    const pane = workspace.current;
    const viewport = window.visualViewport;
    if (!editing || !pane || !viewport) return;
    const resize = () => {
      if (viewport.scale === 1 && viewport.height < window.innerHeight) {
        pane.style.setProperty("--writing-visible-height", `${viewport.height}px`);
      } else {
        pane.style.removeProperty("--writing-visible-height");
      }
    };
    resize();
    viewport.addEventListener("resize", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      pane.style.removeProperty("--writing-visible-height");
    };
  }, [editing]);

  const submit = useMutation({
    mutationFn: ({ part, text }: { part: "draft" | "final"; text: string }) =>
      api.post<WritingPractice>(`/api/writing/${practice.id}/${part}`, { text }),
    onSuccess: (result, { part }) => {
      (part === "draft" ? setDraft : setFinalDraft)("");
      query.setQueryData([...listKey(user.id), practice.id], result);
      void query.invalidateQueries({ queryKey: listKey(user.id), exact: true });
    },
    onError: () => { void query.invalidateQueries({ queryKey: [...listKey(user.id), practice.id] }); },
  });
  const headings: Record<Scene, string> = {
    draft: "撰寫初稿",
    awaiting_feedback: "初稿已送出",
    review: "看看紅筆批註",
    revision: "撰寫 final draft",
    complete: "定稿已完成",
  };
  const locked = stage < 2;
  const focusDraft = scene === "draft" && practice.language === "en" && device === "desktop";
  const stageMotion = reduce ? { opacity: 1 } : { opacity: 1, y: 0 };
  const transfer = locked ? blockTransfer : undefined;
  const feedback = practice.feedback;
  const reference = practice.draft;

  function showCorrection(id: string) {
    showPane("question");
    requestAnimationFrame(() => {
      const note = document.getElementById(id);
      note?.focus({ preventScroll: true });
      note?.scrollIntoView({ block: "nearest" });
    });
  }

  return <div ref={workspace} className="exam-shell writing-workspace" data-layout="split" data-view={view}
    data-language={practice.language} data-editing={editing || undefined}
    onCopy={transfer} onCut={transfer} onPaste={transfer} onDragStartCapture={transfer} onDrop={transfer}>
    <header className="exam-bar">
      <Link to="/writing" className="exam-exit-btn"><ArrowLeft size={18} /><span className="hidden sm:inline">Writing Practice</span><span className="sr-only sm:hidden">返回寫作練習</span></Link>
      <div className="exam-bar-heading">
        <h1 className="writing-prompt-title" lang={practice.language}>{practice.title}</h1>
      </div>
      <ol className="writing-steps" aria-label="寫作進度">
        {STAGES.map((label, index) => <li key={label} aria-current={index === stage ? "step" : undefined}>
          <span aria-hidden="true">{stage > index || practice.status === "complete" ? <Check size={12} weight="bold" /> : index + 1}</span>{label}
        </li>)}
      </ol>
      <ExamPaneToggle view={view} onChange={showPane} label="切換寫作題目或作答區"
        passageLabel={scene === "review" ? "題目與圈註" : stage === 2 ? "題目與初稿" : "題目"}
        answerLabel={stage === 0 ? "作答" : stage === 1 ? "批改" : "定稿"} />
      <WritingControls storageKey={`writing:${user.id}:${practice.id}:elapsed`} running={editing} />
    </header>
    <ExamStage stageRef={stageRef} passage={
      <aside className="exam-passage-pane" aria-label="寫作題目與參考">
        <div className="exam-passage-inner">
          <header className="exam-passage-header">
            <h2 className="exam-passage-title writing-prompt-title">寫作題目</h2>
          </header>
          <p className="exam-passage-blocks writing-prompt" lang={practice.language}>{practice.prompt}</p>
          {feedback && reference !== null && scene === "review" && <section className="writing-reference writing-locked-reference">
            <h3>圈註初稿</h3>
            <AnnotatedDraft draft={reference} corrections={feedback.corrections} language={practice.language} onCorrection={showCorrection} />
          </section>}
          {feedback && reference !== null && stage === 2 && <section className="writing-reference">
            <div className="writing-reference-heading">
              <h3>初稿與紅筆批註</h3>
              <Button type="button" size="sm" onClick={() => void copyText(reference, "已複製初稿原文")}><ClipboardText size={16} />複製初稿</Button>
            </div>
            <AnnotatedDraft draft={reference} corrections={feedback.corrections} language={practice.language} />
            <p className="writing-muted writing-summary">{feedback.summary}</p>
            <CorrectionReview corrections={feedback.corrections} compact />
          </section>}
        </div>
      </aside>
    }>
      <main className="exam-deck writing-deck" ref={deck} aria-label="寫作作答區">
        <AnimatePresence initial={false} mode="wait" onExitComplete={() => {
          deck.current?.scrollTo({ top: 0 });
          if (view === "question") stageRef.current?.scrollTo({ top: 0 });
        }}>
          <motion.section key={scene} className="exam-deck-inner writing-scene" data-scene={scene}
            initial={reduce ? false : { opacity: 0, y: STUDY_MOTION.travel }}
            animate={stageMotion} exit={reduce ? { opacity: 1 } : { opacity: 0, y: -6, transition: { duration: STUDY_MOTION.feedback } }}
            transition={{ duration: reduce ? 0 : STUDY_MOTION.instruction, ease: STUDY_MOTION.ease }}>
            {!editing && <button type="button" className="exam-open-passage" onClick={() => showPane("passage")}>
              <BookOpenText size={17} />{scene === "review" ? "查看題目與圈註" : stage === 2 ? "查看題目與初稿" : "查看寫作題目"}
            </button>}
            <header className={editing ? "writing-editor-header" : undefined}>
              <h2 className="exam-question-statement" ref={focusDraft ? undefined : focusHeading} tabIndex={-1}>{headings[scene]}</h2>
              {scene === "revision" && <p id="writing-final-hint" className="exam-question-instructions">參照題目、初稿和評語改寫。現在可以從初稿複製文字貼到定稿。</p>}
            </header>

            {scene === "draft" && <form className="writing-form" onSubmit={(event) => { event.preventDefault(); submit.mutate({ part: "draft", text: draft }); }}>
              <label htmlFor="writing-draft" className="sr-only">初稿</label>
              <HandwritingEditor id="writing-draft" value={draft} onChange={setDraft} language={practice.language}
                disabled={submit.isPending} autoFocus={focusDraft} />
              {submit.isError && <ErrorBox error={errorMessage(submit.error)} />}
              <div className="exam-actions writing-actions"><Button type="submit" variant="primary" disabled={!draft.trim() || submit.isPending}>{submit.isPending ? "送出中…" : "送出初稿"}<ArrowRight size={18} /></Button></div>
            </form>}

            {scene === "awaiting_feedback" && <>
              <p className="exam-question-instructions">將批改指令貼到已連線 STUDY MCP 的 chatbot。收到評分與紅筆批註後，此頁會自動更新。</p>
              <div className="exam-actions writing-actions">
                <Button type="button" variant="primary" onClick={() => void copyText(gradePrompt, "已複製批改指令")}><ClipboardText size={18} />複製 MCP 批改指令</Button>
              </div>
            </>}

            {scene === "review" && <>
              <WritingFeedbackView practice={practice} />
              <div className="exam-actions writing-actions"><Button type="button" variant="primary" onClick={() => setPanel(practice.status === "complete" ? null : "revision")}>
                {practice.status === "complete" ? "查看定稿" : "開始撰寫 final draft"}<ArrowRight size={18} />
              </Button></div>
            </>}

            {scene === "revision" && <form className="writing-form" onSubmit={(event) => { event.preventDefault(); submit.mutate({ part: "final", text: finalDraft }); }}>
              <label htmlFor="writing-final" className="sr-only">Final draft</label>
              <HandwritingEditor id="writing-final" value={finalDraft} onChange={setFinalDraft} language={practice.language}
                describedBy="writing-final-hint" disabled={submit.isPending} allowTransfer />
              {submit.isError && <ErrorBox error={errorMessage(submit.error)} />}
              <div className="exam-actions">
                <Button type="button" variant="ghost" onClick={() => setPanel("review")}>返回複習</Button>
                <Button type="submit" variant="primary" disabled={!finalDraft.trim() || submit.isPending}>{submit.isPending ? "儲存中…" : "儲存定稿"}<Check size={18} /></Button>
              </div>
            </form>}

            {scene === "complete" && <>
              <p className="writing-quote writing-hand" lang={practice.language}>{practice.final_draft}</p>
              <div className="exam-actions writing-actions"><Button type="button" onClick={() => setPanel("review")}>查看初稿評分</Button></div>
            </>}
          </motion.section>
        </AnimatePresence>
      </main>
    </ExamStage>
  </div>;
}

function WritingDetail({ id }: { id: string }) {
  const user = useUser();
  const result = useQuery({
    queryKey: [...listKey(user.id), id],
    queryFn: () => api.get<WritingPractice>(`/api/writing/${encodeURIComponent(id)}`),
    refetchInterval: ({ state }) => state.data?.status === "awaiting_feedback" ? 4000 : false,
  });
  if (result.data) return <WritingWorkspace key={`${user.id}:${id}`} practice={result.data} />;
  if (result.isPending) return <Loading label="載入寫作練習" rows={2} />;
  return <Page><Link to="/writing" className="writing-back"><ArrowLeft size={16} />Writing Practice</Link>
    <ErrorBox error={errorMessage(result.error)} /><Button onClick={() => void result.refetch()}>重試</Button>
  </Page>;
}

export default function WritingPracticePage() {
  const { id } = useParams();
  return id ? <WritingDetail id={id} /> : <WritingList />;
}
