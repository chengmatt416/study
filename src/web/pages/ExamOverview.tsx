import { Link, useNavigate, useParams } from "react-router";
import { DeleteDocButton } from "../components/DeleteDocButton";
import { VisibilityButton } from "../components/VisibilityButton";
import { FileText } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { ClockCounterClockwise, Lightning, ListNumbers, Medal, PencilSimple, Play, Timer } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { canEditContent } from "../lib/permissions";
import { useUser } from "../lib/auth";
import { fmtDate } from "../lib/format";
import type { DocDetail } from "../lib/types";
import { Badge, Button, Card, CountUp, ErrorBox, Loading, PageHeader, SubjectDot, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { stripFrontmatter } from "../../shared/markdown";
import { examTakePath, type ExamMode } from "../../shared/exam-instant";
import { TOOLS } from "../features/tools/ToolPanel";

interface Paper {
  document: { deleted?: boolean };
  booklet: { id: string; title: string; page_count: number | null } | null;
  frontmatter: Record<string, unknown>;
  questions: { id: string; points: number }[] | null;
  ready: boolean;
}

export default function ExamOverview() {
  const { slug } = useParams();
  const user = useUser();
  const navigate = useNavigate();
  const doc = useQuery({ queryKey: ["doc", slug], queryFn: () => api.get<DocDetail>(`/api/documents/${slug}`) });
  const paper = useQuery({ queryKey: ["paper", slug], queryFn: () => api.get<Paper>(`/api/exams/${slug}/paper`) });
  const attempts = useQuery({ queryKey: ["attempts", slug], queryFn: () => api.get<{ attempts: { id: string; mode: ExamMode; started_at: number; submitted_at: number | null; score: number | null; max_score: number | null; duration_sec: number | null; paused_at: number | null }[] }>(`/api/exams/${slug}/attempts`) });
  const stats = useQuery({
    queryKey: ["exam-stats", slug],
    queryFn: () => api.get<{ attempts: number; users: number; questions: { id: string; correctRate: number; attempts: number }[] }>(`/api/exams/${slug}/stats`),
    enabled: user.role === "admin",
  });
  const review = useQuery({ queryKey: ["exam-review", slug], queryFn: () => api.get<{ review: { status: "pending" | "passed" | "failed"; decision: "redo" | "edit" | null; rounds: number; report: { problems?: string[]; overall?: { notes?: string } } | null } | null }>(`/api/exams/${slug}/review`) });

  if (doc.error || paper.error) return <div className="space-y-3 p-6"><ErrorBox error={doc.error ?? paper.error} /><Button onClick={() => { if (doc.error) void doc.refetch(); else void paper.refetch(); }}>重新載入試卷</Button></div>;
  if (!doc.data || !paper.data) return <Loading />;
  const d = doc.data.document;
  const fm = stripFrontmatter(doc.data.body).data;
  const total = paper.data.questions?.reduce((s, q) => s + q.points, 0) ?? 0;
  const calculators = Array.isArray(fm.calculators) ? (fm.calculators as string[]) : null;
  const open = attempts.data?.attempts.find(a => !a.submitted_at && a.mode !== "instant");
  const openInstant = attempts.data?.attempts.find(a => !a.submitted_at && a.mode === "instant");

  return (
    <Page>
      <PageHeader
        title={d.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><SubjectDot subjectId={d.subject_id} />{review.data?.review?.status === "passed" ? <Badge color="green">IB 對齊已由 AI 覆核</Badge> : review.data?.review?.status === "pending" ? <Badge color="yellow">待 AI 對齊覆核</Badge> : review.data?.review?.status === "failed" ? <Badge color="red">覆核未通過，AI {review.data.review.decision === "redo" ? "重做中" : "修改中"}</Badge> : null}</span>}
        actions={
          <>
            <Link to={`/exams/${slug}/history`}>
              <Button variant="ghost" size="sm">
                <ClockCounterClockwise size={18} /> 歷史
              </Button>
            </Link>
            {canEditContent(user, d) && <><Link to={`/exams/${slug}/edit`}>
              <Button size="sm"><PencilSimple size={18} /> 編輯題目/答案</Button>
            </Link>
            <VisibilityButton kind="document" id={d.slug} title={d.title} createdBy={d.created_by} visibility={d.visibility} />
            <DeleteDocButton slug={d.slug} kind="exam" title={d.title} createdBy={d.created_by} visibility={d.visibility} /></>}
          </>
        }
      />
      {doc.data.baseline !== null && (
        <div className="mb-4 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm dark:border-yellow-700 dark:bg-yellow-900/20">
          此試卷在原版之後有修訂，作答時修訂處會以 <span className="rev-ins">螢光</span> 標示。
        </div>
      )}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-white/5">
          {[
            { icon: ListNumbers, value: paper.data.questions?.length ?? 0, label: "題" },
            { icon: Medal, value: total, label: "總分" },
            { icon: Timer, value: Number(fm.time_limit_min ?? 0), label: fm.time_limit_min ? "分鐘" : "不限時" },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1 px-2 py-6">
              <s.icon size={22} className="text-brand-500" />
              <div className="font-display text-3xl font-semibold"><CountUp value={s.value} /></div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 p-5 dark:border-white/5">
        {paper.data.booklet && (
          <Link to={`/books/${paper.data.booklet.id}`} className="mt-4 flex items-center gap-3 rounded-2xl bg-ink-100 p-3 text-sm transition hover:bg-ink-200 dark:bg-white/5 dark:hover:bg-white/10">
            <FileText size={22} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">資料手冊：{paper.data.booklet.title}</div>
              <div className="text-xs text-slate-500">作答時可從上方工具列開啟查閱{paper.data.booklet.page_count ? `・${paper.data.booklet.page_count} 頁` : ""}</div>
            </div>
          </Link>
        )}
        <div className="mt-4 text-sm text-slate-600 dark:text-slate-300">
          可用工具：{calculators === null ? "全部計算機" : calculators.length === 0 ? "不可使用計算機" : calculators.map((c) => TOOLS.find((t) => t.id === c)?.label ?? c).join("、")}
        </div>
        {paper.data.document.deleted ? (
          <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">此試卷已被刪除（在垃圾桶中），無法作答。</div>
        ) : !paper.data.ready ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">此試卷尚未設定（或核准）答案，暫時無法作答。</div>
        ) : (
          <div className="mt-5 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="lg" onClick={() => navigate(examTakePath(slug!))}>
                <Play size={18} weight="fill" /> {open ? (open.paused_at ? "繼續考試（已暫停）" : "繼續作答") : "開始作答"}
              </Button>
              {open && (
                <Button
                  size="lg"
                  onClick={async () => {
                    try {
                      const fresh = await api.post<{ id: string }>(`/api/exams/${slug}/attempts?fresh=1`);
                      navigate(examTakePath(slug!, "exam", fresh.id));
                    } catch (e) {
                      toast(errorMessage(e), "err");
                    }
                  }}
                >
                  重新開始
                </Button>
              )}
              <Button size="lg" onClick={() => navigate(examTakePath(slug!, "instant"))}>
                <Lightning size={18} weight="fill" /> {openInstant ? "繼續 Instant 練習" : "Instant 即時練習"}
              </Button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">Instant 不限時。每題檢查後鎖定作答，開放題由平台 AI 批改，系統判分的題目可請 AI 複核。</p>
          </div>
        )}
        </div>
      </Card>

      {(attempts.data?.attempts.length ?? 0) > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">我的作答紀錄</h2>
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {attempts.data!.attempts.map((a) => (
              <Link key={a.id} to={a.submitted_at ? `/attempts/${a.id}` : examTakePath(slug!, a.mode, a.id)} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <span className="flex-1">{fmtDate(a.started_at)} {a.mode === "instant" && <span className="ml-1 text-xs text-slate-500">Instant</span>}</span>
                {a.submitted_at ? (
                  <>
                    <span className="font-mono">
                      {a.score}/{a.max_score}
                    </span>
                    <Badge color={(a.score ?? 0) / (a.max_score || 1) >= 0.8 ? "green" : (a.score ?? 0) / (a.max_score || 1) >= 0.6 ? "yellow" : "red"}>{Math.round(((a.score ?? 0) / (a.max_score || 1)) * 100)}%</Badge>
                    <span className="text-xs text-slate-500">{a.duration_sec ? `${Math.round(a.duration_sec / 60)} 分` : ""}</span>
                  </>
                ) : (
                  <Badge color="blue">{a.paused_at ? "已暫停" : "作答中"}</Badge>
                )}
              </Link>
            ))}
          </Card>
        </section>
      )}

      {user.role === "admin" && stats.data && stats.data.attempts > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">
            答題統計（{stats.data.users} 人 / {stats.data.attempts} 次）
          </h2>
          <Card className="p-4">
            {stats.data.questions.map((q) => (
              <div key={q.id} className="mb-2 flex items-center gap-3 text-sm">
                <span className="w-12 font-mono">{q.id}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <motion.div className={q.correctRate < 0.3 ? "h-full bg-rose-500" : "h-full bg-aurora"} initial={{ width: 0 }} animate={{ width: `${q.correctRate * 100}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <span className="w-12 text-right">{Math.round(q.correctRate * 100)}%</span>
              </div>
            ))}
            <p className="mt-2 text-xs text-slate-500">答對率特別低的題目，可能是題目或答案有誤。修正答案後可在後台「重新批改」。</p>
            <Button
              size="sm"
              className="mt-2"
              onClick={async () => {
                const r = await api.post<{ regraded: number }>(`/api/exams/${slug}/regrade`);
                toast(`已重新批改 ${r.regraded} 份`);
                void stats.refetch();
                void attempts.refetch();
              }}
            >
              以目前答案重新批改全部
            </Button>
          </Card>
        </section>
      )}
    </Page>
  );
}
