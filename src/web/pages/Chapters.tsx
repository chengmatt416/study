import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { BookOpenText, Cards, Exam, FileArrowUp, GlobeHemisphereEast, LockSimple, NotePencil, PencilSimple, Plus, Sparkle, Trash } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { mergeSearchParams } from "../lib/search-params";
import { useUser } from "../lib/auth";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, inputCls, Loading, PageHeader, Sheet, Stagger, StaggerItem, SubjectDot, SubjectSelect, Tabs, textareaCls, toast, useSubjects } from "../components/ui";
import { Page } from "../layouts/Shell";
import type { ChapterSummary, ChapterVisibility } from "../../shared/chapter";
import { ALWAYS_FRESH, refreshChapterData } from "../features/chapters/sync";

type Filter = "all" | "shared" | "private";
interface PlannedItem { type: "document" | "deck"; id: string; title: string; kind: "note" | "exam" | "deck"; reason?: string }
interface DeletionPlan { remove: PlannedItem[]; keep: (PlannedItem & { reason: string })[]; materials: number }
const KIND_NAME = { note: "重點整理", exam: "模擬試題", deck: "字卡組" } as const;

export default function Chapters() {
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const subject = params.get("subject") ?? "";
  const filter = (["shared", "private"].includes(params.get("show") ?? "") ? params.get("show") : "all") as Filter;
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<ChapterSummary | null>(null);
  const subjects = useSubjects();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["chapters", subject], queryFn: () => api.get<{ chapters: ChapterSummary[] }>(`/api/chapters${subject ? `?subject_id=${encodeURIComponent(subject)}` : ""}`), ...ALWAYS_FRESH });
  const all = data?.chapters ?? [];
  const chapters = all.filter((c) => filter === "all" || c.visibility === filter);
  const groups = (subjects.data ?? []).map((s) => ({ subject: s, chapters: chapters.filter((c) => c.subject_id === s.id) })).filter((g) => g.chapters.length);

  return <Page>
    <PageHeader title="章節" subtitle="每個章節集合重點整理、互動課程、字卡與模擬試題。私人章節只有你看得到；公共章節大家都看得到。"
      actions={<>
        <SubjectSelect value={subject} onChange={(value) => setParams(mergeSearchParams({ subject: value }))} allowAll />
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} weight="bold" />新增章節</Button>
      </>} />
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Tabs<Filter> value={filter} onChange={(value) => setParams(mergeSearchParams({ show: value === "all" ? "" : value }), { replace: true })}
        items={[{ value: "all", label: "全部" }, { value: "shared", label: <><GlobeHemisphereEast size={15} /> 公共</> }, { value: "private", label: <><LockSimple size={15} /> 私人</> }]} />
      <nav aria-label="個別內容清單" className="ml-auto flex flex-wrap gap-1 text-sm">
        <Link to="/notes" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5"><NotePencil size={16} />重點整理</Link>
        <Link to="/exams" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5"><Exam size={16} />模擬試題</Link>
        <Link to="/decks" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5"><Cards size={16} />字卡</Link>
        {user.access?.features.writing !== false && <Link to="/writing" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5"><PencilSimple size={16} />寫作練習</Link>}
      </nav>
    </div>
    {error && <div className="mb-4 space-y-2"><ErrorBox error={error} /><Button onClick={() => void refetch()}>重試</Button></div>}
    {isLoading ? <Loading /> : !data ? null : chapters.length === 0 ? <Empty icon={<BookOpenText size={36} />} title={all.length ? "這個篩選沒有章節" : subject ? "這個科目還沒有章節" : "還沒有章節"}>
      {all.length ? "換個篩選或科目看看。" : "按「新增章節」建立第一個章節，再把重點整理、試題與字卡放進來，或上傳課本與講義讓 AI 生成內容。"}
    </Empty> : <div className="space-y-8">
      {groups.map(({ subject: s, chapters: list }) => <section key={s.id} aria-label={s.name}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color ?? "#64748b" }} />{s.name}</h2>
        <Stagger className="grid gap-3 sm:grid-cols-2">
          {list.map((chapter) => <StaggerItem key={chapter.id}><ChapterCard chapter={chapter} onManage={() => setManaging(chapter)} /></StaggerItem>)}
        </Stagger>
      </section>)}
    </div>}
    {creating && <ChapterEditor subjectId={subject} onClose={() => setCreating(false)} />}
    {managing && <ChapterEditor chapter={managing} onClose={() => setManaging(null)} />}
  </Page>;
}

