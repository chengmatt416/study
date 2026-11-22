// The course blueprint a chatbot submitted, drawn for the learner to check before any classroom is generated:
// chapter order and prerequisites, the difficulty curve, new concepts, objectives, sources, and the chatbot's own check
// against the textbook, the syllabus and the outline the learner asked for. The learner approves it or asks for changes.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, CheckCircle, ClockCountdown, Lightning, ListChecks, PencilSimpleLine, Warning, XCircle } from "@phosphor-icons/react";
import { api, errorMessage } from "../../lib/api";
import { fmtRelative } from "../../lib/format";
import { Badge, Button, Card, Empty, ErrorBox, Loading, textareaCls, toast } from "../../components/ui";
import type { CourseBlueprint } from "../../../shared/course-blueprint";
import type { BlueprintSelfReview } from "../../../shared/generation-review";

interface DraftSummary { id: string; status: "pending_review" | "changes_requested" | "approved" | "started" | "superseded"; mode: "review" | "yolo"; topic: string; round: number; feedback: string | null; generation_id: string | null; note_slug: string; note_title: string; chapter_id: string | null; chapter_title: string | null; updated_at: number }
interface DraftDetail extends DraftSummary { blueprint: CourseBlueprint; self_review: BlueprintSelfReview }

const STATUS: Record<DraftSummary["status"], { label: string; color: "yellow" | "red" | "green" | "blue" | "slate" }> = {
  pending_review: { label: "等你審核", color: "yellow" },
  changes_requested: { label: "已要求修改", color: "red" },
  approved: { label: "已核准", color: "green" },
  started: { label: "生成中／已生成", color: "blue" },
  superseded: { label: "已被新版取代", color: "slate" },
};
const KIND: Record<string, string> = { formula: "公式", concept: "觀念", procedure: "步驟", term: "術語" };
const SOURCE: Record<string, string> = { ib_syllabus: "IB syllabus", ib_guide: "IB guideline", ib_markscheme: "IB mark scheme", ebook: "課本", school_syllabus: "學校課綱", note: "重點整理", chapter_material: "章節教材", textbook: "課本", user_outline: "你的課綱" };

export function BlueprintReview() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("draft");
  const list = useQuery({ queryKey: ["blueprints"], queryFn: () => api.get<{ drafts: DraftSummary[] }>("/api/openmaic/blueprints"), refetchInterval: 20_000 });
  const drafts = list.data?.drafts ?? [];
  const current = selected ?? drafts.find((d) => d.status === "pending_review")?.id ?? drafts[0]?.id ?? null;
  const pick = (id: string) => setParams((p) => { const next = new URLSearchParams(p); next.set("kind", "course"); next.set("draft", id); return next; }, { replace: true });
  if (list.isLoading) return <Loading />;
  if (list.error) return <div className="space-y-2"><ErrorBox error={list.error} /><Button onClick={() => void list.refetch()}>重試</Button></div>;
  if (!drafts.length) return <Empty icon={<ListChecks size={36} />} title="還沒有課程藍圖">
    請 chatbot（透過 MCP 連線）為某一份重點整理或章節規劃互動課程。它會先自我審查藍圖是否符合課本與課綱，再送到這裡讓你審核；你核准後才會開始生成。想讓它全自動完成，可以對它說「yolo」。
  </Empty>;
  return <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
    <nav aria-label="課程藍圖" className="space-y-1.5">
      {drafts.map((d) => <button key={d.id} onClick={() => pick(d.id)} aria-current={d.id === current ? "true" : undefined}
        className={clsx("w-full rounded-2xl px-3 py-2.5 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2", d.id === current ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "hover:bg-slate-900/5 dark:hover:bg-white/5")}>
        <span className="block break-words font-medium">{d.topic}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs opacity-75">{STATUS[d.status].label}{d.mode === "yolo" && " · yolo"} · 第 {d.round} 版 · {fmtRelative(d.updated_at)}</span>
      </button>)}
    </nav>
    {current && <DraftView key={current} id={current} onChanged={() => void list.refetch()} />}
  </div>;
}

