import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, BookOpenText, Cards, CheckCircle, DownloadSimple, Exam, FileArrowUp, GearSix, LinkSimple, NotePencil, PencilSimple, Plus, Sparkle, Trash, X } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { fmtRelative } from "../lib/format";
import { Badge, Button, Card, Empty, ErrorBox, fieldCls, IconButton, inputCls, Loading, PageHeader, Sheet, SubjectDot, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { studyPlan, MAX_MATERIAL_BYTES, type ChapterDetail, type ChapterPreference, type StudyMode } from "../../shared/chapter";
import type { ContentItem } from "../../shared/content";
import { extractMaterial } from "../features/chapters/extract";
import { ChapterEditor, VisibilityBadge } from "./Chapters";
import { ALWAYS_FRESH, refreshChapterData } from "../features/chapters/sync";

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function ChapterView() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["chapter", id], queryFn: () => api.get<{ chapter: ChapterDetail }>(`/api/chapters/${encodeURIComponent(id)}`).then((r) => r.chapter), ...ALWAYS_FRESH });
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const chapter = query.data;
  const refresh = () => refreshChapterData(qc);
  if (query.isLoading) return <Page><Loading /></Page>;
  if (!chapter) return <Page><ErrorBox error={query.error} /><div className="mt-3 flex gap-2"><Button onClick={() => void query.refetch()}>重試</Button><Link to="/chapters" className="inline-flex h-10 items-center rounded-2xl px-4 text-sm hover:bg-slate-900/5">回到章節列表</Link></div></Page>;
  const onboarding = !chapter.preference;

  return <Page>
    <PageHeader eyebrow={<Link to="/chapters" className="hover:underline">章節</Link>} title={<>{chapter.code && <span className="mr-2 tabular-nums text-slate-400">{chapter.code}</span>}{chapter.title}</>}
      subtitle={chapter.description ?? undefined}
      actions={<>
        <SubjectDot subjectId={chapter.subject_id} />
        <VisibilityBadge visibility={chapter.visibility} />
        {chapter.preference && <Button onClick={() => setSettings(true)}><GearSix size={17} />學習設定</Button>}
        {chapter.can_edit && <Button onClick={() => setEditing(true)}><PencilSimple size={17} />管理</Button>}
      </>} />
    {chapter.preference && <StudyPath chapter={chapter} preference={chapter.preference} onSettings={() => setSettings(true)} />}
    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <ContentList chapter={chapter} onAdd={() => setAdding(true)} onChanged={refresh} />
      <Materials chapter={chapter} onChanged={refresh} />
    </div>
    {(onboarding || settings) && <Onboarding chapter={chapter} first={onboarding} onClose={() => setSettings(false)} onSaved={refresh} />}
    {editing && <ChapterEditor chapter={chapter} onClose={() => setEditing(false)} onDeleted={() => navigate("/chapters")} />}
    {adding && <AddContent chapter={chapter} onClose={() => setAdding(false)} onAdded={refresh} />}
  </Page>;
}

