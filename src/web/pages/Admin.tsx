import { useState } from "react";
import { motion } from "motion/react";
import { ArrowCounterClockwise, Books as BooksIcon, CalendarCheck, Cards, ChartPieSlice, Exam, GitDiff, NotePencil, Plus, Scroll, SealCheck, Shapes, Trash, Users } from "@phosphor-icons/react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { practiceScaleSchema, type PracticeScale } from "../../shared/practice";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { fmtBytes, fmtDate, fmtRelative } from "../lib/format";
import { Badge, Button, Card, CountUp, Empty, fieldCls, inputCls, Loading, PageHeader, Tabs, textareaCls, toast, useSubjects } from "../components/ui";
import { Page } from "../layouts/Shell";
import { IbResourceLibrary } from "../features/ib-resources/Library";
import { LiveAi } from "../features/admin/LiveAi";
import { AccessGroups } from "../features/admin/AccessGroups";

type Tab = "ib-resources" | "live-ai" | "overview" | "members" | "access" | "review" | "assessments" | "subjects" | "trash" | "audit";

export default function Admin() {
  const user = useUser();
  const { tab = "overview" } = useParams();
  const navigate = useNavigate();
  if (user.role !== "admin") return <Navigate to="/" replace />;
  return (
    <Page wide>
      <PageHeader eyebrow="Admin" title="管理後台" />
      <Tabs<Tab>
        className="mb-4"
        value={tab as Tab}
        onChange={(t) => navigate(`/admin/${t}`)}
        items={[
          { value: "overview", label: <><ChartPieSlice size={15} /> 總覽</> },
          { value: "members", label: <><Users size={15} /> 授權名單</> },
          { value: "live-ai", label: <><Shapes size={15} /> 課堂 AI</> },
          { value: "access", label: <><Users size={15} /> 群組與存取權限</> },
          { value: "review", label: <><GitDiff size={15} /> 待審修訂</> },
          { value: "assessments", label: <><CalendarCheck size={15} /> 考試範圍</> },
          { value: "ib-resources", label: <><BooksIcon size={15} /> IB 參考資料</> },
          { value: "subjects", label: <><Shapes size={15} /> 科目</> },
          { value: "trash", label: <><Trash size={15} /> 垃圾桶</> },
          { value: "audit", label: <><Scroll size={15} /> 稽核紀錄</> },
        ]}
      />
      {tab === "overview" && <Overview />}
      {tab === "members" && <Members />}
      {tab === "access" && <AccessGroups />}
      {tab === "live-ai" && <LiveAi />}
      {tab === "review" && <PendingReview />}
      {tab === "assessments" && <Assessments />}
      {tab === "subjects" && <Subjects />}
      {tab === "ib-resources" && <IbResourceLibrary />}
      {tab === "trash" && <TrashBin />}
      {tab === "audit" && <Audit />}
    </Page>
  );
}

interface Usage {
  storage: { used: number; limit: number; freeTier: number };
  counts: Record<string, number>;
  checks: { name: string; ok: number; detail: string; checked_at: number }[];
  plan: { note: string };
}

function Overview() {
  const { data, refetch } = useQuery({ queryKey: ["admin-usage"], queryFn: () => api.get<Usage>("/api/admin/usage") });
  const [checking, setChecking] = useState(false);
  if (!data) return <Loading />;
  const pct = (data.storage.used / data.storage.limit) * 100;
  const labels: Record<string, string> = { users: "使用者", books: "電子書", notes: "重點整理", exams: "模擬試題", decks: "字卡組", cards: "卡片", reviews_30d: "30 天複習次數", attempts_30d: "30 天作答次數", pending_answers: "待審答案", docs_with_revisions: "有修訂的文件" };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h2 className="mb-2 font-semibold">R2 儲存空間</h2>
        <div className="mb-1 text-2xl font-bold">
          {fmtBytes(data.storage.used)} <span className="text-sm font-normal text-slate-500">/ 上限 {fmtBytes(data.storage.limit)}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <motion.div className={clsx("h-full", pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-aurora")} initial={{ width: 0 }} animate={{ width: `${Math.min(100, pct)}%` }} transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">上限設為 {fmtBytes(data.storage.limit)}（R2 每月免費 {fmtBytes(data.storage.freeTier)}），超過即拒絕上傳，避免 pay-as-you-go 費用。</p>
      </Card>
      <Card className="p-5">
        <h2 className="mb-2 font-semibold">系統檢查</h2>
        {data.checks.length === 0 && <div className="text-sm text-slate-500">尚未執行（每日自動檢查一次）</div>}
        {data.checks.map((c) => (
          <div key={c.name} className="mb-2 text-sm">
            <Badge color={c.ok ? "green" : "red"}>{c.ok ? "正常" : "異常"}</Badge> <b>{c.name === "notebooklm" ? "NotebookLM 字卡解析" : c.name}</b>
            <div className="mt-0.5 text-xs text-slate-500">
              {c.detail} · {fmtRelative(c.checked_at)}
            </div>
          </div>
        ))}
        <Button
          size="sm"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            await api.post("/api/admin/checks/notebooklm").catch(() => undefined);
            await refetch();
            setChecking(false);
          }}
        >
          {checking ? "檢查中…" : "立即檢查"}
        </Button>
      </Card>
      <Card className="p-5 md:col-span-2">
        <h2 className="mb-3 font-semibold">內容統計</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(data.counts).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-slate-900/[.03] p-4 dark:bg-white/5">
              <div className="font-display text-2xl font-semibold"><CountUp value={v} /></div>
              <div className="text-xs text-slate-500">{labels[k] ?? k}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">{data.plan.note}</p>
      </Card>
    </div>
  );
}

