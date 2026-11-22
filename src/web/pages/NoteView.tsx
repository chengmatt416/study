import { useMemo, useState } from "react";
import { canEditContent } from "../lib/permissions";
import { DeleteDocButton } from "../components/DeleteDocButton";
import { VisibilityButton } from "../components/VisibilityButton";
import { motion, useReducedMotion } from "motion/react";
import { ClockCounterClockwise, GitDiff, ListBullets, PencilSimple, SealCheck } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { fmtDate, fmtRelative } from "../lib/format";
import type { DocDetail } from "../lib/types";
import { Button, ErrorBox, Loading, Reveal, Sheet, SubjectDot, Tabs, toast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { extractHeadings } from "../../shared/markdown";
import { NoteCoursePanel } from "../features/openmaic/NoteCoursePanel";
import { ContentTransition } from "../components/ContentTransition";

type View = "marked" | "clean" | "baseline";

export function RevisionBanner({ data, view, setView, hideDel, setHideDel, slug }: { data: DocDetail; view: View; setView: (v: View) => void; hideDel: boolean; setHideDel: (v: boolean) => void; slug: string }) {
  const user = useUser();
  const qc = useQueryClient();
  if (data.baseline === null || !data.changes) return null;
  const names = data.changes.users.map((u) => u.name ?? u.email.split("@")[0]).join("、");
  return (
    <Reveal className="mb-6 overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4 text-sm shadow-[var(--shadow-soft)] dark:border-amber-500/30 dark:from-amber-500/10 dark:to-yellow-500/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-400 text-white"><GitDiff size={18} weight="bold" /></span>
        <span className="min-w-0 flex-1">
          原版之後有 {data.changes.revisionCount} 次修訂{names && `（${names}）`}，最近 {fmtRelative(data.changes.lastAt)}。<span className="rev-ins">黃色螢光</span>為新增、<del className="rev-del">灰色刪除線</del>為刪除。
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Tabs<View>
          value={view}
          onChange={setView}
          items={[
            { value: "marked", label: "標示修訂" },
            { value: "clean", label: "目前版" },
            { value: "baseline", label: "原版" },
          ]}
        />
        {view === "marked" && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={hideDel} onChange={(e) => setHideDel(e.target.checked)} /> 隱藏刪除內容
          </label>
        )}
        {user.role === "admin" && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            onClick={async () => {
              if (!confirm("確認目前版本為新的原版？螢光標示將會清除。")) return;
              try {
                await api.post(`/api/documents/${slug}/baseline`);
                qc.invalidateQueries({ queryKey: ["doc", slug] });
                toast("已設為原版");
              } catch (e) {
                toast(errorMessage(e), "err");
              }
            }}
          >
            <SealCheck size={18} weight="fill" /> 確認為原版
          </Button>
        )}
      </div>
    </Reveal>
  );
}

export default function NoteView() {
  const { slug } = useParams();
  const user = useUser();
  return slug ? <NoteContent key={`${user.id}:${slug}`} slug={slug} /> : <ErrorBox error="找不到這份重點整理" />;
}

function NoteContent({ slug }: { slug: string }) {
  const user = useUser();
  const [search, setSearch] = useSearchParams();
  const section = search.get("view") === "course" ? "course" : "note";
  const device = useDevice();
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>("marked");
  const [hideDel, setHideDel] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["doc", slug], queryFn: () => api.get<DocDetail>(`/api/documents/${slug}`) });
  const shown = data ? (view === "baseline" && data.baseline !== null ? data.baseline : data.body) : "";
  const headings = useMemo(() => extractHeadings(shown).filter((h) => h.depth <= 3), [shown]);

  if (isLoading) return <Loading />;
  if (error || !data) return <div className="space-y-3 p-4"><ErrorBox error={error ?? "無法讀取重點整理"} /><Button onClick={() => void refetch()}>重新讀取重點整理</Button></div>;
  const d = data.document;

  const toc = (
    <nav className="space-y-0.5 text-sm">
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${encodeURIComponent(h.id)}`}
          onClick={(e) => {
            e.preventDefault();
            const target = document.getElementById(h.id);
            target?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
            setTocOpen(false);
            requestAnimationFrame(() => { if (target?.isConnected) { target.tabIndex = -1; target.focus({ preventScroll: true }); } });
          }}
          className={clsx("flex min-h-11 items-center truncate rounded-xl border-l-2 border-transparent px-3 py-1.5 text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/60 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white dark:focus-visible:ring-white", h.depth === 3 && "pl-6 text-xs", h.depth === 1 && "font-semibold text-slate-700 dark:text-slate-200")}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="mx-auto flex max-w-7xl gap-8 px-4 py-4 md:px-8 md:py-6">
      <Reveal className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-[1_1_16rem]">
            <h1 className="font-display text-3xl leading-tight font-semibold md:text-4xl">{d.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <SubjectDot subjectId={d.subject_id} />
              <span>更新於 {fmtDate(d.updated_at)}</span>
            </div>
          </div>
          <div className="flex max-w-full flex-wrap gap-2">
            <Link to={`/notes/${d.slug}/history`}>
              <Button size="sm" variant="ghost">
                <ClockCounterClockwise size={18} /> 歷史
              </Button>
            </Link>
            {canEditContent(user, d) && <><Link to={`/notes/${d.slug}/edit`}>
              <Button size="sm"><PencilSimple size={18} /> 編輯</Button>
            </Link>
            <VisibilityButton kind="document" id={d.slug} title={d.title} createdBy={d.created_by} visibility={d.visibility} />
            <DeleteDocButton slug={d.slug} kind="note" title={d.title} createdBy={d.created_by} visibility={d.visibility} /></>}
          </div>
        </div>
        {d.status === "archived" && <div className="mb-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">此重點整理已被刪除（在垃圾桶中），管理員可在後台復原。</div>}
        <div className="mb-5"><Tabs<"note" | "course"> value={section} onChange={(value) => { const next = new URLSearchParams(search); if (value === "course") next.set("view", "course"); else next.delete("view"); setSearch(next); }} items={[{ value: "note", label: "重點整理" }, { value: "course", label: "OpenMAIC 互動課程" }]} /></div>
        <ContentTransition id={section}>{section === "course" ? <NoteCoursePanel key={d.slug} slug={d.slug} title={d.title} canGenerate={canEditContent(user, d) && user.access?.features.ai !== false} canEdit={canEditContent(user, d)} /> : <>
          <RevisionBanner data={data} view={view} setView={setView} hideDel={hideDel} setHideDel={setHideDel} slug={d.slug} />
          <Markdown md={shown} baseline={view === "marked" ? data.baseline : null} hideDeletions={hideDel} />
        </>}</ContentTransition>
      </Reveal>
      {section === "note" && device === "desktop" && headings.length > 2 && (
        <aside className="sticky top-4 hidden max-h-[calc(100vh-6rem)] w-60 shrink-0 self-start overflow-auto lg:block">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-brand-600 uppercase"><ListBullets size={16} /> 目錄</div>
          {toc}
        </aside>
      )}
      {section === "note" && device !== "desktop" && headings.length > 2 && (
        <>
          <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }} whileTap={{ scale: 0.9 }} transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.3 }} onClick={() => setTocOpen(true)} className="fixed right-4 bottom-28 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-aurora text-on-accent shadow-[var(--shadow-glow)] md:bottom-8" aria-label="目錄">
            <ListBullets size={24} weight="bold" />
          </motion.button>
          <Sheet open={tocOpen} onClose={() => setTocOpen(false)} title="目錄">
            <div className="p-3">{toc}</div>
          </Sheet>
        </>
      )}
    </div>
  );
}