export function VisibilityBadge({ visibility }: { visibility: ChapterVisibility }) {
  return visibility === "private"
    ? <Badge><LockSimple size={11} weight="bold" />私人</Badge>
    : <Badge color="blue"><GlobeHemisphereEast size={11} weight="bold" />公共</Badge>;
}

function ChapterCard({ chapter, onManage }: { chapter: ChapterSummary; onManage: () => void }) {
  const empty = chapter.notes + chapter.exams + chapter.decks + chapter.materials === 0;
  return <Card interactive className="relative flex h-full flex-col gap-3 p-5">
    <div className="flex items-start gap-2">
      <Link to={`/chapters/${chapter.id}`} className="min-w-0 flex-1 rounded after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="block break-words font-semibold">{chapter.code ? <span className="mr-1.5 tabular-nums text-slate-400">{chapter.code}</span> : null}{chapter.title}</span>
        {chapter.description && <span className="mt-1 line-clamp-2 block text-sm text-slate-500">{chapter.description}</span>}
      </Link>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {!chapter.preference && !empty && <Badge color="brand">新</Badge>}
        <VisibilityBadge visibility={chapter.visibility} />
        {chapter.can_edit && <IconButton label={`管理章節「${chapter.title}」`} onClick={onManage}><PencilSimple size={16} /></IconButton>}
      </div>
    </div>
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1"><NotePencil size={13} />{chapter.notes}</span>
      {chapter.has_course && <span className="inline-flex items-center gap-1"><Sparkle size={13} />互動課程</span>}
      <span className="inline-flex items-center gap-1"><Cards size={13} />{chapter.decks}</span>
      <span className="inline-flex items-center gap-1"><Exam size={13} />{chapter.exams}</span>
      {chapter.materials > 0 && <span className="inline-flex items-center gap-1"><FileArrowUp size={13} />教材 {chapter.materials}</span>}
      {chapter.preference && <span className="ml-auto">{chapter.preference.study_mode === "course" ? "互動課程" : "重點整理"}{chapter.preference.cards_before_exam ? "＋字卡" : ""}</span>}
    </div>
  </Card>;
}