interface Member {
  email: string;
  role: "admin" | "member";
  note: string | null;
  created_at: number;
  name: string | null;
  last_login_at: number | null;
}

function Members() {
  const { data, refetch } = useQuery({ queryKey: ["allowlist"], queryFn: () => api.get<{ allowlist: Member[] }>("/api/admin/allowlist") });
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const user = useUser();
  const add = async () => {
    try {
      const r = await api.post<{ added: number }>("/api/admin/allowlist", { emails, role });
      toast(`已加入 ${r.added} 位`);
      setEmails("");
      void refetch();
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="h-fit p-4">
        <h2 className="mb-2 font-semibold">加入授權名單</h2>
        <p className="mb-2 text-xs text-slate-500">名單內的 Google 帳號可登入、觀看並共同編輯所有內容。可一次貼上多個 email（以換行或逗號分隔）。</p>
        <textarea className={textareaCls + " h-28 font-sans"} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="student1@example.com&#10;student2@example.com" />
        <div className="mt-2 flex gap-2">
          <select className={fieldCls + " w-32"} value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
            <option value="member">成員</option>
            <option value="admin">管理員</option>
          </select>
          <Button variant="primary" className="flex-1" onClick={add} disabled={!emails.trim()}>
            加入
          </Button>
        </div>
      </Card>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {data?.allowlist.map((m) => (
          <div key={m.email} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.name ?? m.email}</div>
              <div className="truncate text-xs text-slate-500">
                {m.email} · {m.last_login_at ? `最後登入 ${fmtRelative(m.last_login_at)}` : "尚未登入"}
              </div>
            </div>
            <Badge color={m.role === "admin" ? "brand" : "slate"}>{m.role === "admin" ? "管理員" : "成員"}</Badge>
            {m.email !== user.email && (
              <>
                <Button size="sm" variant="ghost" onClick={async () => (await api.post("/api/admin/allowlist", { emails: [m.email], role: m.role === "admin" ? "member" : "admin" }), refetch())}>
                  {m.role === "admin" ? "降為成員" : "設為管理員"}
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => confirm(`移除 ${m.email}？該帳號會立即被登出。`) && (await api.del(`/api/admin/allowlist/${encodeURIComponent(m.email)}`), refetch())}>
                  移除
                </Button>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

function PendingReview() {
  const { data } = useQuery({
    queryKey: ["admin-pending"],
    queryFn: () =>
      api.get<{
        documents: { id: string; slug: string; kind: string; title: string; updated_at: number; revisions: number }[];
        decks: { id: string; title: string; changed: number }[];
        answers: { id: string; slug: string; title: string; created_at: number; message: string | null; author_name: string }[];
      }>("/api/admin/revisions/pending"),
  });
  if (!data) return <Loading />;
  const empty = !data.documents.length && !data.decks.length && !data.answers.length;
  return (
    <div className="space-y-4">
      {empty && <Empty icon={<SealCheck size={36} />} title="沒有待審內容" />}
      {data.answers.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">待核准的試題答案</h2>
          {data.answers.map((a) => (
            <Link key={a.id} to={`/exams/${a.slug}/edit`} className="block rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <Exam size={16} className="mr-1.5 inline text-amber-500" />{a.title} <span className="text-xs text-slate-500">· {a.author_name} · {fmtDate(a.created_at)} {a.message && `· ${a.message}`}</span>
            </Link>
          ))}
        </Card>
      )}
      {data.documents.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">有修訂的文件（螢光標示中）</h2>
          {data.documents.map((d) => (
            <Link key={d.id} to={`/${d.kind === "note" ? "notes" : "exams"}/${d.slug}${d.kind === "exam" ? "/history" : ""}`} className="block rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              {d.kind === "note" ? <NotePencil size={16} className="mr-1.5 inline text-emerald-500" /> : <Exam size={16} className="mr-1.5 inline text-amber-500" />}{d.title} <span className="text-xs text-slate-500">· {d.revisions} 次修訂 · {fmtRelative(d.updated_at)}</span>
            </Link>
          ))}
        </Card>
      )}
      {data.decks.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">有修訂的字卡組</h2>
          {data.decks.map((d) => (
            <Link key={d.id} to={`/decks/${d.id}`} className="block rounded-lg px-2 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <Cards size={16} className="mr-1.5 inline text-ink-900 dark:text-white" />{d.title} <span className="text-xs text-slate-500">· {d.changed} 張</span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

interface Assessment {
  id: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  scope: { subject_id: string; has_exam: number; coverage_md: string | null; exam_date: string | null }[];
}

function Assessments() {
  const { data, refetch } = useQuery({ queryKey: ["assessments"], queryFn: () => api.get<{ assessments: Assessment[] }>("/api/assessments") });
  const subjects = useSubjects();
  const [edit, setEdit] = useState<Assessment | null>(null);
  if (!data || !subjects.data) return <Loading />;
  const blank: Assessment = { id: "", title: "", start_date: "", end_date: "", scope: [] };
  const save = async () => {
    if (!edit) return;
    try {
      await api.post("/api/assessments", { ...edit, id: edit.id || undefined, scope: edit.scope.map((s) => ({ ...s, has_exam: !!s.has_exam })) });
      toast("已儲存");
      setEdit(null);
      void refetch();
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };
  const scopeFor = (sid: string) => edit?.scope.find((s) => s.subject_id === sid);
  const setScope = (sid: string, patch: Partial<Assessment["scope"][number]> | null) =>
    setEdit((e) => {
      if (!e) return e;
      const rest = e.scope.filter((s) => s.subject_id !== sid);
      if (patch === null) return { ...e, scope: rest };
      const cur = e.scope.find((s) => s.subject_id === sid) ?? { subject_id: sid, has_exam: 1, coverage_md: "", exam_date: null };
      return { ...e, scope: [...rest, { ...cur, ...patch }] };
    });

  if (edit)
    return (
      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={inputCls} placeholder="名稱（例：期中評量）" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <input className={inputCls} type="date" value={edit.start_date ?? ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} />
          <input className={inputCls} type="date" value={edit.end_date ?? ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} />
        </div>
        {subjects.data.map((s) => {
          const sc = scopeFor(s.id);
          return (
            <div key={s.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={!!sc} onChange={(e) => setScope(s.id, e.target.checked ? {} : null)} />
                {s.name}
              </label>
              {sc && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={!!sc.has_exam} onChange={(e) => setScope(s.id, { has_exam: e.target.checked ? 1 : 0 })} /> 有紙筆考試
                    </label>
                    <input className={fieldCls + " w-44"} type="date" value={sc.exam_date ?? ""} onChange={(e) => setScope(s.id, { exam_date: e.target.value || null })} />
                  </div>
                  <textarea className={textareaCls + " h-24"} placeholder="範圍（Markdown，可用 [課本 P58](book:書籍ID#58) 連結）" value={sc.coverage_md ?? ""} onChange={(e) => setScope(s.id, { coverage_md: e.target.value })} />
                </div>
              )}
            </div>
          );
        })}
        <div className="flex gap-2">
          <Button variant="primary" onClick={save} disabled={!edit.title.trim()}>
            儲存
          </Button>
          <Button onClick={() => setEdit(null)}>取消</Button>
        </div>
      </Card>
    );

  return (
    <div className="space-y-3">
      <Button variant="primary" onClick={() => setEdit(blank)}>
        <Plus size={18} weight="bold" /> 新增考試
      </Button>
      {data.assessments.map((a) => (
        <Card key={a.id} className="flex items-center gap-3 p-4">
          <div className="flex-1">
            <div className="font-semibold">{a.title}</div>
            <div className="text-xs text-slate-500">
              {a.start_date} ～ {a.end_date} · {a.scope.length} 科
            </div>
          </div>
          <Button size="sm" onClick={() => setEdit(a)}>
            編輯
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => confirm("刪除此考試？") && (await api.del(`/api/assessments/${a.id}`), refetch())}>
            刪除
          </Button>
        </Card>
      ))}
    </div>
  );
}

function Subjects() {
  const subjects = useSubjects();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0d9488");
  const [scale, setScale] = useState<PracticeScale>("general");
  const [updating, setUpdating] = useState<string | null>(null);
  if (!subjects.data) return <Loading />;
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${fieldCls} min-w-40 flex-1`} placeholder="科目名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="color" className="h-10 w-12 rounded" value={color} onChange={(e) => setColor(e.target.value)} />
        <select className={fieldCls} aria-label="新科目的複習分級" value={scale} onChange={e => setScale(practiceScaleSchema.parse(e.target.value))}>
          <option value="general">一般難度</option>
          <option value="ib">IB 目標分數</option>
        </select>
        <Button variant="primary" disabled={!name.trim()} onClick={async () => (await api.post("/api/subjects", { name, color, practice_scale: scale }), setName(""), subjects.refetch())}>
          新增
        </Button>
      </div>
      {subjects.data.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 border-t border-slate-100 py-2 text-sm dark:border-slate-800">
          <span className="h-3 w-3 rounded-full" style={{ background: s.color ?? "#64748b" }} />
          <span className="flex-1">{s.name}</span>
          <code className="text-xs text-slate-400">{s.id}</code>
          <select className={fieldCls} aria-label={`${s.name}的複習分級`} value={s.practice_scale} disabled={updating !== null} onChange={async e => {
            const practice_scale = practiceScaleSchema.parse(e.target.value);
            setUpdating(s.id);
            try {
              await api.put(`/api/subjects/${s.id}`, { practice_scale });
              await subjects.refetch();
            } catch (cause) {
              toast(errorMessage(cause), "err");
            } finally {
              setUpdating(null);
            }
          }}>
            <option value="general">一般難度</option>
            <option value="ib">IB 目標分數</option>
          </select>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={async () => confirm(`刪除科目「${s.name}」？`) && (await api.del(`/api/subjects/${s.id}`), subjects.refetch())}>
            刪除
          </Button>
        </div>
      ))}
    </Card>
  );
}

function Audit() {
  const { data } = useQuery({ queryKey: ["audit"], queryFn: () => api.get<{ entries: { id: string; actor_name: string; actor_email: string; action: string; entity: string; entity_id: string; meta_json: string; created_at: number }[] }>("/api/admin/audit") });
  if (!data) return <Loading />;
  return (
    <Card className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
      {data.entries.map((e) => (
        <div key={e.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2">
          <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDate(e.created_at)}</span>
          <span className="font-medium">{e.actor_name ?? e.actor_email ?? "系統"}</span>
          <code className="text-xs">{e.action}</code>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{e.meta_json}</span>
        </div>
      ))}
    </Card>
  );
}

function TrashBin() {
  const { data, refetch } = useQuery({
    queryKey: ["admin-trash"],
    queryFn: () => api.get<{ documents: { id: string; slug: string; kind: "note" | "exam"; title: string; deleted_at: number; deleted_by_name: string | null; deleted_by_email: string | null; attempts: number }[] }>("/api/admin/trash"),
  });
  if (!data) return <Loading />;
  if (!data.documents.length) return <Empty icon={<Trash size={36} />} title="垃圾桶是空的" />;
  const restore = async (slug: string) => {
    await api.post(`/api/documents/${encodeURIComponent(slug)}/restore`);
    toast("已復原");
    void refetch();
  };
  const purge = async (slug: string, title: string, attempts: number) => {
    if (!confirm(`永久刪除「${title}」？\n所有修訂歷史${attempts ? `與 ${attempts} 筆作答紀錄` : ""}都會一併刪除，無法復原。`)) return;
    await api.del(`/api/documents/${encodeURIComponent(slug)}?permanent=1`);
    toast("已永久刪除");
    void refetch();
  };
  return (
    <Card className="divide-y divide-slate-100 dark:divide-white/5">
      {data.documents.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          {d.kind === "note" ? <NotePencil size={18} /> : <Exam size={18} />}
          <div className="min-w-0 flex-1">
            <Link to={`/${d.kind === "note" ? "notes" : "exams"}/${d.slug}`} className="font-medium hover:underline">
              {d.title}
            </Link>
            <div className="text-xs text-slate-500">
              {d.deleted_by_name ?? d.deleted_by_email ?? "—"} 於 {fmtDate(d.deleted_at)} 刪除{d.kind === "exam" && d.attempts ? `・${d.attempts} 筆作答紀錄` : ""}
            </div>
          </div>
          <Button size="sm" onClick={() => restore(d.slug)}>
            <ArrowCounterClockwise size={16} /> 復原
          </Button>
          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => purge(d.slug, d.title, d.attempts)}>
            <Trash size={16} /> 永久刪除
          </Button>
        </div>
      ))}
    </Card>
  );
}
