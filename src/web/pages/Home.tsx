import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { ArrowRight, BookOpen, CalendarCheck, Cards, Exam, Lightning, NotePencil, Sparkle } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { daysUntil, fmtRelative } from "../lib/format";
import { nextAssessment } from "../../shared/assessment-schedule";
import type { Book, DeckSummary, DocSummary } from "../lib/types";
import { Button, Card, CountUp, ErrorBox, Reveal, Ring, Stagger, StaggerItem, SubjectDot } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Page } from "../layouts/Shell";

interface Assessment {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  scope: { id: string; subject_id: string; subject_name: string; color: string; has_exam: number; coverage_md: string | null; exam_date: string | null }[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "夜深了" : h < 12 ? "早安" : h < 18 ? "午安" : "晚安";
}

export default function Home() {
  const user = useUser();
  const device = useDevice();
  const features = user.access?.features;
  const canDecks = features?.decks !== false, canBooks = features?.ebooks !== false, canNotes = features?.notes !== false, canExams = features?.exams !== false;
  const assessments = useQuery({ queryKey: ["assessments"], queryFn: () => api.get<{ assessments: Assessment[] }>("/api/assessments") });
  const decks = useQuery({ queryKey: ["decks"], queryFn: () => api.get<{ decks: DeckSummary[] }>("/api/decks"), enabled: canDecks });
  const books = useQuery({ queryKey: ["books"], queryFn: () => api.get<{ books: Book[] }>("/api/books"), enabled: canBooks });
  const docs = useQuery({ queryKey: ["documents", ""], queryFn: () => api.get<{ documents: DocSummary[] }>("/api/documents"), enabled: canNotes || canExams });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const next = nextAssessment(assessments.data?.assessments ?? [], today);
  const deckList = decks.data?.decks ?? [];
  const dueTotal = deckList.reduce((s, d) => s + d.due, 0);
  const newTotal = deckList.reduce((s, d) => s + Math.min(d.new_count, 20), 0);
  const totalCards = deckList.reduce((s, d) => s + d.total, 0);
  const learned = deckList.reduce((s, d) => s + (d.total - d.new_count), 0);
  const readingBooks = canBooks ? (books.data?.books ?? []).filter((b) => b.last_page && b.status === "ready") : [];
  const reading = readingBooks.slice(0, 6);
  const recent = (docs.data?.documents ?? []).filter((document) => document.kind === "note" ? canNotes : canExams).sort((a, b) => b.updated_at - a.updated_at).slice(0, 6);
  const startDays = next?.start_date ? daysUntil(next.start_date) : NaN;
  const daysLeft = Number.isFinite(startDays) ? Math.max(0, startDays) : null;
  const failed = [
    { name: "考試範圍", query: assessments, enabled: true },
    { name: "字卡進度", query: decks, enabled: canDecks },
    { name: "閱讀紀錄", query: books, enabled: canBooks },
    { name: "重點整理與試題", query: docs, enabled: canNotes || canExams },
  ].filter((item) => item.enabled && item.query.error);

  return (
    <Page wide>
      {/* Hero */}
      <Reveal>
        <div className="relative overflow-hidden rounded-[32px] bg-hero p-6 text-white shadow-[var(--shadow-lift)] md:p-9 border border-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
          <div className={clsx("relative flex gap-6", device === "phone" ? "flex-col" : "items-center")}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                <Sparkle size={15} weight="fill" className="text-zinc-400" /> {new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}
              </div>
              <h1 className="mt-2 font-display text-3xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere] md:text-5xl">
                {greeting()}，{user.name?.split(" ")[0] ?? user.email.split("@")[0]}
              </h1>
              <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-zinc-300 md:text-base">
                {canDecks && decks.data && dueTotal > 0 ? `今天有 ${dueTotal} 張字卡等待複習，花 10 分鐘清空進度吧。` : next && daysLeft !== null ? `距離 ${next.title} 還有 ${daysLeft} 天，持續穩定累積。` : "選一個主題，開始今天的專注學習。"}
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {(device === "phone" || canDecks) && <Link to={device === "phone" ? "/practice" : "/decks"} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-zinc-950 shadow-md transition duration-150 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <Lightning size={18} weight="fill" /> {device === "phone" ? "混合複習" : "開始複習"}
                </Link>}
                {canExams && <Link to="/exams" className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur transition duration-150 hover:bg-white/20 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <Exam size={18} /> 模擬試題
                </Link>}
                {!canDecks && !canExams && <Link to="/content" className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-5 text-sm font-semibold text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><BookOpen size={18} />開啟內容庫</Link>}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {canDecks && <div className="flex flex-col items-center justify-center rounded-3xl border border-white/15 bg-white/[0.08] p-4 backdrop-blur-md">
                <Ring value={totalCards ? learned / totalCards : 0} size={device === "phone" ? 84 : 108} stroke={8} className="text-white">
                  <div className="text-center">
                    <div className="font-display text-2xl font-semibold tabular-nums md:text-3xl">
                      {decks.data ? <CountUp value={dueTotal} /> : "—"}
                    </div>
                    <div className="text-xs font-medium text-zinc-400">到期</div>
                  </div>
                </Ring>
                <div className="mt-2 text-center text-xs text-zinc-300 tabular-nums">{decks.data ? `已學 ${learned}/${totalCards}` : decks.error ? "進度暫時無法載入" : "正在讀取進度"}</div>
              </div>}
              {daysLeft !== null && (
                <div className="flex min-w-[100px] flex-col items-center justify-center rounded-3xl border border-white/15 bg-white/[0.08] px-5 py-4 backdrop-blur-md">
                  <div className="text-xs font-medium text-zinc-400">D-Day 倒數</div>
                  <div className="font-display text-4xl font-semibold tabular-nums md:text-5xl">
                    <CountUp value={daysLeft} />
                  </div>
                  <div className="mt-1 max-w-28 truncate text-center text-xs text-zinc-300">{next?.title}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Reveal>

      {failed.length > 0 && <Card className="mt-5 space-y-3 p-4"><p className="text-sm font-medium">部分首頁資料暫時無法載入：{failed.map((item) => item.name).join("、")}</p><ErrorBox error={failed[0].query.error} /><Button disabled={failed.some((item) => item.query.isFetching)} onClick={() => { void Promise.all(failed.map((item) => item.query.refetch())); }}>重新載入首頁資料</Button></Card>}

      {/* 快速統計 */}
      <Stagger className={clsx("mt-6 grid gap-3", device === "phone" ? "grid-cols-2" : "grid-cols-4")}>
        {[
          { icon: Cards, label: "新卡可學", value: newTotal, to: "/decks", enabled: canDecks, ready: !!decks.data },
          { icon: BookOpen, label: "閱讀中", value: readingBooks.length, to: "/books?resume=1", enabled: canBooks, ready: !!books.data },
          { icon: NotePencil, label: "重點整理", value: (docs.data?.documents ?? []).filter((d) => d.kind === "note").length, to: "/notes", enabled: canNotes, ready: !!docs.data },
          { icon: Exam, label: "模擬試題", value: (docs.data?.documents ?? []).filter((d) => d.kind === "exam").length, to: "/exams", enabled: canExams, ready: !!docs.data },
        ].filter((s) => s.enabled).map((s) => (
          <StaggerItem key={s.label}>
            <Link to={s.to}>
              <Card interactive className="flex items-center gap-3 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-900 text-white shadow-sm dark:bg-white dark:text-ink-900">
                  <s.icon size={22} weight="fill" />
                </span>
                <div>
                  <div className="font-display text-2xl leading-none font-semibold tabular-nums">
                    {s.ready ? <CountUp value={s.value} /> : "—"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.label}</div>
                </div>
              </Card>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      {next && (
        <section className="mt-10">
          <Reveal className="mb-4 flex items-center gap-2">
            <CalendarCheck size={22} className="shrink-0 text-brand-600" />
            <h2 className="min-w-0 font-display text-2xl font-semibold [overflow-wrap:anywhere]">{next.title} 考試範圍</h2>
          </Reveal>
          <Stagger className={clsx("grid gap-3", device === "phone" ? "grid-cols-1" : "grid-cols-2")}>
            {next.scope.map((s) => (
              <StaggerItem key={s.id}>
                <Card className="relative h-full overflow-hidden p-5">
                  <div className="absolute inset-y-0 left-0 w-1" style={{ background: s.color }} />
                  <div className="mb-2 flex items-center gap-2">
                    <span className="font-semibold">{s.subject_name}</span>
                    {!s.has_exam && <span className="text-xs text-slate-500">無紙筆考試</span>}
                    {s.exam_date && <span className="ml-auto rounded-full bg-slate-900/5 px-2 py-0.5 text-xs text-slate-500 dark:bg-white/5">{s.exam_date}</span>}
                  </div>
                  {s.coverage_md && <Markdown md={s.coverage_md} className="text-sm leading-6" />}
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}

      {reading.length > 0 && (
        <section className="mt-10">
          <Reveal className="mb-4 flex items-center gap-2">
            <BookOpen size={22} className="text-brand-600" />
            <h2 className="font-display text-2xl font-semibold">繼續閱讀</h2>
          </Reveal>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-3">
            {reading.map((b, i) => (
              <motion.div key={b.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24, delay: i * 0.06 }} className="w-36 shrink-0">
                <Link to={`/books/${b.id}?page=${b.last_page}`} className="group block">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-slate-200 shadow-[var(--shadow-soft)] transition duration-300 group-hover:-translate-y-1.5 group-hover:rotate-[-1.5deg] group-hover:shadow-[var(--shadow-lift)] dark:bg-ink-800">
                    {b.has_cover ? <img src={`/api/books/${b.id}/cover`} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-brand-400"><BookOpen size={44} /></div>}
                    {b.page_count && (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                        <div className="h-full bg-aurora" style={{ width: `${((b.last_page ?? 0) / b.page_count) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="mt-2 line-clamp-2 text-sm font-medium">{b.title}</div>
                  <div className="text-xs text-slate-500">第 {b.last_page} 頁</div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-10">
          <Reveal className="mb-4 flex items-center gap-2">
            <Sparkle size={22} className="text-brand-600" />
            <h2 className="font-display text-2xl font-semibold">最近更新</h2>
          </Reveal>
          <Card className="overflow-hidden">
            <Stagger>
              {recent.map((d) => (
                <StaggerItem key={d.id}>
                  <Link to={`/${d.kind === "note" ? "notes" : "exams"}/${d.slug}`} className="group flex items-center gap-3 border-b border-slate-100 px-5 py-3.5 transition last:border-0 hover:bg-brand-50/50 dark:border-white/5 dark:hover:bg-white/5">
                    <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-xl", "bg-ink-100 text-ink-900 dark:bg-white/10 dark:text-white")}>
                      {d.kind === "note" ? <NotePencil size={18} /> : <Exam size={18} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.title}</div>
                      <SubjectDot subjectId={d.subject_id} />
                    </div>
                    {d.has_revisions ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">有修訂</span> : null}
                    <span className="hidden text-xs text-slate-400 sm:inline">{fmtRelative(d.updated_at)}</span>
                    <ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-brand-500" />
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          </Card>
        </section>
      )}
    </Page>
  );
}