/** First visit: choose how to learn this chapter. Later visits open the same choices from 學習設定. */
function Onboarding({ chapter, first, onClose, onSaved }: { chapter: ChapterDetail; first: boolean; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<StudyMode | null>(chapter.preference?.study_mode ?? null);
  const [cards, setCards] = useState(chapter.preference?.cards_before_exam ?? true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!mode) return;
    setBusy(true);
    try {
      await api.put(`/api/chapters/${encodeURIComponent(chapter.id)}/preference`, { study_mode: mode, cards_before_exam: cards } satisfies ChapterPreference);
      await onSaved();
      toast(first ? "已記住你的學習方式，可隨時在「學習設定」修改" : "已更新學習設定");
      onClose();
    } catch (error) { toast(errorMessage(error), "err"); } finally { setBusy(false); }
  };
  const option = (value: StudyMode, icon: React.ReactNode, title: string, who: string, note?: string) => <button type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
    className={clsx("hairline flex w-full items-start gap-3 rounded-2xl p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2", mode === value ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-white/70 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10")}>
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span className="min-w-0"><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm opacity-75">{who}</span>{note && <span className="mt-1 block text-xs opacity-60">{note}</span>}</span>
  </button>;
  // On the first visit there is nothing to show without a choice, so closing goes back to the chapter list.
  return <Sheet open onClose={() => { if (busy) return; if (first) navigate("/chapters"); else onClose(); }} title={first ? `開始學習「${chapter.title}」` : "學習設定"}>
    <div className="space-y-5 p-4">
      {first && <ol className="flex gap-1.5" aria-label="設定步驟">{[0, 1].map((n) => <li key={n} className={clsx("h-1 flex-1 rounded-full", n <= step ? "bg-ink-900 dark:bg-white" : "bg-slate-200 dark:bg-white/10")} aria-current={n === step ? "step" : undefined} />)}</ol>}
      {(!first || step === 0) && <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">你對這章熟悉嗎？選擇主要的學習方式</legend>
        {option("summary", <NotePencil size={22} />, "文字版簡易重點整理", "已經精熟，只要考前快速自我檢核。")}
        {option("course", <Sparkle size={22} />, "OpenMAIC 互動式課程講解", "對內容還不熟，需要一步步重新學習。", chapter.has_course ? undefined : "這章目前還沒有互動課程，會先帶你讀重點整理。")}
      </fieldset>}
      {(!first || step === 1) && <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">做模擬試題之前，要先複習字卡嗎？</legend>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((value) => <button key={String(value)} type="button" aria-pressed={cards === value} onClick={() => setCards(value)} className={clsx("hairline rounded-2xl p-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2", cards === value ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-white/70 hover:bg-white dark:bg-white/5")}>{value ? "先複習字卡" : "直接做試題"}</button>)}
        </div>
        {chapter.decks === 0 && <p className="text-xs text-slate-500">這章目前沒有字卡組；之後加入字卡就會出現在學習路徑中。</p>}
      </fieldset>}
      <div className="flex flex-wrap gap-2">
        {first && step === 0 ? <Button variant="primary" disabled={!mode} onClick={() => setStep(1)}>下一步<ArrowRight size={16} /></Button> : <>
          {first && <Button onClick={() => setStep(0)}>上一步</Button>}
          <Button variant="primary" disabled={!mode || busy} onClick={() => void save()}>{busy ? "儲存中…" : first ? "開始學習" : "儲存設定"}</Button>
        </>}
        {first && <Link to="/chapters" className="ml-auto inline-flex h-10 items-center rounded-2xl px-3 text-sm text-slate-500 hover:bg-slate-900/5">稍後再說</Link>}
      </div>
    </div>
  </Sheet>;
}

function StudyPath({ chapter, preference, onSettings }: { chapter: ChapterDetail; preference: ChapterPreference; onSettings: () => void }) {
  const steps = studyPlan(chapter, preference);
  const icon = { summary: <NotePencil size={20} />, course: <Sparkle size={20} />, cards: <Cards size={20} />, exam: <Exam size={20} /> };
  return <section aria-label="學習路徑">
    <div className="mb-3 flex items-center gap-2"><h2 className="text-lg font-semibold">學習路徑</h2><button className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={onSettings}>調整</button></div>
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => <li key={step.kind}>
        <Card className={clsx("flex h-full flex-col gap-2 p-4", !step.ready && "opacity-70")}>
          <div className="flex items-center gap-2 text-sm text-slate-500"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums dark:bg-white/10">{index + 1}</span>{icon[step.kind]}</div>
          <div className="font-semibold">{step.title}</div>
          <p className="flex-1 text-sm text-slate-500">{step.detail}</p>
          {step.url ? <Link to={step.url} className="inline-flex h-9 items-center gap-1.5 self-start rounded-xl bg-ink-900 px-3 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-ink-900">{step.ready ? "開始" : "先看重點整理"}<ArrowRight size={15} /></Link> : <span className="text-xs text-slate-400">尚未準備好</span>}
        </Card>
      </li>)}
    </ol>
  </section>;
}

