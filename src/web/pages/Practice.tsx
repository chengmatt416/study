import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowArcLeft, ArrowLeft, ArrowRight, BookOpenText, Cards, Check, CircleNotch, Copy, Exam, Flame, FolderOpen, GearSix, HandPointing, Lightning, PenNib, SpeakerHigh, SpeakerSlash, Sparkle, X } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { PRACTICE_DIFFICULTIES, PRACTICE_DIFFICULTY_LABELS, PRACTICE_IB_GRADES, PRACTICE_KINDS, type PracticeAnswer, type PracticeDifficulty, type PracticeFeedback, type PracticeIbGrade, type PracticeItem, type PracticeKind, type PracticeLevel, type PracticeRef, type PracticeScale, type PracticeSource, type PracticeSubject } from "../../shared/practice";
import { Markdown } from "../components/Markdown";
import { Sheet } from "../components/ui";
import { bufferPracticeFeed, createPracticeFeed } from "../features/practice/feed";
import { firstPracticeCursor, practicePageQuery, practiceSubjectKey, resetPracticePages } from "../features/practice/cache";
import { practiceLanes, type PracticeLane } from "../features/practice/plan";
import { PracticeInk } from "../features/practice/PracticeInk";
import { PracticeLibrarySheet } from "../features/practice/PracticeLibrarySheet";
import { PracticeSettingsSheet } from "../features/practice/PracticeSettingsSheet";
import { createPracticePreview, type PracticePreview } from "../features/practice/preview";
import { sheetAnimation, usePracticeSettings, type PracticeSettings } from "../features/practice/settings";
import { usePracticeSound } from "../features/practice/sound";
import { api, ApiError, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import "../features/practice/practice.css";

const KIND = {
  question: { label: "刷題", icon: Exam },
  flashcard: { label: "字卡", icon: Cards },
  concept: { label: "觀念", icon: BookOpenText },
};

type PracticePlan = { subjects: PracticeSubject[]; lanes: PracticeLane[]; source: PracticeSource };

function subjectCaption(counts: Partial<Record<PracticeKind, number>>) {
  return [
    counts.question && `${counts.question} 題`,
    counts.flashcard && `${counts.flashcard} 張字卡`,
    counts.concept && `${counts.concept} 則觀念`,
  ].filter(Boolean).join(" · ") || "目前設定沒有內容";
}

function PracticeButton({ children, busy, disabled, onClick }: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return <button className="practice-primary" type={onClick ? "button" : "submit"} disabled={disabled || busy} onClick={onClick}>
    {busy && <CircleNotch className="practice-spinner" aria-hidden="true" size={20} />}
    {children}
    {!busy && <ArrowRight size={20} weight="bold" />}
  </button>;
}

export default function Practice() {
  const user = useUser();
  return <PracticeMode key={user.id} userId={user.id} allowAi={user.access?.features.ai !== false}
    canShare={user.access?.features.shared_write !== false} />;
}

function PracticeMode({ userId, allowAi, canShare }: { userId: string; allowAi: boolean; canShare: boolean }) {
  const [params] = useSearchParams();
  const query = useQueryClient();
  const [source, setSource] = useState<PracticeSource>("all");
  const subjects = useQuery({
    queryKey: [...practiceSubjectKey(userId), source],
    queryFn: ({ signal }) => api.get<{ subjects: PracticeSubject[] }>(`/api/practice/subjects?source=${source}`, { signal }).then(result => result.subjects),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const [selected, setSelected] = useState<string[]>(() => params.getAll("subject").slice(0, 32));
  const [kinds, setKinds] = useState<PracticeKind[]>(() => [...PRACTICE_KINDS]);
  const [difficulty, setDifficulty] = useState<PracticeDifficulty>("medium");
  const [grade, setGrade] = useState<PracticeIbGrade>(5);
  const [session, setSession] = useState<PracticePlan | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = usePracticeSettings();
  const sound = usePracticeSound(settings);
  const preview = useMemo(createPracticePreview, []);
  useEffect(() => preview.close, [preview]);
  const levels = useMemo<Record<PracticeScale, PracticeLevel>>(() => ({ general: difficulty, ib: `ib-${grade}` }), [difficulty, grade]);
  const picked = useMemo(() => (subjects.data ?? []).filter(subject => selected.includes(subject.id)), [subjects.data, selected]);
  const scales = new Set(picked.map(subject => subject.practice_scale));
  const lanes = useMemo(() => practiceLanes(picked, kinds, levels), [picked, kinds, levels]);
  const available = subjects.data ?? [];
  const total = picked.reduce((sum, subject) => sum + kinds.reduce((count, kind) =>
    count + (subject.levels[levels[subject.practice_scale]]?.[kind] ?? 0), 0), 0);
  const needsContent = picked.length > 0 && kinds.length > 0 && total === 0;
  const failed = subjects.isError && !subjects.data;

  useEffect(() => {
    if (session || showLibrary || !lanes.length) return;
    let active = true;
    const warm = window.setTimeout(() => {
      for (const lane of lanes) {
        void query.fetchQuery(practicePageQuery(userId, lane, firstPracticeCursor, source)).then(page => {
          if (active && page.items[0]) preview.prepare(page.items[0]);
        }).catch(() => {});
      }
    }, 160);
    return () => { active = false; window.clearTimeout(warm); };
  }, [session, showLibrary, query, userId, lanes, preview, source]);

  async function refreshCatalog() {
    await resetPracticePages(query, userId);
    await query.invalidateQueries({ queryKey: practiceSubjectKey(userId) });
  }

  function playClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("button, a[href], input, select, summary, [data-sheet-backdrop]");
    if (!control || control.matches(":disabled, [aria-disabled='true'], [data-practice-sound-preview]")) return;
    if (control.hasAttribute("data-practice-sound-toggle")) {
      if (!settings.soundEnabled) sound.play("click", { ...settings, soundEnabled: true });
      return;
    }
    sound.play("click");
  }

  const settingsSheet = <PracticeSettingsSheet open={showSettings} settings={settings} onClose={() => setShowSettings(false)}
    onChange={patch => setSettings(previous => ({ ...previous, ...patch }))}
    preview={() => sound.play("streak")} />;

  const content = session
    ? <PracticeSession userId={userId} plan={session} allowAi={allowAi} settings={settings} sound={sound} preview={preview}
      onSettings={() => setShowSettings(true)}
      toggleSound={() => setSettings(previous => ({ ...previous, soundEnabled: !previous.soundEnabled }))}
      onExit={() => { setSession(null); void subjects.refetch(); }} />
    : <main className="practice-mode practice-picker" data-practice-motion={settings.motion}>
    <header className="practice-header">
      <div className="practice-header-actions">
        <Link to="/" aria-label="回首頁" className="practice-icon-button"><ArrowLeft size={22} weight="bold" /></Link>
        <button type="button" aria-label="音效與動畫設定" className="practice-icon-button" onClick={() => setShowSettings(true)}><GearSix size={20} /></button>
      </div>
      <span>混合複習</span>
      <div className="practice-header-actions">
        <button type="button" className="practice-text-button" onClick={() => setShowImport(true)}>MCP 加入</button>
        <button type="button" aria-label="管理內容" title="管理內容" className="practice-icon-button" onClick={() => setShowLibrary(true)}><FolderOpen size={21} /></button>
      </div>
    </header>
    <div className="practice-scroll">
      <div className="practice-content">
        <div className="practice-picker-intro">
          <div>
            <h1>這次想複習哪一科？</h1>
            <p className="practice-lead">選一科或多科開始。</p>
          </div>
          <div className="practice-emblem" aria-hidden="true"><Lightning size={33} weight="fill" /></div>
        </div>
        {available.length > 0 && <PracticeOptions kinds={kinds} toggleKind={kind => setKinds(previous => previous.includes(kind) ? previous.filter(item => item !== kind) : [...previous, kind])}
          difficulty={difficulty} setDifficulty={setDifficulty} showDifficulty={scales.has("general")}
          grade={grade} setGrade={setGrade} showGrade={scales.has("ib")} />}
        <label className="practice-source-toggle">
          <input type="checkbox" checked={source === "all"} onChange={event => setSource(event.target.checked ? "all" : "own")} />
          包含成員共享內容
        </label>
        {subjects.isPending ? <div className="practice-picker-skeleton" role="status">
          <span className="sr-only">正在載入科目</span><span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
        </div>
          : failed ? <p role="alert" className="practice-message practice-picker-message">{errorMessage(subjects.error)}</p>
          : !available.length ? <p className="practice-message practice-picker-message">目前沒有已設定的科目。</p>
          : <fieldset className="practice-subjects">
            <legend className="sr-only">選擇科目</legend>
            {available.map(subject => {
              const checked = selected.includes(subject.id);
              const counts: Partial<Record<PracticeKind, number>> = {};
              for (const kind of kinds) counts[kind] = subject.levels[levels[subject.practice_scale]]?.[kind];
              return <label className="practice-subject" key={subject.id} data-empty={!counts.question && !counts.flashcard && !counts.concept}>
                <input type="checkbox" checked={checked} disabled={!checked && picked.length >= 32} onChange={() => {
                  setSelected(ids => ids.includes(subject.id) ? ids.filter(id => id !== subject.id) : [...ids, subject.id]);
                }} aria-label={subject.name} aria-describedby={`practice-count-${subject.id}`} />
                <span className="practice-subject-dot" style={{ background: subject.color ?? undefined }} />
                <span className="practice-subject-copy">
                  <strong>{subject.name}</strong>
                  <small id={`practice-count-${subject.id}`}>{subjectCaption(counts)}</small>
                </span>
                <span className="practice-subject-check" aria-hidden="true"><Check size={15} weight="bold" /></span>
              </label>;
            })}
          </fieldset>}
      </div>
    </div>
    <footer className="practice-footer">
      {picked.length > 0 && <p className="practice-selection-total" role="status">
        {kinds.length > 0 ? <>已選 {picked.length} 科<span aria-hidden="true">·</span>{total} 項可複習</> : "請至少選一種複習內容"}
      </p>}
      {failed ? <PracticeButton onClick={() => void subjects.refetch()} busy={subjects.isFetching}>重新載入科目</PracticeButton>
        : <PracticeButton disabled={!picked.length || !kinds.length} onClick={() => {
          if (needsContent) setShowImport(true);
          else setSession({ subjects: picked, lanes, source });
        }}>
          {needsContent ? "用 MCP 加入內容" : "開始複習"}
        </PracticeButton>}
    </footer>
    <PracticeImportHelp open={showImport} subjects={picked} kinds={kinds} difficulty={difficulty} grade={grade} motion={settings.motion} onClose={() => {
      setShowImport(false);
      void refreshCatalog();
    }} />
    <PracticeLibrarySheet open={showLibrary} userId={userId} canShare={canShare} motion={settings.motion}
      onClose={() => setShowLibrary(false)} onChanged={refreshCatalog} />
  </main>;

  return <div className="contents" onClickCapture={playClick}>{content}{settingsSheet}</div>;
}

function PracticeOptions({ kinds, toggleKind, difficulty, setDifficulty, showDifficulty, grade, setGrade, showGrade }: {
  kinds: PracticeKind[];
  toggleKind: (kind: PracticeKind) => void;
  difficulty: PracticeDifficulty;
  setDifficulty: (difficulty: PracticeDifficulty) => void;
  showDifficulty: boolean;
  grade: PracticeIbGrade;
  setGrade: (grade: PracticeIbGrade) => void;
  showGrade: boolean;
}) {
  return <div className="practice-config">
    <fieldset className="practice-config-field">
      <legend>這次要複習</legend>
      <div className="practice-segments practice-kind-segments">
        {PRACTICE_KINDS.map(kind => {
          const { icon: Icon, label } = KIND[kind];
          return <label key={kind}>
            <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />
            <Icon size={17} />{label}
          </label>;
        })}
      </div>
    </fieldset>
    {showDifficulty && <fieldset className="practice-config-field">
      <legend>{showGrade ? "一般科目難度" : "難度"}</legend>
      <div className="practice-segments">
        {PRACTICE_DIFFICULTIES.map(level => <label key={level}>
          <input type="radio" name="practice-difficulty" checked={difficulty === level} onChange={() => setDifficulty(level)} />{PRACTICE_DIFFICULTY_LABELS[level]}
        </label>)}
      </div>
    </fieldset>}
    {showGrade && <fieldset className="practice-config-field">
      <legend>IB 目標分數</legend>
      <div className="practice-segments practice-grade-segments">
        {PRACTICE_IB_GRADES.map(value => <label key={value}>
          <input type="radio" name="practice-ib-grade" aria-label={`${value} 分`} checked={grade === value} onChange={() => setGrade(value)} />{value}
        </label>)}
      </div>
    </fieldset>}
  </div>;
}

function PracticeImportHelp({ open, subjects, kinds, difficulty, grade, motion, onClose }: {
  open: boolean; subjects: PracticeSubject[]; kinds: PracticeKind[]; difficulty: PracticeDifficulty; grade: PracticeIbGrade;
  motion: PracticeSettings["motion"]; onClose: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const requested = PRACTICE_KINDS.filter(kind => kinds.includes(kind)).map(kind => KIND[kind].label).join("、") || "題目、字卡與觀念";
  const groups = (["ib", "general"] as const).flatMap(scale => {
    const names = subjects.filter(subject => subject.practice_scale === scale).map(subject => subject.name);
    const level = scale === "ib" ? `IB 目標分數 ${grade} 分` : `一般難度：${PRACTICE_DIFFICULTY_LABELS[difficulty]}`;
    return names.length ? [`${names.join("、")}（${level}）`] : [];
  });
  const prompt = groups.length
    ? `為我的 STUDY 混合複習設計 ${groups.join("、")} 的${requested}。請先問我要複習的主題，再透過 MCP 加入。`
    : `為我的 STUDY 混合複習設計${requested}。請先問我要複習的科目、主題和該科的分級，再透過 MCP 加入。`;
  const close = () => { setStatus("idle"); onClose(); };
  return <Sheet open={open} onClose={close} title="用 MCP 加入複習內容" animation={sheetAnimation(motion)}>
      <div className="practice-import">
        <p>把這段指令交給已連線 STUDY MCP 的 AI。它會用 <code>add_practice_items</code> 加入專用內容。</p>
        <blockquote>{prompt}</blockquote>
        <button className="practice-copy-button" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(prompt); setStatus("copied"); }
          catch { setStatus("manual"); }
        }}>
          {status === "copied" ? <Check size={18} /> : <Copy size={18} />}
          {status === "copied" ? "已複製指令" : "複製指令"}
        </button>
        {status !== "idle" && <p role="status">{status === "copied" ? "已複製。請貼到 AI 對話。" : "可直接選取上方的指令複製。"}</p>}
        <button className="practice-text-button practice-import-refresh" type="button" onClick={close}>已加入，重新整理科目</button>
      </div>
  </Sheet>;
}

