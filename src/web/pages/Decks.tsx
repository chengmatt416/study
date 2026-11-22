import { useState } from "react";
import { Brain, Cards, FileCsv, Folder, LinkSimple, Plus, Shuffle, Sparkle, TextAa } from "@phosphor-icons/react";
import { PromptBuilder } from "../features/ai/PromptBuilder";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { mergeSearchParams } from "../lib/search-params";
import { VisibilityPicker } from "../components/VisibilityPicker";
import type { Visibility } from "../../shared/visibility";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import type { DeckSummary } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading, PageHeader, Ring, Sheet, Stagger, StaggerItem, SubjectDot, SubjectSelect, Tabs, textareaCls, toast } from "../components/ui";
import { Page } from "../layouts/Shell";

export default function Decks() {
  const device = useDevice();
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const subject = params.get("subject") ?? "";
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["decks"], queryFn: () => api.get<{ decks: DeckSummary[] }>("/api/decks") });
  const decks = (data?.decks ?? []).filter((d) => !subject || d.subject_id === subject);
  const due = decks.reduce((s, d) => s + d.due, 0);

  return (
    <Page>
      <PageHeader
        title="字卡"
        subtitle={data ? `今日到期 ${due} 張 · FSRS 智慧排程` : "FSRS 智慧排程"}
        actions={
          <>
            <Link to="/content?kind=deck" className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-900/5 dark:text-slate-300"><Folder size={18} />整理內容</Link>
            <SubjectSelect value={subject} onChange={value => setParams(mergeSearchParams({ subject: value }))} allowAll />
            <Button variant="primary" onClick={() => setImporting(true)}>
              <Plus size={18} weight="bold" /> 匯入 / 新增
            </Button>
          </>
        }
      />
      {error && <div className="mb-4 space-y-2"><ErrorBox error={error} /><Button onClick={() => void refetch()}>重試字卡清單</Button></div>}
      {isLoading ? (
        <Loading />
      ) : !data ? null : decks.length === 0 ? (
        <Empty icon={<Cards size={36} />} title={subject ? "此科目還沒有字卡組" : "還沒有字卡組"}>{subject ? <Button onClick={() => setParams(mergeSearchParams({ subject: "" }))}>查看全部科目</Button> : "貼上 NotebookLM 字卡分享連結即可匯入"}</Empty>
      ) : (
        <Stagger className={clsx("grid gap-4", device === "phone" ? "grid-cols-1" : "grid-cols-2")}>
          {decks.map((d) => (
            <StaggerItem key={d.id}>
            <Card interactive className="group relative flex h-full flex-col justify-between overflow-hidden p-5">
              <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-zinc-400/10 blur-2xl transition duration-500 group-hover:scale-150" />
              <Link to={`/decks/${d.id}`} className="block flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 dark:text-white">{d.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <SubjectDot subjectId={d.subject_id} />
                      <span className="tabular-nums">{d.total} 張</span>
                      {d.source_type === "notebooklm" && <Badge color="blue"><LinkSimple size={11} weight="bold" /> NotebookLM</Badge>}
                      <span className="tabular-nums">新 {d.new_count}</span>{d.visibility === "private" && <Badge>私人</Badge>}
                      {d.changed > 0 && <Badge color="yellow">{d.changed} 張有修訂</Badge>}
                    </div>
                  </div>
                  <Ring value={d.total ? (d.total - d.new_count) / d.total : 0} size={58} stroke={5}>
                    <div className="text-center leading-none">
                      <div className={clsx("font-display text-lg font-semibold tabular-nums", d.due ? "text-brand-600 dark:text-brand-300" : "text-slate-400")}>{d.due}</div>
                      <div className="text-[9px] font-medium text-slate-500">到期</div>
                    </div>
                  </Ring>
                </div>
              </Link>
              <div className="mt-4 flex gap-2 pt-1">
                <Link to={`/decks/${d.id}/review`} className="flex-1">
                  <Button variant="primary" size="sm" className="w-full">
                    <Brain size={16} weight="fill" /> 智慧複習
                  </Button>
                </Link>
                <Link to={`/decks/${d.id}/shuffle`} className="flex-1">
                  <Button size="sm" className="w-full">
                    <Shuffle size={16} /> 隨機練習
                  </Button>
                </Link>
              </div>
            </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </Page>
  );
}

type Source = "url" | "text" | "csv" | "empty" | "ai";

interface Preview {
  title?: string;
  sourceType: string;
  cards: { front: string; back: string }[];
  plan: { add: unknown[]; update: unknown[]; remove: unknown[]; unchanged: number };
}

export function ImportSheet({ open, onClose, deckId }: { open: boolean; onClose: () => void; deckId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useUser();
  const [visibility, setVisibility] = useState<Visibility>(user.access?.features.shared_write === false ? "private" : "shared");
  const chosenVisibility = user.access?.features.shared_write === false ? "private" : visibility;
  const [src, setSrc] = useState<Source>("url");
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);

  const payload = () => (src === "url" ? { url: value.trim() } : src === "csv" ? { csv: value } : { text: value });

  const doPreview = async () => {
    setBusy(true);
    try {
      const r = await api.post<Preview>("/api/decks/import/preview", { ...payload(), deck_id: deckId });
      setPreview(r);
      if (!title && r.title) setTitle(r.title);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      if (src === "empty") {
        const r = await api.post<{ id: string }>("/api/decks", { title, visibility: chosenVisibility, subject_id: subject || undefined });
        navigate(`/decks/${r.id}`);
      } else {
        const r = await api.post<{ deckId: string; added: number; updated: number }>("/api/decks/import/commit", { ...payload(), ...(deckId ? {} : { visibility: chosenVisibility }), deck_id: deckId, title, subject_id: subject || undefined, remove_missing: removeMissing });
        toast(`已匯入：新增 ${r.added}、更新 ${r.updated}`);
        if (!deckId) navigate(`/decks/${r.deckId}`);
      }
      qc.invalidateQueries({ queryKey: ["decks"] });
      qc.invalidateQueries({ queryKey: ["deck"] });
      setPreview(null);
      setValue("");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={deckId ? "匯入卡片到此字卡組" : "匯入字卡"} wide>
      <div className="space-y-3 p-4">
        <Tabs<Source>
          value={src}
          onChange={(v) => (setSrc(v), setPreview(null))}
          items={[
            { value: "url", label: <><LinkSimple size={15} /> NotebookLM</> },
            { value: "text", label: <><TextAa size={15} /> 貼上文字</> },
            { value: "csv", label: <><FileCsv size={15} /> CSV</> },
            { value: "ai" as Source, label: <><Sparkle size={15} /> AI 生成</> },
            ...(!deckId ? [{ value: "empty" as Source, label: <><Plus size={15} /> 空白</> }] : []),
          ]}
        />
        {src === "ai" && <PromptBuilder kind="cards" deckId={deckId} onDone={onClose} />}
        {src === "url" && (
          <>
            <input className={inputCls} placeholder="https://notebooklm.link.google/xxxx" value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="text-xs text-slate-500">需為「公開分享」的 NotebookLM（Gemini Notebook）字卡連結。此功能使用非官方介面，若 Google 改版暫時失效，可改用「貼上文字」。</p>
          </>
        )}
        {src === "text" && (
          <>
            <textarea className={textareaCls + " h-48"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={"每行一張：正面<Tab>背面 或 正面 :: 背面\n\n多行卡片：\n正面內容\n===\n背面內容\n---\n下一張…"} />
          </>
        )}
        {src === "csv" && <textarea className={textareaCls + " h-48"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={'front,back\n"apple","蘋果"'} />}
        {!deckId && src !== "ai" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} placeholder="字卡組名稱" value={title} onChange={(e) => setTitle(e.target.value)} />
            <SubjectSelect value={subject} onChange={setSubject} />
          </div>
        )}
        {!deckId && src !== "ai" && <VisibilityPicker value={visibility} onChange={setVisibility} />}
        {preview && (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-2 flex flex-wrap gap-2 text-sm">
              <Badge color="green">新增 {preview.plan.add.length}</Badge>
              {deckId && <Badge color="yellow">更新 {preview.plan.update.length}</Badge>}
              {deckId && <Badge>不變 {preview.plan.unchanged}</Badge>}
              {deckId && preview.plan.remove.length > 0 && <Badge color="red">來源已無 {preview.plan.remove.length}</Badge>}
            </div>
            <div className="max-h-56 space-y-1 overflow-auto text-sm">
              {preview.cards.slice(0, 50).map((c, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 border-b border-slate-100 py-1 dark:border-slate-800">
                  <span className="line-clamp-2">{c.front}</span>
                  <span className="line-clamp-2 text-slate-500">{c.back}</span>
                </div>
              ))}
              {preview.cards.length > 50 && <div className="text-xs text-slate-500">…共 {preview.cards.length} 張</div>}
            </div>
            {deckId && preview.plan.remove.length > 0 && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} /> 同時刪除來源中已不存在的卡片（學習紀錄保留，可還原）
              </label>
            )}
          </div>
        )}
        {src !== "ai" && <div className="flex gap-2">
          {src !== "empty" && (
            <Button disabled={!value.trim() || busy} onClick={doPreview}>
              {busy && !preview ? "解析中…" : "預覽"}
            </Button>
          )}
          <Button variant="primary" className="flex-1" disabled={busy || (src === "empty" ? !title.trim() : !preview)} onClick={commit}>
            {src === "empty" ? "建立" : "確認匯入"}
          </Button>
        </div>}
      </div>
    </Sheet>
  );
}
