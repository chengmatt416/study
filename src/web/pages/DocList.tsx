import { useState } from "react";
import { Exam, FileArrowUp, Folder, NotePencil, PencilSimple, Plus, Sparkle } from "@phosphor-icons/react";
import { PromptBuilder } from "../features/ai/PromptBuilder";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { useDevice } from "../lib/device";
import { useUser } from "../lib/auth";
import { fmtRelative } from "../lib/format";
import { mergeSearchParams } from "../lib/search-params";
import type { DocSummary } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading, PageHeader, Sheet, Stagger, StaggerItem, SubjectDot, SubjectSelect, Tabs, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { docxToMarkdown } from "../features/editor/importDocx";
import { EXAM_TEMPLATE } from "../features/exam/template";
import { VisibilityPicker } from "../components/VisibilityPicker";
import type { Visibility } from "../../shared/visibility";
import { CourseSetup } from "../features/openmaic/CourseSetup";

export default function DocList() {
  const user = useUser();
  const loc = useLocation();
  const kind = loc.pathname.startsWith("/exams") ? "exam" : "note";
  const base = kind === "exam" ? "/exams" : "/notes";
  const device = useDevice();
  const [params, setParams] = useSearchParams();
  const subject = params.get("subject_id") ?? "";
  const setSubject = (value: string) => setParams(mergeSearchParams({ subject_id: value }));
  const [creating, setCreating] = useState(false);
  const [courseSetup, setCourseSetup] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["documents", kind], queryFn: () => api.get<{ documents: DocSummary[] }>(`/api/documents?kind=${kind}`) });
  const docs = (data?.documents ?? []).filter((d) => !subject || d.subject_id === subject);
  const canCreate = user.access?.defaults[kind === "note" ? "notes" : "exams"] !== false;

  return (
    <Page>
      <PageHeader
        title={kind === "exam" ? "模擬試題" : "重點整理"}
        subtitle={kind === "exam" ? "作答後自動批改；可重做錯題" : "Markdown + LaTeX；共享內容可協作；私人內容僅自己可見"}
        actions={
          <>
            <Link to={`/content?kind=${kind}`} className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-900/5 dark:text-slate-300"><Folder size={18} />整理內容</Link>
            <label><span className="sr-only">篩選科目</span><SubjectSelect value={subject} onChange={setSubject} allowAll /></label>
            {kind === "note" && canCreate && user.access?.features.ai !== false && <Button onClick={() => setCourseSetup(true)}><Sparkle size={18} /> OpenMAIC 課程</Button>}
            {canCreate && <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={18} weight="bold" /> 新增
            </Button>}
          </>
        }
      />
      {error && <Card className="mb-4 space-y-3 p-4"><ErrorBox error={error} /><Button disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "重試中…" : "重新載入內容"}</Button></Card>}
      {isLoading ? (
        <Loading />
      ) : !data ? null : (
      docs.length === 0 ? (
        <Empty icon={kind === "exam" ? <Exam size={36} /> : <NotePencil size={36} />} title={subject ? "這個科目還沒有內容" : "還沒有內容"}>{subject && <Button onClick={() => setSubject("")}>查看全部科目</Button>}</Empty>
      ) : (
        <Stagger className={clsx("grid gap-3", device === "phone" ? "grid-cols-1" : "grid-cols-2")}>
          {docs.map((d) => (
            <StaggerItem key={d.id}>
            <Link to={`${base}/${d.slug}`}>
              <Card interactive className="h-full p-5">
                <div className="flex items-start gap-3">
                  <span className={clsx("grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-lg", kind === "exam" ? "bg-ink-900 dark:bg-white dark:text-ink-900" : "bg-ink-900 dark:bg-white dark:text-ink-900")}>
                    {kind === "exam" ? <Exam size={22} weight="fill" /> : <NotePencil size={22} weight="fill" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold [overflow-wrap:anywhere]">{d.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <SubjectDot subjectId={d.subject_id} />
                      <span className="text-xs text-slate-500">更新於 {fmtRelative(d.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {kind === "note" && !!d.has_course && <Badge color="green">互動課程</Badge>}
                    {d.has_revisions ? <Badge color="yellow">有修訂</Badge> : null}
                    {d.visibility === "private" && <Badge>私人</Badge>}
                    {d.status === "draft" && <Badge>草稿</Badge>}
                    {d.pending_answers > 0 && <Badge color="red">答案待審</Badge>}
                    {kind === "exam" && d.best_pct !== null && <Badge color="green">最佳 {Math.round(d.best_pct)}%</Badge>}
                  </div>
                </div>
              </Card>
            </Link>
            </StaggerItem>
          ))}
        </Stagger>
      ))}
      <CreateDoc kind={kind} open={creating} onClose={() => setCreating(false)} />
      {kind === "note" && <Sheet open={courseSetup} onClose={() => setCourseSetup(false)} title="OpenMAIC 互動課程" wide><div className="p-4 md:p-6"><CourseSetup /></div></Sheet>}
    </Page>
  );
}

function CreateDoc({ kind, open, onClose }: { kind: "note" | "exam"; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const user = useUser();
  const [visibility, setVisibility] = useState<Visibility>(user.access?.features.shared_write === false ? "private" : "shared");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState<string | null>(null);
  const [strip, setStrip] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"manual" | "ai">("manual");

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const md = f.name.endsWith(".docx") ? await docxToMarkdown(f, { stripCitations: strip }) : await f.text();
      setBody(md);
      if (!title) setTitle(f.name.replace(/\.(docx|md|markdown|txt)$/i, ""));
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ slug: string }>("/api/documents", { visibility: user.access?.features.shared_write === false ? "private" : visibility, kind, title, subject_id: subject || undefined, body_md: body ?? (kind === "exam" ? EXAM_TEMPLATE(title) : `# ${title}\n\n`) });
      onClose();
      navigate(`/${kind === "exam" ? "exams" : "notes"}/${r.slug}/edit`);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={kind === "exam" ? "新增模擬試題" : "新增重點整理"} wide={mode === "ai"}>
      <div className="px-4 pt-1">
        <Tabs<"manual" | "ai">
          value={mode}
          onChange={setMode}
          items={[
            { value: "manual", label: <><PencilSimple size={15} /> 手動 / 匯入檔案</> },
            { value: "ai", label: <><Sparkle size={15} /> AI 生成</> },
          ]}
        />
      </div>
      {mode === "ai" ? (
        <div className="p-4 md:p-6">
          <PromptBuilder kind={kind} onDone={onClose} />
        </div>
      ) : (
      <div className="space-y-3 p-4">
        <input className={inputCls} placeholder="標題" value={title} onChange={(e) => setTitle(e.target.value)} />
        <SubjectSelect value={subject} onChange={setSubject} />
        <VisibilityPicker value={visibility} onChange={setVisibility} />
        <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 p-4 text-sm dark:border-brand-700 dark:bg-brand-900/20">
          <div className="mb-2 flex items-center gap-2 font-medium"><FileArrowUp size={18} className="text-brand-600" /> 從檔案匯入（選填）</div>
          <input type="file" accept=".docx,.md,.markdown,.txt" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm" />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} /> 移除 NotebookLM 引用標記（如 [1, 2]）
          </label>
          {body && <div className="mt-2 text-xs text-green-700">已讀取 {body.length.toLocaleString()} 字元，建立後可在編輯器中調整（數學式建議改為 LaTeX）。</div>}
        </div>
        <Button variant="primary" className="w-full" disabled={!title.trim() || busy} onClick={create}>
          {busy ? "處理中…" : "建立並開始編輯"}
        </Button>
      </div>
      )}
    </Sheet>
  );
}
