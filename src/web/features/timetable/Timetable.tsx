import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck, MapPin, Plus, Trash } from "@phosphor-icons/react";
import type { SyllabusTerm } from "../../../shared/syllabus";
import { byTime, conflictsWith, entriesForDay, timetableDraftSchema, todayWeekday, visibleDays, WEEKDAYS, type TimetableEntry } from "../../../shared/timetable";
import { api, errorMessage } from "../../lib/api";
import { Button, Empty, ErrorBox, inputCls, Loading, Sheet, SubjectSelect, toast, useSubjects } from "../../components/ui";

type Draft = { day: number; start: string; end: string; title: string; room?: string; subject_id: string | null };

/** 課表存在伺服器，依帳號、學年度與學期分開；MCP 修改後重新整理即可看到。 */
function useTimetable(term: SyllabusTerm) {
  const qc = useQueryClient();
  const queryKey = ["timetable", term.academic_year, term.semester];
  const query = useQuery({ queryKey, queryFn: () => api.get<{ entries: TimetableEntry[] }>(`/api/timetable?academic_year=${term.academic_year}&semester=${term.semester}`), refetchOnWindowFocus: true });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const body = (d: Draft) => ({ ...d, room: d.room?.trim() || null, subject_id: d.subject_id || null });
  const add = useMutation({ mutationFn: (d: Draft) => api.post("/api/timetable", { ...body(d), ...term }), onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, draft }: { id: string; draft: Draft }) => api.put(`/api/timetable/${id}`, body(draft)), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/api/timetable/${id}`), onSuccess: refresh });
  return { query, entries: useMemo(() => [...(query.data?.entries ?? [])].sort(byTime), [query.data]), add, update, remove };
}

const blank = (day: number): Draft => ({ day, start: "08:00", end: "08:50", title: "", room: "", subject_id: null });

export function Timetable({ term }: { term: SyllabusTerm }) {
  const subjects = useSubjects();
  const { query, entries, add, update, remove } = useTimetable(term);
  const today = todayWeekday();
  const days = visibleDays(entries);
  const [day, setDay] = useState(today <= 5 ? today : 1);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const subjectOf = (id?: string | null) => (id ? subjects.data?.find((s) => s.id === id) : undefined);
  const activeDay = days.includes(day) ? day : days[0];

  const card = (e: TimetableEntry) => {
    const subject = subjectOf(e.subject_id);
    return <button key={e.id} type="button" onClick={() => setEditing({ id: e.id, draft: { day: e.day, start: e.start, end: e.end, title: e.title, room: e.room ?? "", subject_id: e.subject_id ?? null } })}
      className="block w-full min-w-0 rounded-2xl border-l-4 bg-white p-3 text-left shadow-[var(--shadow-soft)] transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-ink-900" style={{ borderLeftColor: subject?.color ?? "#64748b" }}>
      <span className="block font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{e.start}–{e.end}</span>
      <span className="mt-0.5 block text-sm font-semibold [overflow-wrap:anywhere]">{e.title}</span>
      {(e.room || subject) && <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">{e.room && <span className="inline-flex min-w-0 items-center gap-0.5"><MapPin size={12} className="shrink-0" /><span className="[overflow-wrap:anywhere]">{e.room}</span></span>}{subject && <span>{subject.name}</span>}</span>}
    </button>;
  };

  return <section aria-label="課表" className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">課表依學年度與學期保存在你的帳號，各裝置與已授權的 chatbot（MCP）都會同步。</p>
      <Button variant="primary" onClick={() => setEditing({ draft: blank(activeDay) })}><Plus size={18} /> 新增課程</Button>
    </div>
    {query.error ? <ErrorBox error={query.error} /> : query.isLoading ? <Loading /> : entries.length === 0 ? <Empty icon={<CalendarCheck size={34} />} title="這學期還沒有課表"><p className="max-w-sm text-center leading-relaxed">新增每週固定的課程與時間，就能一眼看到每天的安排。</p></Empty> : <>
      <div role="tablist" aria-label="選擇星期" className="no-scrollbar mb-3 flex gap-2 overflow-x-auto md:hidden">
        {days.map((d) => <button key={d} role="tab" aria-selected={d === activeDay} type="button" onClick={() => setDay(d)}
          className={clsx("min-h-10 shrink-0 rounded-xl px-4 text-sm font-medium transition", d === activeDay ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-black/[.045] text-slate-600 dark:bg-white/[.06] dark:text-slate-300")}>
          {WEEKDAYS[d]}{d === today && <span className="ml-1 text-[10px] opacity-70">今天</span>}</button>)}
      </div>
      <div className="space-y-2 md:hidden">{entriesForDay(entries, activeDay).map(card)}{entriesForDay(entries, activeDay).length === 0 && <p className="rounded-2xl bg-black/[.035] py-8 text-center text-sm text-slate-500 dark:bg-white/[.045] dark:text-slate-400">{WEEKDAYS[activeDay]}沒有課</p>}</div>
      <div className="hidden gap-3 md:grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => <div key={d} className="min-w-0">
          <h3 className={clsx("mb-2 rounded-xl px-3 py-1.5 text-center text-xs font-semibold", d === today ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-black/[.045] text-slate-600 dark:bg-white/[.06] dark:text-slate-300")}>{WEEKDAYS[d]}</h3>
          <div className="space-y-2">{entriesForDay(entries, d).map(card)}</div>
        </div>)}
      </div>
    </>}
    {editing && <EntrySheet key={editing.id ?? "new"} initial={editing.draft} id={editing.id} others={entries} busy={add.isPending || update.isPending || remove.isPending} onClose={() => setEditing(null)}
      onSave={async (draft) => { try { if (editing.id) await update.mutateAsync({ id: editing.id, draft }); else await add.mutateAsync(draft); toast(editing.id ? "課程已更新" : "課程已加入課表"); setEditing(null); } catch (error) { toast(errorMessage(error), "err"); } }}
      onDelete={editing.id ? async () => { try { await remove.mutateAsync(editing.id!); toast("課程已從課表移除"); setEditing(null); } catch (error) { toast(errorMessage(error), "err"); } } : undefined} />}
  </section>;
}

function EntrySheet({ initial, id, others, busy, onClose, onSave, onDelete }: { initial: Draft; id?: string; others: TimetableEntry[]; busy: boolean; onClose: () => void; onSave: (draft: Draft) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const parsed = timetableDraftSchema.safeParse(draft);
  const clash = parsed.success ? conflictsWith(others, parsed.data, id) : [];
  return <Sheet open onClose={onClose} title={id ? "編輯課程" : "新增課程"}><div className="space-y-4 p-5">
    <label className="block text-sm">課程名稱<input className={inputCls + " mt-1 w-full"} value={draft.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="例如：數學 AA HL" autoFocus /></label>
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
      <label className="min-w-0 text-sm">星期<select className={inputCls + " mt-1 w-full"} value={draft.day} onChange={(e) => set("day", Number(e.target.value))}>{WEEKDAYS.map((label, d) => d > 0 && <option key={d} value={d}>{label}</option>)}</select></label>
      <label className="min-w-0 text-sm">開始<input className={inputCls + " mt-1 w-full"} type="time" value={draft.start} onChange={(e) => set("start", e.target.value)} /></label>
      <label className="min-w-0 text-sm">結束<input className={inputCls + " mt-1 w-full"} type="time" value={draft.end} onChange={(e) => set("end", e.target.value)} /></label>
    </div>
    <label className="block text-sm">教室／地點（選填）<input className={inputCls + " mt-1 w-full"} value={draft.room ?? ""} maxLength={40} onChange={(e) => set("room", e.target.value)} /></label>
    <label className="block text-sm"><span className="mb-1 block">科目（選填）</span><SubjectSelect value={draft.subject_id ?? ""} onChange={(v) => set("subject_id", v || null)} /></label>
    {draft.end <= draft.start && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">結束時間必須晚於開始時間。</p>}
    {clash.length > 0 && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">與「{clash.map((c) => c.title).join("、")}」時間重疊，仍可儲存。</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" disabled={!parsed.success || busy} onClick={() => parsed.success && onSave(parsed.data)}>{busy ? "儲存中…" : "儲存"}</Button>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      {onDelete && <Button variant="ghost" disabled={busy} onClick={onDelete}><Trash size={16} /> 刪除</Button>}
    </div>
  </div></Sheet>;
}
