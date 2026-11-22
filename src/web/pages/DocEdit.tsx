import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookletPicker } from "../features/exam/BookletPicker";
import { motion } from "motion/react";
import { ArrowLeft, FloppyDisk } from "@phosphor-icons/react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import type { EditorView } from "@codemirror/view";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { canEditContent } from "../lib/permissions";
import { useDevice } from "../lib/device";
import { fmtDate } from "../lib/format";
import type { DocDetail } from "../lib/types";
import { Badge, Button, ErrorBox, IconButton, Loading, SubjectSelect, Tabs, spring, textareaCls, toast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { MdEditor, SnippetBar, useImageUpload, type Peer } from "../features/editor/MdEditor";
import { ExamBody, type Responses } from "../features/exam/ExamBody";
import { analyzeExamMarkdown, answersTemplate, crossCheck, stripSolutions, toPublic, validateAnswers, type AnswersFile } from "../../shared/exam";

type Pane = "edit" | "preview" | "answers";

export default function DocEdit() {
  const { slug } = useParams();
  const user = useUser();
  const device = useDevice();
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["doc-edit", slug], queryFn: () => api.get<DocDetail>(`/api/documents/${slug}?view=edit`), staleTime: Infinity });
  const [text, setText] = useState("");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [pane, setPane] = useState<Pane>("edit");
  const [preview, setPreview] = useState("");
  const viewRef = useRef<EditorView | null>(null);
  const getView = useCallback(() => viewRef.current, []);
  const image = useImageUpload(getView);
  const isExam = data?.document.kind === "exam";
  const split = device === "desktop" || (device === "tablet" && window.innerWidth >= 1000);

  // 預覽 debounce，避免長文件每個按鍵都重新渲染
  useEffect(() => {
    const t = setTimeout(() => setPreview(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!canEditContent(user, data.document)) return <ErrorBox error={new Error("你的群組已停用共享內容寫入；可閱讀此內容或建立自己的私人內容。 ")} />;
  const d = data.document;
  const base = isExam ? "/exams" : "/notes";

  const saveVersion = async () => {
    const message = prompt("版本說明（選填）", "");
    if (message === null) return;
    try {
      await api.post(`/api/documents/${slug}/revisions`, { body_md: text, message, force: true });
      toast("已儲存版本");
      qc.invalidateQueries({ queryKey: ["doc", slug] });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  const header = (
    <div className="glass flex shrink-0 flex-wrap items-center gap-2 border-x-0 border-t-0 px-3 py-2">
      <Link to={`${base}/${d.slug}`} aria-label="返回">
        <IconButton label="返回">
          <ArrowLeft size={20} />
        </IconButton>
      </Link>
      <input
        defaultValue={d.title}
        className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 font-semibold outline-none focus:bg-slate-100 dark:focus:bg-slate-800"
        onBlur={(e) => e.target.value.trim() && e.target.value !== d.title && api.put(`/api/documents/${slug}`, { title: e.target.value.trim() }).then(() => toast("標題已更新"))}
      />
      {device !== "phone" && <SubjectSelect value={d.subject_id ?? ""} onChange={(v) => api.put(`/api/documents/${slug}`, { subject_id: v || null }).then(() => toast("科目已更新"))} />}
      {isExam && <BookletPicker slug={d.slug} value={d.booklet_id} />}
      <div className="flex items-center -space-x-2" title={peers.map((p) => p.name).join("、")}>
        {peers.slice(0, 5).map((p) => (
          <motion.span key={p.clientId} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} className="grid h-7 w-7 place-items-center rounded-full border-2 border-white text-xs font-bold text-white dark:border-ink-900" style={{ background: p.color }}>
            {p.name[0]}
          </motion.span>
        ))}
      </div>
      <span className={clsx("h-2.5 w-2.5 rounded-full ring-4", status === "connected" ? "bg-emerald-500 ring-emerald-500/20" : status === "connecting" ? "animate-pulse bg-amber-400 ring-amber-400/20" : "bg-rose-500 ring-rose-500/20")} title={{ connected: "已連線（自動儲存）", connecting: "連線中", disconnected: "離線：恢復連線後會自動合併" }[status]} />
      <Button size="sm" variant="primary" onClick={saveVersion}>
        <FloppyDisk size={16} weight="fill" /> 儲存版本
      </Button>
    </div>
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <SnippetBar getView={getView} exam={isExam} onImage={image.pick} />
      <div className="min-h-0 flex-1">
        <MdEditor slug={d.slug} userName={user.name ?? user.email} onChange={setText} onPeers={setPeers} onStatus={setStatus} editorRef={viewRef} />
      </div>
    </div>
  );

  const previewEl = isExam ? <ExamPreview md={preview} /> : <div className="h-full overflow-auto p-4 md:p-6"><Markdown md={preview} /></div>;

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
        <Tabs<Pane>
          value={split && pane === "preview" ? "edit" : pane}
          onChange={setPane}
          items={[
            { value: "edit", label: split ? "編輯 + 預覽" : "編輯" },
            ...(!split ? [{ value: "preview" as Pane, label: "預覽" }] : []),
            ...(isExam ? [{ value: "answers" as Pane, label: "答案 JSON" }] : []),
          ]}
        />
        <span className="ml-auto hidden text-xs text-slate-500 sm:inline">多人同時編輯會即時同步，停止輸入 30 秒後自動存成新版本</span>
      </div>
      <div className="min-h-0 flex-1">
        {pane === "answers" && isExam ? (
          <AnswersPanel slug={d.slug} md={text} isAdmin={user.role === "admin" || d.visibility === "private"} />
        ) : split ? (
          <div className="grid h-full grid-cols-2">
            <div className="min-h-0 border-r border-slate-200 dark:border-slate-800">{editor}</div>
            <div className="min-h-0 bg-slate-50 dark:bg-slate-950">{previewEl}</div>
          </div>
        ) : (
          <>
            <div className={clsx("h-full", pane !== "edit" && "hidden")}>{editor}</div>
            {pane === "preview" && previewEl}
          </>
        )}
      </div>
    </div>
  );
}

function ExamPreview({ md }: { md: string }) {
  const [responses, setResponses] = useState<Responses>({});
  const [answers, setAnswers] = useState<AnswersFile | null>(null);
  const { slug } = useParams();
  useEffect(() => {
    api.get<{ answers: { answers_json: string; status: string }[] }>(`/api/exams/${slug}/answers`).then((r) => {
      const latest = r.answers[0];
      if (latest) setAnswers(JSON.parse(latest.answers_json));
    });
  }, [slug]);
  const questions = useMemo(() => {
    const s = analyzeExamMarkdown(md);
    const src = answers ?? answersTemplate(md);
    return src.questions.filter((q) => s.questionIds.includes(q.id)).map((q) => toPublic(q, "preview", s.choices));
  }, [md, answers]);
  const body = useMemo(() => stripSolutions(md), [md]);
  return (
    <div className="h-full overflow-auto p-4 md:p-6">
      <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">作答預覽（解析已隱藏，交卷後才顯示）</div>
      <ExamBody md={body} questions={questions} responses={responses} onChange={(id, v) => setResponses((r) => ({ ...r, [id]: v }))} mode="exam" />
    </div>
  );
}

interface AnswerRev {
  id: string;
  status: "pending" | "approved" | "rejected";
  message: string | null;
  created_at: number;
  answers_json: string;
  author_name: string | null;
  reviewer_name: string | null;
}

function AnswersPanel({ slug, md, isAdmin }: { slug: string; md: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["answers", slug], queryFn: () => api.get<{ answers: AnswerRev[]; activeId: string | null }>(`/api/exams/${slug}/answers`) });
  const [json, setJson] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const device = useDevice();

  useEffect(() => {
    if (json === null && data) setJson(data.answers[0] ? JSON.stringify(JSON.parse(data.answers[0].answers_json), null, 2) : "");
  }, [data, json]);

  const validate = (): AnswersFile | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json ?? "");
    } catch (e) {
      setErrors([`JSON 語法錯誤：${(e as Error).message}`]);
      return null;
    }
    const v = validateAnswers(parsed);
    if (!v.ok) return setErrors(v.errors), null;
    const cross = crossCheck(md, v.value);
    setErrors(cross);
    return cross.length ? null : v.value;
  };

  const submit = async () => {
    const v = validate();
    if (!v) return;
    const message = prompt("修改說明（選填）", "") ?? "";
    try {
      const r = await api.post<{ status: string }>(`/api/exams/${slug}/answers`, { answers: v, message });
      toast(r.status === "approved" ? "答案已生效" : "已送出，等待管理員核准後生效");
      void refetch();
      qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    try {
      await api.post(`/api/exams/${slug}/answers/${id}/${decision}`);
      toast(decision === "approve" ? "已核准" : "已退回");
      void refetch();
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  return (
    <div className={clsx("grid h-full min-h-0 gap-0", device === "phone" ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="flex min-h-0 flex-col p-3">
        <div className="mb-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setJson(JSON.stringify(answersTemplate(md), null, 2))}>
            從題目產生樣板
          </Button>
          <Button size="sm" onClick={() => validate() && setErrors([])}>
            驗證
          </Button>
          <Button size="sm" variant="primary" onClick={submit}>
            {isAdmin ? "儲存並生效" : "送出（需管理員核准）"}
          </Button>
          <a className="ml-auto self-center text-xs text-brand-700 underline" href="/docs/exam-answers-schema.json" target="_blank">
            JSON 規格
          </a>
        </div>
        {errors && (
          <div className={clsx("mb-2 rounded-lg p-2 text-xs whitespace-pre-wrap", errors.length ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300")}>
            {errors.length ? errors.map((e) => `• ${e}`).join("\n") : "格式正確，且與題目一致"}
          </div>
        )}
        <textarea className={textareaCls + " min-h-0 flex-1 resize-none"} value={json ?? ""} onChange={(e) => setJson(e.target.value)} spellCheck={false} />
      </div>
      <div className="min-h-0 overflow-auto border-slate-200 p-3 md:border-l dark:border-slate-800">
        <div className="mb-2 text-sm font-semibold">答案版本</div>
        {data?.answers.map((a) => (
          <div key={a.id} className="mb-2 rounded-xl border border-slate-200 p-2.5 text-sm dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Badge color={a.status === "approved" ? "green" : a.status === "pending" ? "yellow" : "red"}>{{ approved: "已生效", pending: "待審", rejected: "已退回" }[a.status]}</Badge>
              {a.id === data.activeId && <Badge color="brand">使用中</Badge>}
              <span className="ml-auto text-xs text-slate-500">{fmtDate(a.created_at)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {a.author_name}
              {a.message && `：${a.message}`}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setJson(JSON.stringify(JSON.parse(a.answers_json), null, 2))}>
                載入
              </Button>
              {isAdmin && a.status === "pending" && (
                <>
                  <Button size="sm" variant="primary" onClick={() => decide(a.id, "approve")}>
                    核准
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => decide(a.id, "reject")}>
                    退回
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
        {data?.answers.length === 0 && <div className="text-xs text-slate-500">尚未設定答案</div>}
      </div>
    </div>
  );
}
