import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CalendarBlank, DownloadSimple, FilePdf, GearSix, UploadSimple } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { fmtBytes, fmtDate } from "../lib/format";
import { mergeSearchParams } from "../lib/search-params";
import type { Book } from "../lib/types";
import { academicYearLabel, currentSyllabusTerm, SEMESTERS, type Semester } from "../../shared/syllabus";
import { Button, Empty, ErrorBox, IconButton, inputCls, Loading, PageHeader, Reveal, Sheet, Stagger, StaggerItem, SubjectSelect, toast, useSubjects } from "../components/ui";
import { Page } from "../layouts/Shell";
import { UploadSheet } from "../features/reader/UploadSheet";
import { Timetable } from "../features/timetable/Timetable";

export default function Syllabi() {
  const user = useUser();
  const subjects = useSubjects();
  const current = useMemo(() => currentSyllabusTerm(), []);
  const [params, setParams] = useSearchParams();
  const yearParam = params.get("academic_year") ?? String(current.academic_year);
  const year = yearParam === "" || /^\d{4}$/.test(yearParam) && Number(yearParam) >= 1900 && Number(yearParam) <= 2200 ? yearParam : String(current.academic_year);
  const semesterParam = params.get("semester") ?? current.semester;
  const semester: Semester | "" = semesterParam === "" || Object.hasOwn(SEMESTERS, semesterParam) ? semesterParam as Semester | "" : current.semester;
  const subject = params.get("subject_id") ?? "";
  const search = params.get("q") ?? "";
  const view = params.get("view") === "timetable" ? "timetable" : "syllabus";
  const defaults: Record<string, string> = { academic_year: String(current.academic_year), semester: current.semester, subject_id: "", q: "", view: "syllabus" };
  const filter = (values: Record<string, string>, replace = false) => {
    setParams(mergeSearchParams(values, defaults), { replace });
  };
  const setYear = (value: string) => filter({ academic_year: value });
  const setSemester = (value: Semester | "") => filter({ semester: value });
  const setSubject = (value: string) => filter({ subject_id: value });
  const [uploading, setUploading] = useState(false);
  const [resuming, setResuming] = useState<Book | null>(null);
  const [editing, setEditing] = useState<Book | null>(null);
  const [replacing, setReplacing] = useState<Book | null>(null);
  const query = useQuery({ queryKey: ["syllabi"], queryFn: () => api.get<{ books: Book[] }>("/api/books?kind=syllabus") });
  const all = query.data?.books ?? [];
  const years = [...new Set([current.academic_year, ...all.flatMap((b) => b.academic_year ? [b.academic_year] : [])])].sort((a, b) => b - a);
  const filtered = all.filter((b) => (!year || b.academic_year === Number(year)) && (!semester || b.semester === semester) && (!subject || b.subject_id === subject) && (!search.trim() || b.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    .sort((a, b) => (b.academic_year ?? 0) - (a.academic_year ?? 0) || String(a.semester).localeCompare(String(b.semester)) || b.updated_at - a.updated_at);
  const title = year ? academicYearLabel(Number(year)) : "歷年課綱";
  const defaultFilter = year === String(current.academic_year) && semester === current.semester && !subject && !search;
  const termSelects = <>
    <label className="min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">學年度<select aria-label="篩選學年度" className={inputCls + " mt-1 block min-w-36 max-w-full"} value={year} onChange={(e) => setYear(e.target.value)}><option value="">全部學年度</option>{years.map((value) => <option key={value} value={value}>{academicYearLabel(value)}</option>)}</select></label>
    <label className="min-w-0 text-xs font-medium text-slate-600 dark:text-slate-300">學期<select aria-label="篩選學期" className={inputCls + " mt-1 block max-w-full"} value={semester} onChange={(e) => setSemester(e.target.value as Semester | "")}><option value="">全部學期</option>{Object.entries(SEMESTERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
  </>;
  const timetableTerm = { academic_year: Number(year) || current.academic_year, semester: semester || current.semester };
  return <Page className="min-w-0">
    <PageHeader title="學期課綱" subtitle="這學期的學習目標、進度與評量安排，集中保存。" actions={user.role === "admin" && view === "syllabus" ? <Button variant="primary" onClick={() => setUploading(true)}><UploadSimple size={18} /> 上傳 syllabus</Button> : undefined} />
    <div role="tablist" aria-label="課綱與課表" className="mb-6 inline-flex max-w-full gap-1 rounded-2xl bg-black/[.045] p-1 dark:bg-white/[.06]">
      {([["syllabus", "課綱"], ["timetable", "課表"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} type="button" onClick={() => filter({ view: id })} className={"min-h-11 rounded-xl px-5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 " + (view === id ? "bg-white text-ink-900 shadow-[var(--shadow-soft)] dark:bg-ink-900 dark:text-white" : "text-slate-600 dark:text-slate-300")}>{label}</button>)}
    </div>
    {view === "timetable" ? <>
      <div className="mb-6 flex flex-wrap items-end gap-3">{termSelects}</div>
      <Timetable term={timetableTerm} />
    </> : <>
    <Reveal><div className="mb-7 flex min-w-0 flex-col justify-between gap-6 rounded-[28px] bg-black/[.035] px-6 py-7 sm:flex-row sm:items-end sm:px-8 dark:bg-white/[.045]">
      <div className="min-w-0"><p className="mb-3 font-mono text-[10px] tracking-[.2em] text-slate-500 dark:text-slate-400">SEMESTER SYLLABUS</p><h2 className="font-display text-4xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{title}</h2><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{semester ? SEMESTERS[semester] : "全部學期"} · {subject ? subjects.data?.find((s) => s.id === subject)?.name ?? "指定科目" : "全部科目"}</p></div>
      <div className="flex items-baseline gap-2"><span className="font-display text-4xl font-medium tabular-nums">{query.isLoading ? "—" : filtered.length}</span><span className="text-xs text-slate-500 dark:text-slate-400">份課綱</span></div>
    </div></Reveal>
    <div className="mb-6 flex flex-wrap items-end gap-3">
      {termSelects}
      <label><span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">科目</span><SubjectSelect value={subject} onChange={setSubject} allowAll /></label>
      <label className="min-w-40 flex-1 text-xs font-medium text-slate-600 dark:text-slate-300">搜尋<input aria-label="搜尋課綱" className={inputCls + " mt-1 w-full"} value={search} onChange={(e) => filter({ q: e.target.value }, true)} placeholder="搜尋課綱名稱" maxLength={200} /></label>
      {!defaultFilter && <Button variant="ghost" onClick={() => filter({ academic_year: String(current.academic_year), semester: current.semester, subject_id: "", q: "" })}>回到本學期</Button>}
    </div>
    {query.error && <div className="mb-4 space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-white/10"><ErrorBox error={query.error} /><Button disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "重試中…" : "重新載入課綱"}</Button></div>}
    {query.isLoading ? <Loading /> : !query.data ? null : filtered.length === 0 ? <Empty icon={<CalendarBlank size={34} />} title={all.length === 0 ? "尚未上傳學期課綱" : "目前篩選沒有課綱"}><p className="max-w-sm text-center leading-relaxed">{user.role === "admin" ? "上傳 PDF 並指定學年度與學期，即可讓成員查閱。也可以切換學期尋找歷年資料。" : "管理員上傳後，這裡會顯示你有權存取的課綱。可切換學期或科目查看其他資料。"}</p></Empty> : <Stagger className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">{filtered.map((book) => <StaggerItem key={book.id} className="min-w-0">
      <article className="h-full rounded-[26px] bg-black/[.035] p-1.5 dark:bg-white/[.045]"><div className="flex h-full flex-col rounded-[21px] bg-white p-5 dark:bg-ink-900">
        <div className="flex items-start gap-4"><div className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-100 text-slate-500 dark:bg-white/5 dark:text-slate-400">{book.has_cover ? <img alt="" src={`/api/books/${book.id}/cover`} className="h-full w-full object-cover" loading="lazy" /> : <FilePdf size={25} />}</div><div className="min-w-0 flex-1"><p className="mb-1 text-[11px] text-slate-500 dark:text-slate-400">{book.academic_year ? academicYearLabel(book.academic_year) : "未設定學年度"} · {book.semester ? SEMESTERS[book.semester] : "未設定學期"}</p><h3 className="font-display [overflow-wrap:anywhere] text-lg leading-snug font-semibold">{book.title}</h3><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{book.subject_id ? subjects.data?.find((s) => s.id === book.subject_id)?.name ?? "指定科目" : "共同課程"}</p></div>{user.role === "admin" && book.status === "ready" && <IconButton label={`設定 ${book.title}`} onClick={() => setEditing(book)}><GearSix size={18} /></IconButton>}</div>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400"><span>{book.status === "ready" ? `${book.page_count ? `${book.page_count} 頁 · ` : ""}${fmtBytes(book.size_bytes)}` : "上傳未完成"}</span><span>更新 {fmtDate(book.updated_at).slice(0, 10)}</span></div>
        <div className="mt-4 flex items-center gap-3 border-t border-black/5 pt-4 dark:border-white/5">{book.status === "ready" ? <><Link to={`/books/${book.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink-900 px-4 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 dark:bg-white dark:text-ink-900">閱讀課綱 <ArrowUpRight size={15} /></Link><a href={`/api/books/${book.id}/file`} download={`${book.title.replace(/\.pdf$/i, "")}.pdf`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs text-slate-600 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-slate-300 dark:hover:text-white"><DownloadSimple size={16} /> 下載 PDF</a></> : user.role === "admin" && <Button size="sm" onClick={() => setResuming(book)}>在原裝置選檔續傳</Button>}</div>
      </div></article>
    </StaggerItem>)}</Stagger>}
    <p className="mt-7 text-xs leading-relaxed text-slate-500 dark:text-slate-400">以西元起始年標示學年度。上傳後可在閱讀器檢視、標注，或由已授權的 chatbot 透過 MCP 讀取原始 PDF；實際存取依群組設定。</p>
    </>}
    {(uploading || resuming) && <UploadSheet open onClose={() => { setUploading(false); setResuming(null); }} kind="syllabus" initialValues={resuming ?? undefined} initialTerm={{ academic_year: resuming?.academic_year ?? (Number(year) || current.academic_year), semester: resuming?.semester ?? (semester || current.semester) }} />}
    {editing && <SyllabusSettings book={editing} onClose={() => setEditing(null)} onReplace={() => { setReplacing(editing); setEditing(null); }} />}
    {replacing && <UploadSheet open onClose={() => setReplacing(null)} replace={replacing} kind="syllabus" />}
  </Page>;
}

function SyllabusSettings({ book, onClose, onReplace }: { book: Book; onClose: () => void; onReplace: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(book.title);
  const [year, setYear] = useState(String(book.academic_year ?? currentSyllabusTerm().academic_year));
  const [semester, setSemester] = useState<Semester>(book.semester ?? "1");
  const [subject, setSubject] = useState(book.subject_id ?? "");
  const [busy, setBusy] = useState(false);
  const valid = title.trim() && Number.isInteger(Number(year)) && Number(year) >= 1900 && Number(year) <= 2200;
  return <Sheet open onClose={() => !busy && onClose()} title="課綱設定"><div className="space-y-4 p-5">
    <label className="block text-sm">課綱名稱<input className={inputCls + " mt-1 w-full"} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="grid grid-cols-2 gap-3"><label className="text-sm">西元學年度<input aria-label="編輯學年度" className={inputCls + " mt-1 w-full"} type="number" min={1900} max={2200} value={year} onChange={(e) => setYear(e.target.value)} /></label><label className="text-sm">學期<select aria-label="編輯學期" className={inputCls + " mt-1 w-full"} value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>{Object.entries(SEMESTERS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <label className="block text-sm"><span className="mb-1 block">科目</span><SubjectSelect value={subject} onChange={setSubject} /></label>
    <p className="text-xs leading-relaxed text-slate-500">修改分類會移動這份課綱。新學期的課綱請另行上傳，保留歷年紀錄；替換 PDF 會更新這一份文件並保留標注。</p>
    <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!valid || busy} onClick={async () => {
      setBusy(true);
      try {
        await api.put(`/api/books/${book.id}`, { title, academic_year: Number(year), semester, subject_id: subject || null });
        await qc.invalidateQueries({ queryKey: ["syllabi"] }); await qc.invalidateQueries({ queryKey: ["book", book.id] });
        toast("課綱設定已儲存"); onClose();
      } catch (error) { toast(errorMessage(error), "err"); } finally { setBusy(false); }
    }}>{busy ? "儲存中…" : "儲存設定"}</Button><Button disabled={busy} onClick={onReplace}>替換 PDF</Button></div>
  </div></Sheet>;
}