/** Create a chapter, or manage one: name, code, description, public/private, delete. */
export function ChapterEditor({ subjectId, chapter, onClose, onDeleted }: { subjectId?: string; chapter?: ChapterSummary; onClose: () => void; onDeleted?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [subject, setSubject] = useState(chapter?.subject_id ?? subjectId ?? "");
  const [title, setTitle] = useState(chapter?.title ?? "");
  const [code, setCode] = useState(chapter?.code ?? "");
  const [description, setDescription] = useState(chapter?.description ?? "");
  const [visibility, setVisibility] = useState<ChapterVisibility>(chapter?.visibility ?? "private");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const plan = useQuery({
    queryKey: ["chapter-deletion", chapter?.id], enabled: !!chapter && confirmDelete, staleTime: 0,
    queryFn: () => api.get<DeletionPlan>(`/api/chapters/${encodeURIComponent(chapter!.id)}/deletion`),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (chapter) {
        const r = await api.put<{ content_updated: unknown[] }>(`/api/chapters/${encodeURIComponent(chapter.id)}`, { title: title.trim(), code: code.trim(), description: description.trim(), visibility });
        await refreshChapterData(qc);
        const moved = r.content_updated?.length ?? 0;
        toast(moved ? `已儲存章節，${moved} 份你建立的內容也改為${visibility === "shared" ? "公共" : "私人"}` : "已儲存章節");
        onClose();
      } else {
        const r = await api.post<{ id: string }>("/api/chapters", { subject_id: subject, title: title.trim(), code: code.trim() || undefined, description: description.trim() || undefined, visibility });
        await refreshChapterData(qc);
        navigate(`/chapters/${r.id}`);
      }
    } catch (cause) { setError(cause); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!chapter) return;
    setBusy(true);
    try {
      const result = await api.del<{ deleted: PlannedItem[]; kept: PlannedItem[] }>(`/api/chapters/${encodeURIComponent(chapter.id)}`);
      await refreshChapterData(qc);
      toast(`已刪除章節與 ${result.deleted.length} 項內容${result.kept.length ? `，保留 ${result.kept.length} 項` : ""}`);
      onClose(); onDeleted?.();
    } catch (cause) { setError(cause); toast(errorMessage(cause), "err"); } finally { setBusy(false); }
  };
  return <Sheet open onClose={() => { if (!busy) onClose(); }} title={chapter ? "管理章節" : "新增章節"}>
    <form className="space-y-4 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {!chapter && <label className="block text-sm">科目<div className="mt-2"><SubjectSelect value={subject} onChange={setSubject} /></div></label>}
      <label className="block text-sm">章節名稱<input autoFocus={!chapter} required maxLength={120} className={inputCls + " mt-2"} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如 Reaction kinetics" /></label>
      <label className="block text-sm">大綱編號（選填）<input maxLength={40} className={inputCls + " mt-2"} value={code} onChange={(e) => setCode(e.target.value)} placeholder="例如 R2.2" /></label>
      <label className="block text-sm">說明（選填）<textarea maxLength={2000} rows={3} className={textareaCls + " mt-2"} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm">誰看得到</legend>
        <div className="grid grid-cols-2 gap-2">
          {([["private", <LockSimple key="i" size={18} />, "私人", "只有你看得到"], ["shared", <GlobeHemisphereEast key="i" size={18} />, "公共", "大家都看得到"]] as const).map(([value, icon, label, hint]) =>
            <button key={value} type="button" aria-pressed={visibility === value} disabled={!!chapter && !chapter.mine && value !== chapter.visibility} onClick={() => setVisibility(value)}
              className={clsx("hairline flex items-start gap-2 rounded-2xl p-3 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40", visibility === value ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-white/70 hover:bg-white dark:bg-white/5")}>
              {icon}<span><span className="block font-medium">{label}</span><span className="text-xs opacity-70">{hint}</span></span>
            </button>)}
        </div>
        <p className="text-xs text-slate-500">章節的公開或私人會跟著套用到你在章節裡建立的重點整理、模擬試題與字卡組；別人的內容不受影響。</p>
        {chapter && !chapter.mine && <p className="text-xs text-slate-500">只有建立者可以切換公開或私人。</p>}
      </fieldset>
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" type="submit" disabled={busy || !title.trim() || (!chapter && !subject)}>{busy ? "儲存中…" : chapter ? "儲存" : "建立章節"}</Button>
        {chapter && !confirmDelete && <Button type="button" variant="ghost" className="ml-auto" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash size={16} />刪除章節</Button>}
      </div>
      {chapter && confirmDelete && <div className="space-y-2 rounded-2xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-500/10 dark:text-rose-100" role="alert">
        <p className="font-medium">刪除「{chapter.title}」和裡面的內容？</p>
        {plan.isLoading ? <p className="text-xs opacity-75">正在列出會刪除的內容…</p> : plan.error ? <ErrorBox error={plan.error} /> : plan.data && <>
          {plan.data.remove.length > 0 ? <div><p className="text-xs opacity-75">會一起刪除（重點整理與試題移到垃圾桶，管理員可還原；字卡組無法復原）：</p>
            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">{plan.data.remove.map((item) => <li key={item.type + item.id} className="break-words">· {item.title}<span className="opacity-60">（{KIND_NAME[item.kind]}）</span></li>)}</ul></div>
            : <p className="text-xs opacity-75">章節裡沒有可以刪除的內容。</p>}
          {plan.data.keep.length > 0 && <div><p className="text-xs opacity-75">只移出、不刪除：</p>
            <ul className="mt-1 space-y-0.5">{plan.data.keep.map((item) => <li key={item.type + item.id} className="break-words">· {item.title}<span className="opacity-60">（{item.reason}）</span></li>)}</ul></div>}
          {plan.data.materials > 0 && <p className="text-xs opacity-75">上傳的 {plan.data.materials} 份教材也會刪除。</p>}
        </>}
        <div className="flex gap-2"><Button type="button" variant="danger" size="sm" disabled={busy || plan.isLoading || !!plan.error} onClick={() => void remove()}><Trash size={15} />確定刪除</Button><Button type="button" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</Button></div>
      </div>}
      {!chapter && !subject && <p className="text-xs text-slate-500">先選擇科目。</p>}
      {chapter && <SubjectDot subjectId={chapter.subject_id} />}
    </form>
  </Sheet>;
}