function ContentList({ chapter, onAdd, onChanged }: { chapter: ChapterDetail; onAdd: () => void; onChanged: () => Promise<unknown> }) {
  const unlink = async (type: "document" | "deck", contentId: string) => {
    try { await api.del(`/api/chapters/${encodeURIComponent(chapter.id)}/links/${type}/${encodeURIComponent(contentId)}`); await onChanged(); toast("已移出章節"); }
    catch (error) { toast(errorMessage(error), "err"); }
  };
  const row = (key: string, to: string, icon: React.ReactNode, title: string, meta: React.ReactNode, onUnlink: () => void) => <li key={key} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-white/5">
    <span className="text-slate-400">{icon}</span>
    <div className="min-w-0 flex-1"><Link to={to} className="block break-words text-sm font-medium hover:underline">{title}</Link><div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-500">{meta}</div></div>
    <IconButton label={`把「${title}」移出章節`} onClick={onUnlink}><X size={15} /></IconButton>
  </li>;
  const empty = !chapter.note_list.length && !chapter.exam_list.length && !chapter.deck_list.length;
  return <section aria-label="章節內容">
    <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto text-lg font-semibold">內容</h2><Button size="sm" onClick={onAdd}><Plus size={15} />加入既有內容</Button></div>
    <Card className="p-4">
      {empty ? <p className="text-sm text-slate-500">還沒有內容。可加入既有的重點整理、試題或字卡，或請 AI 依上傳的教材生成（MCP 工具會帶 chapter_id 自動加入）。</p> : <ul>
        {chapter.note_list.map((n) => row(`n:${n.id}`, `/notes/${encodeURIComponent(n.slug)}`, <NotePencil size={18} />, n.title, <><span>重點整理</span>{n.has_course && <Badge>互動課程</Badge>}{n.visibility === "private" && <Badge>私人</Badge>}<span>{fmtRelative(n.updated_at)}</span></>, () => void unlink("document", n.id)))}
        {chapter.deck_list.map((d) => row(`d:${d.id}`, `/decks/${encodeURIComponent(d.id)}`, <Cards size={18} />, d.title, <><span>字卡 {d.cards} 張</span>{d.due > 0 && <Badge color="brand">到期 {d.due}</Badge>}{d.visibility === "private" && <Badge>私人</Badge>}</>, () => void unlink("deck", d.id)))}
        {chapter.exam_list.map((e) => row(`e:${e.id}`, `/exams/${encodeURIComponent(e.slug)}`, <Exam size={18} />, e.title, <><span>模擬試題</span>{e.review_status === "pending" ? <Badge color="yellow">待 AI 對齊覆核</Badge> : e.review_status === "passed" ? <span className="inline-flex items-center gap-1"><CheckCircle size={12} />IB 對齊已覆核</span> : null}{e.visibility === "private" && <Badge>私人</Badge>}</>, () => void unlink("document", e.id)))}
      </ul>}
    </Card>
  </section>;
}

function Materials({ chapter, onChanged }: { chapter: ChapterDetail; onChanged: () => Promise<unknown> }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        if (file.size > MAX_MATERIAL_BYTES) throw new Error(`超過 ${MAX_MATERIAL_BYTES / 1024 / 1024} MB`);
        setProgress(`讀取 ${file.name}…`);
        const extracted = await extractMaterial(file, setProgress);
        if (!extracted.text.trim()) throw new Error("沒有可讀的文字（掃描的 PDF 需先做文字辨識）");
        setProgress(`上傳 ${file.name}…`);
        const form = new FormData();
        form.set("file", file); form.set("text", extracted.text); form.set("sections", String(extracted.sections));
        await api.post(`/api/chapters/${encodeURIComponent(chapter.id)}/materials`, form);
        toast(`已上傳 ${file.name}`);
      } catch (error) { toast(`${file.name}：${errorMessage(error)}`, "err"); }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    await onChanged();
  };
  const remove = async (materialId: string, name: string) => {
    try { await api.del(`/api/chapters/${encodeURIComponent(chapter.id)}/materials/${encodeURIComponent(materialId)}`); await onChanged(); toast(`已刪除 ${name}`); }
    catch (error) { toast(errorMessage(error), "err"); }
  };
  return <section aria-label="教材">
    <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto text-lg font-semibold">教材</h2>
      <input ref={input} type="file" multiple hidden accept=".pptx,.docx,.md,.markdown,.pdf,.html,.htm" onChange={(e) => void upload(e.target.files)} />
      <Button size="sm" disabled={!!progress} onClick={() => input.current?.click()}><FileArrowUp size={15} />上傳教材</Button>
    </div>
    <Card className="p-4">
      {progress && <p role="status" className="mb-3 text-sm text-slate-500">{progress}</p>}
      {chapter.material_list.length === 0 ? <div className="text-sm text-slate-500">
        <p>上傳 pptx、docx、md、pdf 或 html，AI 生成重點整理、互動課程、試題與字卡時可以讀取（MCP：<code>get_chapter</code> → <code>get_chapter_material</code>）。</p>
        <p className="mt-2 text-xs">文字在瀏覽器裡擷取後與原檔一起保存；掃描的 PDF 沒有文字層，需先做文字辨識。</p>
      </div> : <ul>
        {chapter.material_list.map((m) => <li key={m.id} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-white/5">
          <Badge>{m.format.toUpperCase()}</Badge>
          <div className="min-w-0 flex-1"><Link to={`/chapters/${encodeURIComponent(chapter.id)}/materials/${encodeURIComponent(m.id)}`} className="break-words text-sm font-medium hover:underline">{m.filename}</Link><div className="mt-0.5 text-xs text-slate-500">{formatSize(m.size)} · {m.text_chars.toLocaleString()} 字{m.sections ? ` · ${m.sections} 段` : ""} · {fmtRelative(m.created_at)}</div></div>
          <a className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-900/5" href={`/api/chapters/${encodeURIComponent(chapter.id)}/materials/${encodeURIComponent(m.id)}/file`} aria-label={`下載 ${m.filename}`}><DownloadSimple size={17} /></a>
          {m.can_delete && <IconButton label={`刪除 ${m.filename}`} onClick={() => void remove(m.id, m.filename)}><Trash size={16} /></IconButton>}
        </li>)}
      </ul>}
    </Card>
  </section>;
}