type PracticeStep = { turn: number; index: number };
type PracticeQueue = { queue: ReturnType<typeof bufferPracticeFeed>; signal: AbortSignal };

function PracticeSession({ userId, plan, allowAi, settings, sound, preview, onSettings, toggleSound, onExit }: {
  userId: string;
  plan: PracticePlan;
  allowAi: boolean;
  settings: PracticeSettings;
  sound: ReturnType<typeof usePracticeSound>;
  preview: ReturnType<typeof createPracticePreview>;
  onSettings: () => void;
  toggleSound: () => void;
  onExit: () => void;
}) {
  const query = useQueryClient();
  const target = useRef<PracticeStep>({ turn: 0, index: 1 });
  const queue = useRef<PracticeQueue | null>(null);
  const [reload, setReload] = useState(0);
  const [current, setCurrent] = useState<(PracticeStep & { item: PracticeItem }) | null>(null);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback((feed: PracticeQueue, step: PracticeStep) => {
    const accept = (item: PracticeItem | null) => {
      if (feed.signal.aborted) return;
      setCurrent(item ? { ...step, item } : null);
      setLoading(false);
    };
    setError("");
    const ready = feed.queue.takeReady();
    if (ready) {
      accept(ready);
      return;
    }

    setLoading(true);
    void feed.queue.take().then(accept).catch(cause => {
      if (feed.signal.aborted) return;
      setError(errorMessage(cause));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const next = createPracticeFeed((lane, cursor) => (
      query.fetchQuery(practicePageQuery(userId, lane, cursor, plan.source))
    ), plan.lanes);
    const feed = { queue: bufferPracticeFeed(next, controller.signal, preview.prepare), signal: controller.signal };
    queue.current = feed;
    load(feed, target.current);
    return () => {
      controller.abort();
      queue.current = null;
    };
  }, [load, plan, preview, query, reload, userId]);

  function reloadFeed() {
    setLoading(true);
    void resetPracticePages(query, userId).then(() => setReload(previous => previous + 1));
  }

  function advance(count: boolean, expired?: boolean) {
    if (loading || !queue.current) return;
    const previous = target.current;
    target.current = { turn: previous.turn + 1, index: previous.index + (count ? 1 : 0) };
    if (expired) reloadFeed();
    else load(queue.current, target.current);
  }

  function refresh() {
    if (loading) return;
    if (error && queue.current) {
      load(queue.current, target.current);
      return;
    }
    reloadFeed();
  }

  return <main className="practice-mode" data-practice-session="" data-practice-motion={settings.motion}>
    <header className="practice-header">
      <div className="practice-header-actions">
        <button type="button" aria-label="結束複習，返回科目選擇" className="practice-icon-button" onClick={onExit}><X size={22} weight="bold" /></button>
        <button type="button" aria-label="音效與動畫設定" className="practice-icon-button" onClick={onSettings}><GearSix size={20} /></button>
      </div>
      <span>混合複習</span>
      <div className="practice-header-actions">
        <button type="button" aria-label="複習音效" aria-pressed={settings.soundEnabled} title={settings.soundEnabled ? "關閉音效" : "開啟音效"} className="practice-icon-button" data-practice-sound-toggle="" onClick={toggleSound}>
          {settings.soundEnabled ? <SpeakerHigh size={20} /> : <SpeakerSlash size={20} />}
        </button>
        <span className="practice-streak" aria-label={`連對 ${streak} 題`} title="連對題數">
          <Flame key={streak} className={streak > 0 ? "practice-streak-flame" : undefined} size={21} weight={streak ? "fill" : "regular"} />{streak}
        </span>
      </div>
    </header>
    {error || !current ? <>
      <div className="practice-scroll">
        <div className="practice-content">
          {loading ? <div className="practice-stage-skeleton" role="status">
            <span className="sr-only">正在準備下一項</span><span className="skeleton" /><span className="skeleton" /><span className="skeleton" />
          </div> : <>
            <div className="practice-emblem" aria-hidden="true"><Cards size={39} weight="fill" /></div>
            <h1>{error ? "暫時無法載入" : "這次沒有可複習的內容"}</h1>
            <p className="practice-lead" role={error ? "alert" : undefined}>{error || "請用 STUDY MCP 為選定科目設計混合複習內容，再回來重新載入。"}</p>
          </>}
        </div>
      </div>
      <footer className="practice-footer">
        <PracticeButton busy={loading} onClick={refresh}>{loading ? "載入中" : "重新載入"}</PracticeButton>
      </footer>
    </> : <ActivePractice key={current.turn} item={current.item} index={current.index} subjects={plan.subjects} loading={loading} allowAi={allowAi}
      preview={preview.get(current.item)} motion={settings.motion}
      streak={streak} prepareSound={sound.prepare}
      onChecked={correct => {
        const count = correct === true ? streak + 1 : 0;
        if (correct !== null) setStreak(count);
        sound.play(correct === null ? "reveal" : correct !== true ? "retry" : count % 3 === 0 ? "streak" : "correct");
      }}
      onAdvance={advance} />}
  </main>;
}

function ActivePractice({ item, index, subjects, loading, allowAi, preview, motion, streak, prepareSound, onChecked, onAdvance }: {
  item: PracticeItem;
  index: number;
  subjects: PracticeSubject[];
  loading: boolean;
  allowAi: boolean;
  preview?: PracticePreview;
  motion: PracticeSettings["motion"];
  streak: number;
  prepareSound: () => void;
  onChecked: (correct: PracticeFeedback["correct"]) => void;
  onAdvance: (count: boolean, expired?: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<PracticeFeedback>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [writing, setWriting] = useState(false);
  const [penOnly, setPenOnly] = useState(false);
  const [strokes, setStrokes] = useState<{ id: string; path: string }[]>([]);
  const textInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const reference = useRef<HTMLElement>(null);
  const correctOption = useRef<HTMLButtonElement>(null);
  const { label, icon: KindIcon } = KIND[item.kind];
  const isQuestion = item.kind === "question";
  const subject = subjects.find(subject => subject.id === item.subject_id);
  const canSubmit = !isQuestion || (item.options ? selected.length > 0 : !!text.trim());
  const answer: PracticeAnswer | undefined = !isQuestion ? undefined
    : item.options ? item.multiple ? selected : selected[0] : text.trim() || undefined;
  const { kind, source_key, entry, version } = item;
  const action = { ref: { kind, source_key, entry, version }, answer };
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!feedback) return;
    if (!isQuestion || (feedback.correct !== true && !item.options)) {
      reference.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else if (feedback.correct !== true) {
      correctOption.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [feedback, isQuestion, item.options]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing || loading || request.current) return;
    if (feedback || expired) { onAdvance(!!feedback, expired); return; }
    if (!canSubmit) return;
    prepareSound();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<PracticeFeedback>("/api/practice/reveal", action, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setFeedback(result);
        onChecked(result.correct);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(errorMessage(cause));
      setExpired(cause instanceof ApiError && [404, 409].includes(cause.status));
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  }

  function choose(id: string) {
    if (!item.multiple) setSelected([id]);
    else if (selected.includes(id)) setSelected(previous => previous.filter(value => value !== id));
    else if (!item.selection_limit || selected.length < item.selection_limit) setSelected(previous => [...previous, id]);
  }

  const tone = feedback?.correct === true ? "correct" : feedback?.correct === false || feedback?.correct === "partial" ? "incorrect" : "reveal";
  const milestone = feedback?.correct === true && streak > 0 && streak % 3 === 0;
  const status = feedback?.correct === true ? milestone ? `連對 ${streak} 題！` : "答對了！" : feedback?.correct === false ? "再接再厲"
    : feedback?.correct === "partial" ? "答對一部分" : item.kind === "flashcard" ? "字卡背面" : "觀念重點";
  const cta = feedback || expired ? "繼續" : isQuestion ? "檢查答案" : item.kind === "flashcard" ? "翻開字卡" : "看觀念重點";
  return <form className="practice-stage" data-feedback={feedback ? tone : undefined} onSubmit={submit}>
    <div className="practice-scroll" ref={scroller}>
      <div className="practice-paper" data-writing={writing}>
        <div className="practice-content practice-entry" data-kind={item.kind}>
          <div className="practice-meta">
            <span className="practice-kind"><KindIcon size={17} weight="fill" />{label}</span>
            <span className="practice-subject-name">{subject?.name}</span>
            {item.shared_by_member && <span className="practice-shared-mark">成員共享</span>}
            <span className="practice-index">第 {index} 項</span>
          </div>
          {!isQuestion && <h1 className="practice-prompt-heading">{item.kind === "flashcard" ? "試著回想答案" : "用自己的話說一遍"}</h1>}
          {item.passage_md && <details className="practice-passage"><summary>閱讀題目資料</summary><Markdown className="practice-math" md={item.passage_md} preparedHtml={preview?.passage} /></details>}
          <div className="practice-prompt" role={isQuestion ? "heading" : undefined} aria-level={isQuestion ? 1 : undefined}>
            <Markdown className="practice-math" md={item.prompt_md} preparedHtml={preview?.prompt} />
          </div>
          {item.instructions && <Markdown className="practice-instructions practice-math" md={item.instructions} preparedHtml={preview?.instructions} />}
          {isQuestion && item.options && <fieldset className="practice-options" disabled={writing || !!feedback || busy || expired || loading}>
            <legend className={item.multiple ? "practice-option-legend" : "sr-only"}>{item.multiple ? item.selection_limit ? `可選 ${item.selection_limit} 項` : "可複選" : "選擇答案"}</legend>
            {item.options.map(option => {
              const pressed = selected.includes(option.id);
              const isCorrect = feedback?.correct_options?.includes(option.id);
              return <button key={option.id} type="button" aria-pressed={pressed} onClick={() => choose(option.id)}
                ref={feedback?.correct_options?.[0] === option.id ? correctOption : undefined}
                className={clsx("practice-option", isCorrect && "is-correct", feedback && pressed && !isCorrect && "is-incorrect")}>
                <span className="practice-option-mark" aria-hidden="true">{isCorrect ? <Check size={17} weight="bold" /> : feedback && pressed ? <X size={17} weight="bold" /> : /^[A-Z0-9]{1,2}$/.test(option.id) ? option.id : <span className="practice-option-dot" />}</span>
                {isCorrect && <span className="sr-only">正確選項</span>}
                <Markdown className="practice-math" md={option.md} preparedHtml={preview?.[`option-${option.id}`]} />
              </button>;
            })}
          </fieldset>}
          {isQuestion && !item.options && <label className="practice-answer">
            <span>你的答案{item.unit && `（${item.unit}）`}</span>
            <input ref={textInput} value={text} maxLength={2000} autoComplete="off" autoCapitalize="off" spellCheck={false} readOnly={writing || !!feedback || busy || expired || loading} onChange={event => setText(event.target.value)} />
          </label>}
          {feedback && ((feedback.reference_md && (!isQuestion || !item.options)) || feedback.explanation_md) && <section ref={reference} className="practice-reference" aria-label={isQuestion ? "答案與解析" : status}>
            {feedback.reference_md && (!isQuestion || !item.options) && <>
              <h2>{isQuestion ? "參考答案" : status}</h2>
              <Markdown className="practice-math" md={feedback.reference_md} />
            </>}
            {feedback.explanation_md && <Markdown className="practice-math" md={feedback.explanation_md} />}
          </section>}
          {error && <p className="practice-error" role="alert">{error}</p>}
        </div>
        <PracticeInk active={writing} penOnly={penOnly} onPen={() => setPenOnly(true)}
          onPan={distance => { if (scroller.current) scroller.current.scrollTop += distance; }}
          strokes={strokes} onStroke={path => {
            const stroke = { id: crypto.randomUUID(), path };
            setStrokes(previous => [...previous, stroke]);
          }} />
      </div>
    </div>
    <footer className="practice-footer" data-tone={feedback ? tone : undefined}>
      <div className="practice-feedback-row">
        {feedback && <div className="practice-feedback" role="status" data-milestone={milestone || undefined}>
          <span className="practice-feedback-icon" aria-hidden="true">
            {tone === "correct" ? <Check weight="bold" /> : tone === "incorrect" ? <Exam weight="bold" /> : <KindIcon weight="fill" />}
            {milestone && <span className="practice-burst"><i /><i /><i /><i /><i /></span>}
          </span>
          <span><strong>{status}</strong>{tone === "incorrect" && <small>{item.options ? "已標出正確選項" : "已展開參考答案"}</small>}</span>
        </div>}
        {writing && <div className="practice-ink-tools">
          <button type="button" data-ink-guard-exempt="" aria-label="復原筆跡" title="復原筆跡" className="practice-text-button" disabled={!strokes.length} onClick={() => setStrokes(previous => previous.slice(0, -1))}>
            <ArrowArcLeft size={20} weight="bold" />
          </button>
          {!feedback && <span>{penOnly ? "手指可捲動" : "雙指捲動"}</span>}
        </div>}
        {allowAi && !expired && <PracticeExplanation action={action} disabled={loading} motion={motion} />}
      </div>
      <div className="practice-action-row">
        <button type="button" data-ink-guard-exempt="" data-writing={writing} className="practice-writing-toggle" disabled={busy || loading} onClick={() => {
          if (!writing) textInput.current?.blur();
          setWriting(active => !active);
        }}>
          {writing ? <HandPointing size={19} weight="bold" /> : <PenNib size={19} weight="bold" />}
          {writing ? "返回作答" : "手寫"}
        </button>
        <PracticeButton busy={busy || loading} disabled={writing || (!canSubmit && !expired)}>{busy ? "處理中" : loading ? "載入中" : cta}</PracticeButton>
      </div>
    </footer>
  </form>;
}

function PracticeExplanation({ action, disabled, motion }: {
  action: { ref: PracticeRef; answer?: PracticeAnswer }; disabled: boolean; motion: PracticeSettings["motion"];
}) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function explain() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setPending(true);
    try {
      const result = await api.post<{ markdown: string }>("/api/practice/explain", action, { signal: controller.signal });
      if (!controller.signal.aborted) setMarkdown(result.markdown);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false); }
    }
  }

  return <>
    <button className="practice-text-button practice-ask" type="button" disabled={disabled} onClick={() => {
      setOpen(true);
      if (!markdown) void explain();
    }}><Sparkle size={17} weight="fill" /> AI 解析</button>
    <Sheet wide open={open} title="AI 解析" animation={sheetAnimation(motion)} onClose={() => {
      request.current?.abort();
      request.current = null;
      setPending(false);
      setOpen(false);
    }}>
      <div className="practice-explanation" data-practice-motion={motion}>
        {pending && <p role="status" className="practice-message"><CircleNotch className="practice-spinner" size={20} />正在整理這一項的解析…</p>}
        {error && <div className="practice-explain-error">
          <p role="alert">{error}</p>
          <PracticeButton onClick={() => void explain()}>重試解析</PracticeButton>
        </div>}
        {markdown && <ExplanationMath markdown={markdown} />}
      </div>
    </Sheet>
  </>;
}

function ExplanationMath({ markdown }: { markdown: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const equations = [...root.querySelectorAll<HTMLElement>(".katex-display")];
    const measure = () => {
      let canScroll = false;
      for (const element of [root, ...equations]) {
        const wide = element.scrollWidth > element.clientWidth + 1;
        if (wide) {
          element.tabIndex = 0;
          canScroll = true;
        } else element.removeAttribute("tabindex");
      }
      setOverflow(canScroll);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const equation of equations) {
      if (equation.firstElementChild) observer.observe(equation.firstElementChild);
    }
    measure();
    return () => observer.disconnect();
  }, [markdown]);
  return <>
    {overflow && <p className="practice-math-hint">左右滑動查看完整公式</p>}
    <Markdown ref={content} className="practice-math" md={markdown} />
  </>;
}