function DraftView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["blueprint", id], queryFn: () => api.get<{ draft: DraftDetail }>(`/api/openmaic/blueprints/${encodeURIComponent(id)}`).then((r) => r.draft) });
  const [feedback, setFeedback] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFeedback(""); setAsking(false); }, [id]);
  if (query.isLoading) return <Loading />;
  if (!query.data) return <ErrorBox error={query.error} />;
  const d = query.data, bp = d.blueprint, review = d.self_review;
  const reviewable = d.status === "pending_review" || d.status === "changes_requested";
  const decide = async (decision: "approve" | "changes") => {
    setBusy(true);
    try {
      await api.post(`/api/openmaic/blueprints/${encodeURIComponent(id)}/decision`, decision === "changes" ? { decision, feedback } : { decision });
      await qc.invalidateQueries({ queryKey: ["blueprint", id] }); onChanged();
      toast(decision === "approve" ? "已核准：回到 chatbot 告訴它可以開始生成" : "已送出修改要求：回到 chatbot 請它依你的意見修改");
      setAsking(false);
    } catch (error) { toast(errorMessage(error), "err"); } finally { setBusy(false); }
  };
  const maxMinutes = Math.max(...bp.chapters.map((c) => c.minutes), 1);

  return <article className="min-w-0 space-y-6" aria-label={`課程藍圖：${d.topic}`}>
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><Badge color={STATUS[d.status].color}>{STATUS[d.status].label}</Badge>{d.mode === "yolo" && <Badge color="brand"><Lightning size={11} weight="fill" />yolo：AI 自我審查後自動核准</Badge>}<span className="text-xs text-slate-500">第 {d.round} 版 · {bp.level === "none" ? "非 IB" : `IB ${bp.level}`}</span></div>
      <h2 className="break-words text-xl font-semibold">{d.topic}</h2>
      <p className="text-sm text-slate-500">來源重點整理：<Link className="underline-offset-2 hover:underline" to={`/notes/${encodeURIComponent(d.note_slug)}`}>{d.note_title}</Link>{d.chapter_id && <> · 章節：<Link className="underline-offset-2 hover:underline" to={`/chapters/${encodeURIComponent(d.chapter_id)}`}>{d.chapter_title}</Link></>}</p>
      <p className="text-sm text-slate-500">學習者：{bp.learner}</p>
      {d.feedback && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">你的修改要求：{d.feedback}</p>}
    </header>

    <section aria-label="學習曲線">
      <h3 className="mb-3 text-sm font-semibold text-slate-500">學習曲線（由左到右，柱高是難度、寬度是時間）</h3>
      <ol className="flex items-end gap-2 overflow-x-auto pb-2">
        {bp.chapters.map((c, i) => <li key={c.key} className="flex min-w-24 flex-col items-center gap-1.5" style={{ flex: `${c.minutes / maxMinutes} 0 6rem` }}>
          <span className="text-xs tabular-nums text-slate-500">{c.minutes} 分</span>
          <span className={clsx("w-full rounded-xl", c.difficulty === 1 ? "h-8 bg-slate-300 dark:bg-white/20" : c.difficulty === 2 ? "h-14 bg-slate-500 dark:bg-white/45" : "h-20 bg-ink-900 dark:bg-white")} aria-label={`難度 ${c.difficulty}`} />
          <span className="text-center text-xs font-medium break-words">{i + 1}. {c.key}</span>
        </li>)}
      </ol>
    </section>

    <section aria-label="章節" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-500">章節內容</h3>
      {bp.chapters.map((c, i) => {
        const check = review.chapter_checks.find((x) => x.chapter_key === c.key);
        return <Card key={c.key} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums dark:bg-white/10">{i + 1}</span>
            <div className="min-w-0 flex-1"><div className="break-words font-semibold">{c.key}</div><p className="text-sm text-slate-500">{c.summary}</p></div>
            <span className="text-xs text-slate-500">難度 {c.difficulty} · {c.minutes} 分</span>
          </div>
          {c.prerequisites.length > 0 && <p className="text-xs text-slate-500">先備：{c.prerequisites.join("、")}</p>}
          <div className="flex flex-wrap gap-1.5">{c.new_concepts.map((n) => <Badge key={n.name}>{KIND[n.kind]}・{n.name}</Badge>)}</div>
          <ul className="space-y-1.5 text-sm">{c.objectives.map((o) => <li key={o.id} className="flex flex-wrap gap-x-2"><span className="font-mono text-xs text-slate-400">{o.syllabus_ref}</span><b className="text-xs uppercase tracking-wide">{o.command_term}</b><span className="min-w-0 flex-1 break-words">{o.text}</span></li>)}</ul>
          {(c.misconceptions.length > 0 || c.exam_traps.length > 0) && <p className="text-xs text-slate-500">{c.misconceptions.length > 0 && <>常見迷思：{c.misconceptions.join("、")}　</>}{c.exam_traps.length > 0 && <>考試陷阱：{c.exam_traps.join("、")}</>}</p>}
          {check && <p className="flex items-start gap-1.5 text-xs text-slate-500">{check.matches_sources && check.order_ok && check.level_ok ? <CheckCircle size={14} className="mt-px shrink-0 text-emerald-600" /> : <XCircle size={14} className="mt-px shrink-0 text-rose-600" />}AI 自我審查：{check.note}</p>}
        </Card>;
      })}
    </section>

    <section aria-label="AI 自我審查" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-500">AI 自我審查：逐項對照課本、大綱{review.user_outline ? "與你的課綱" : ""}</h3>
      {review.user_outline && <Card className="p-4 text-sm"><div className="mb-1 text-xs text-slate-500">你要求的課綱</div><p className="whitespace-pre-wrap break-words">{review.user_outline}</p></Card>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-white/5"><tr><th className="px-3 py-2">要求</th><th className="px-3 py-2">出處</th><th className="px-3 py-2">涵蓋章節</th><th className="px-3 py-2">依據</th></tr></thead>
          <tbody>{review.requirements.map((r, i) => <tr key={i} className="border-t border-slate-100 align-top dark:border-white/5">
            <td className="px-3 py-2 break-words">{r.requirement}</td><td className="px-3 py-2 text-xs whitespace-nowrap text-slate-500">{SOURCE[r.from] ?? r.from}</td>
            <td className="px-3 py-2 text-xs">{r.chapter_keys.length ? r.chapter_keys.join("、") : <span className="inline-flex items-center gap-1 text-rose-600"><Warning size={12} />未涵蓋</span>}</td><td className="px-3 py-2 text-xs text-slate-500 break-words">{r.evidence}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">對照的文件：{review.references.map((r) => `${SOURCE[r.kind] ?? r.kind}《${r.title}》${r.where}`).join("；")}</p>
    </section>

    <section aria-label="來源與評量" className="grid gap-3 md:grid-cols-2">
      <Card className="space-y-2 p-4 text-sm"><h3 className="text-xs font-semibold text-slate-500">引用的文件</h3><ul className="space-y-1">{bp.sources.map((s, i) => <li key={i} className="break-words"><b>{SOURCE[s.kind] ?? s.kind}</b>《{s.title}》{s.pages && <span className="text-slate-500"> p.{s.pages}</span>}<div className="text-xs text-slate-500">{s.used_for}</div></li>)}</ul>{bp.source_exemptions.length > 0 && <p className="text-xs text-slate-500">未使用：{bp.source_exemptions.map((e) => `${SOURCE[e.kind] ?? e.kind}（${e.reason}）`).join("；")}</p>}</Card>
      <Card className="space-y-2 p-4 text-sm"><h3 className="text-xs font-semibold text-slate-500">評量計畫</h3><p><b>先測：</b>{bp.assessment.pretest_plan}</p><p><b>檢核：</b>{bp.assessment.checkpoint_plan}</p><p><b>對應考試：</b>{bp.assessment.exam_alignment}</p></Card>
    </section>

    {reviewable ? <section aria-label="審核" className="sticky bottom-3 z-10">
      <Card className="space-y-3 p-4 shadow-[var(--shadow-soft)]">
        {asking ? <>
          <label className="block text-sm font-medium">要 AI 修改什麼？<textarea autoFocus rows={4} maxLength={4000} className={textareaCls + " mt-2"} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="例如：第 3 章拆成兩章；加入課本 5.2 節的例題；照我們老師的順序先教頻率再教週期" /></label>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy || !feedback.trim()} onClick={() => void decide("changes")}><PencilSimpleLine size={16} />送出修改要求</Button><Button disabled={busy} onClick={() => setAsking(false)}>取消</Button></div>
        </> : <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-slate-500">核准後，chatbot 才會依這份藍圖開始生成互動課程。</span>
          <Button disabled={busy} onClick={() => setAsking(true)}><PencilSimpleLine size={16} />要求修改</Button>
          <Button variant="primary" disabled={busy} onClick={() => void decide("approve")}><CheckCircle size={16} />核准，開始生成</Button>
        </div>}
      </Card>
    </section> : <p className="flex items-center gap-2 text-sm text-slate-500">{d.status === "approved" ? <><ClockCountdown size={16} />已核准，等待 chatbot 開始生成。</> : d.status === "started" ? <><ArrowRight size={16} />已開始生成，完成後會出現在<Link className="underline" to={`/notes/${encodeURIComponent(d.note_slug)}?view=course`}>課程頁</Link>。</> : "這一版已被新版取代。"}</p>}
  </article>;
}