function AddContent({ chapter, onClose, onAdded }: { chapter: ChapterDetail; onClose: () => void; onAdded: () => Promise<unknown> }) {
  const [kind, setKind] = useState("note");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const items = useQuery({ queryKey: ["content-pick", kind, search], queryFn: () => api.get<{ items: ContentItem[] }>(`/api/content?${new URLSearchParams({ view: "all", kind, limit: "50", ...(search ? { q: search } : {}) })}`), ...ALWAYS_FRESH });
  const linkedIds = new Set([...chapter.note_list, ...chapter.exam_list, ...chapter.deck_list].map((x) => x.id));
  const list = (items.data?.items ?? []).filter((item) => !linkedIds.has(item.id) && (!item.subject_id || item.subject_id === chapter.subject_id));
  const add = async (item: ContentItem) => {
    setBusy(item.id);
    try {
      const r = await api.post<{ visibility: "shared" | "private"; visibility_changed: boolean }>(`/api/chapters/${encodeURIComponent(chapter.id)}/links`, { type: item.type, id: item.id });
      await onAdded();
      toast(r.visibility_changed ? `已加入「${item.title}」，內容也改為${r.visibility === "shared" ? "公共" : "私人"}（跟隨章節）` : `已加入「${item.title}」`);
    }
    catch (error) { toast(errorMessage(error), "err"); } finally { setBusy(null); }
  };
  return <Sheet open onClose={onClose} title="加入既有內容">
    <div className="space-y-3 p-4">
      <div className="flex gap-2">
        <select aria-label="內容類型" className={fieldCls} value={kind} onChange={(e) => setKind(e.target.value)}><option value="note">重點整理</option><option value="exam">模擬試題</option><option value="deck">字卡</option></select>
        <input aria-label="搜尋標題" className={inputCls} placeholder="搜尋標題…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      {items.isLoading ? <Loading rows={3} /> : items.error ? <ErrorBox error={items.error} /> : list.length === 0 ? <Empty icon={<BookOpenText size={30} />} title="沒有可加入的內容">只列出同科目（或未分類）且尚未在此章節的內容。</Empty> : <ul className="max-h-[50vh] overflow-y-auto">
        {list.map((item) => <li key={item.id} className="flex items-center gap-3 border-b border-slate-100 py-2 last:border-0 dark:border-white/5">
          <div className="min-w-0 flex-1 break-words text-sm">{item.title}</div>
          <Button size="sm" disabled={busy !== null} onClick={() => void add(item)}><LinkSimple size={14} />{busy === item.id ? "加入中…" : "加入"}</Button>
        </li>)}
      </ul>}
    </div>
  </Sheet>;
}
