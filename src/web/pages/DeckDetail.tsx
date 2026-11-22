import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, Brain, DownloadSimple, GearSix, GitDiff, PencilSimple, Plus, SealCheck, Shuffle, Target } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { mergeSearchParams } from "../lib/search-params";
import { canEditContent } from "../lib/permissions";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { fmtDate, fmtRelative } from "../lib/format";
import type { Card as CardT } from "../lib/types";
import { VisibilityButton } from "../components/VisibilityButton";
import { Badge, Button, Card, ErrorBox, fieldCls, IconButton, inputCls, Loading, PageHeader, Sheet, Tabs, textareaCls, toast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Page } from "../layouts/Shell";
import { ImportSheet } from "./Decks";
import type { ReviewSettings } from "../../shared/srs";
import "../features/decks/review.css";

interface DeckRes {
  deck: { visibility?: "shared" | "private"; created_by?: string | null; id: string; title: string; description: string | null; source_type: string; source_url: string | null; last_synced_at: number | null; subject_id: string | null };
  cards: CardT[];
  settings: ReviewSettings;
}

type Filter = "all" | "changed" | "due" | "new";

export default function DeckDetail() {
  const { id } = useParams();
  return <DeckWorkspace key={id} id={id!} />;
}

function DeckWorkspace({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const user = useUser();
  const device = useDevice();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: ["deck", id], queryFn: () => api.get<DeckRes>(`/api/decks/${id}`) });
  const rawFilter = params.get("filter");
  const filter: Filter = rawFilter === "due" || rawFilter === "new" || rawFilter === "changed" ? rawFilter : "all";
  const setFilter = (value: Filter) => setParams(mergeSearchParams({ filter: value }, { filter: "all" }));
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState<CardT | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const q = params.get("q") ?? "";
  const setQ = (value: string) => setParams(mergeSearchParams({ q: value }), { replace: true });
  const highlight = params.get("card");
  const focusedCard = useRef("");
  const [syncBusy, setSyncBusy] = useState(false);

  const cards = useMemo(() => {
    const now = Date.now();
    return (data?.cards ?? []).filter((c) => {
      if (q && !`${c.front}\n${c.back}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "changed") return c.baseline_front === null || c.baseline_front !== c.front || c.baseline_back !== c.back;
      if (filter === "due") return c.due !== null && c.due <= now;
      if (filter === "new") return c.state === null;
      return true;
    });
  }, [data, filter, q]);
  useEffect(() => {
    if (!highlight) { focusedCard.current = ""; return; }
    if (focusedCard.current === highlight) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`card-${highlight}`);
      if (element) { focusedCard.current = highlight; element.scrollIntoView({ block: "center" }); element.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [highlight, data, filter, q]);

  if (error && !data) return <Page><ErrorBox error={error} /><Button className="mt-3" onClick={() => void refetch()}>重試字卡組</Button><Link to="/decks" className="ml-4 underline">返回字卡</Link></Page>;
  if (!data) return <Loading />;
  const d = data.deck;
  const canEdit = canEditContent(user, d);
  const changedCount = data.cards.filter((c) => c.baseline_front === null || c.baseline_front !== c.front || c.baseline_back !== c.back).length;

  const sync = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      const r = await api.post<{ added: number; updated: number; unchanged: number }>(`/api/decks/${id}/sync`, {});
      toast(`同步完成：新增 ${r.added}、更新 ${r.updated}、不變 ${r.unchanged}`);
      void refetch();
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally { setSyncBusy(false); }
  };

  return (
    <Page>
      <PageHeader
        title={d.title}
        subtitle={
          <span>
            {data.cards.length} 張 · 到期 {data.cards.filter((c) => c.due !== null && c.due <= Date.now()).length} · 未學 {data.cards.filter((c) => c.state === null).length}
            {d.source_type === "notebooklm" && d.last_synced_at && ` · 上次同步 ${fmtRelative(d.last_synced_at)}`}
          </span>
        }
        actions={
          <>
            <Link to={`/decks/${id}/review`}>
              <Button variant="primary"><Brain size={18} weight="fill" /> 智慧複習</Button>
            </Link>
            <Link to={`/decks/${id}/shuffle`}>
              <Button><Shuffle size={18} /> 隨機練習</Button>
            </Link>
            <Link to={`/decks/${id}/weak`}>
              <Button><Target size={18} /> 弱項加強</Button>
            </Link>
            {canEdit && <VisibilityButton kind="deck" id={id!} title={d.title} createdBy={d.created_by} visibility={d.visibility} />}
            <IconButton label="字卡組設定" onClick={() => setSettingsOpen(true)}>
              <GearSix size={20} />
            </IconButton>
          </>
        }
      />
      {error && <div className="mb-4 space-y-2"><ErrorBox error={error} /><Button onClick={() => void refetch()}>重新整理字卡組</Button></div>}

      {changedCount > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4 text-sm dark:border-amber-500/30 dark:from-amber-500/10 dark:to-yellow-500/5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-400 text-white"><GitDiff size={18} weight="bold" /></span>
          <span className="flex-1">
            有 {changedCount} 張卡片在原版之後被新增或修訂（<span className="rev-ins">螢光</span>標示）。
          </span>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> 顯示原版
          </label>
          {user.role === "admin" && (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                if (!confirm("將所有修訂確認為新原版？")) return;
                await api.post(`/api/decks/${id}/baseline`);
                void refetch();
                qc.invalidateQueries({ queryKey: ["decks"] });
              }}
            >
              <SealCheck size={18} weight="fill" /> 全部確認為原版
            </Button>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { value: "all", label: "全部" },
            { value: "due", label: "到期" },
            { value: "new", label: "未學" },
            { value: "changed", label: `修訂 ${changedCount || ""}` },
          ]}
        />
        <input className={fieldCls + " w-56 max-w-full"} placeholder="搜尋卡片" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ml-auto flex gap-2">
          {canEdit && d.source_url && (
            <Button size="sm" disabled={syncBusy} onClick={sync}>
              <ArrowsClockwise size={16} /> {syncBusy ? "同步中…" : "從 NotebookLM 同步"}
            </Button>
          )}
          {canEdit && <><Button size="sm" onClick={() => setImporting(true)}>
            <DownloadSimple size={16} /> 匯入
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} weight="bold" /> 新卡
          </Button></>}
        </div>
      </div>

      {cards.length === 0 && <div className="space-y-3 rounded-3xl bg-slate-900/5 p-6 text-sm text-slate-500 dark:bg-white/5"><p>{data.cards.length ? "沒有符合篩選條件的卡片。" : "這個字卡組還沒有卡片。"}</p>{(q || filter !== "all") && <Button onClick={() => setParams(mergeSearchParams({ q: "", filter: "all" }, { filter: "all" }))}>清除篩選</Button>}</div>}

      <div className={clsx("grid gap-2", device === "desktop" ? "grid-cols-2" : "grid-cols-1")}>
        {cards.map((c) => {
          const isNew = c.baseline_front === null;
          const changed = !isNew && (c.baseline_front !== c.front || c.baseline_back !== c.back);
          return (
            <Card key={c.id} id={`card-${c.id}`} tabIndex={-1} interactive className={clsx("p-4", highlight === c.id && "ring-2 ring-brand-500", isNew && "ring-1 ring-amber-300")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Markdown md={showOriginal && !isNew ? c.baseline_front! : c.front} baseline={!showOriginal && changed ? c.baseline_front : null} inline className="text-sm font-medium" />
                  <div className="border-t border-dashed border-slate-200 pt-1.5 dark:border-slate-700">
                    <Markdown md={showOriginal && !isNew ? c.baseline_back! : c.back} baseline={!showOriginal && changed ? c.baseline_back : null} inline className="text-sm text-slate-600 dark:text-slate-300" />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {isNew && <Badge color="yellow">新增</Badge>}
                  {changed && <Badge color="yellow">已修訂</Badge>}
                  {c.state !== null && <span className="text-[10px] text-slate-400">下次 {c.due ? fmtDate(c.due).slice(5, 10) : "—"}</span>}
                  {canEdit && <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-900/5 hover:text-brand-600" onClick={() => setEditing(c)} aria-label="編輯卡片">
                    <PencilSimple size={16} />
                  </button>}
                </div>
              </div>
              {(changed || isNew) && c.updated_by_name && <div className="mt-1 text-[10px] text-slate-400">由 {c.updated_by_name} 於 {fmtRelative(c.updated_at)} 修訂</div>}
            </Card>
          );
        })}
      </div>

      {editing && <CardEditor deckId={id!} card={editing === "new" ? null : editing} isAdmin={user.role === "admin"} onClose={() => setEditing(null)} onSaved={() => (void refetch(), qc.invalidateQueries({ queryKey: ["decks"] }))} />}
      <ImportSheet open={importing} onClose={() => (setImporting(false), void refetch())} deckId={id} />
      {settingsOpen && <DeckSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} deckId={id!} deck={d} settings={data.settings} isAdmin={user.role === "admin"} onSaved={() => { void refetch(); void qc.invalidateQueries({ queryKey: ["queue", id] }); }} />}
    </Page>
  );
}

function CardEditor({ deckId, card, isAdmin, onClose, onSaved }: { deckId: string; card: CardT | null; isAdmin: boolean; onClose: () => void; onSaved: () => void }) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const frontId = useId(), backId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const history = useQuery({ queryKey: ["card-rev", card?.id], queryFn: () => api.get<{ revisions: { front: string; back: string; created_at: number; author_name: string }[] }>(`/api/decks/cards/${card!.id}/revisions`), enabled: !!card });
  const change = async (action: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      await action();
      toast("已儲存");
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally { pending.current = false; setBusy(false); }
  };
  const save = () => change(() => card ? api.put(`/api/decks/cards/${card.id}`, { front, back }) : api.post(`/api/decks/${deckId}/cards`, { front, back }));
  return (
    <Sheet open onClose={() => { if (!busy) onClose(); }} title={card ? "編輯卡片" : "新增卡片"} wide>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor={frontId} className="block text-xs font-semibold text-slate-500">正面（Markdown + LaTeX）</label><textarea id={frontId} className={textareaCls + " h-28"} disabled={busy} value={front} onChange={(e) => setFront(e.target.value)} />
          <label htmlFor={backId} className="block text-xs font-semibold text-slate-500">背面</label><textarea id={backId} className={textareaCls + " h-36"} disabled={busy} value={back} onChange={(e) => setBack(e.target.value)} />
          {error && <p role="alert" className="text-sm text-rose-600">變更尚未儲存：{error}。請再試一次。</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={save} disabled={busy || !front.trim()}>
              {busy ? "正在儲存…" : "儲存"}
            </Button>
            {card && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm("刪除這張卡片？")) return;
                  void change(() => api.del(`/api/decks/cards/${card.id}`));
                }}
              >
                刪除
              </Button>
            )}
            {card && isAdmin && card.baseline_front !== null && (card.baseline_front !== card.front || card.baseline_back !== card.back) && (
              <Button
                disabled={busy}
                onClick={() => void change(() => api.post(`/api/decks/cards/${card.id}/revert`))}
              >
                回復原版
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500">預覽</div>
          <Card className="p-3">
            <Markdown md={front} className="font-medium" />
            <hr className="my-2 border-dashed" />
            <Markdown md={back} />
          </Card>
          {card && (history.data?.revisions.length ?? 0) > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500">修訂紀錄（{history.data!.revisions.length}）</summary>
              {history.data!.revisions.map((r, i) => (
                <div key={i} className="mt-1 border-b border-slate-100 pb-1 dark:border-slate-800">
                  {r.author_name} · {fmtDate(r.created_at)}
                  <div className="text-slate-500">
                    {r.front.slice(0, 60)} / {r.back.slice(0, 60)}
                  </div>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function DeckSettings({ open, onClose, deckId, deck, settings, isAdmin, onSaved }: { open: boolean; onClose: () => void; deckId: string; deck: DeckRes["deck"]; settings: DeckRes["settings"]; isAdmin: boolean; onSaved: () => void }) {
  const user = useUser();
  const canEdit = canEditContent(user, deck);
  const [npd, setNpd] = useState(String(settings.new_per_day));
  const [retention, setRetention] = useState(Math.round((settings.request_retention ?? 0.9) * 100));
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(settings.target_date ?? "");
  const [title, setTitle] = useState(deck.title);
  return (
    <Sheet open={open} onClose={onClose} title="字卡組設定">
      <div className="space-y-3 p-4 text-sm">
        <label className="block">
          名稱
          <input className={inputCls} disabled={!canEdit} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="font-semibold">我的複習設定</div>
        <label className="block">
          每日新卡上限
          <input className={inputCls} type="number" min={0} max={500} value={npd} onChange={(e) => setNpd(e.target.value)} />
        </label>
        <label className="block">
          考試日期（UTC+8；長間隔會提前到考前）
          <input className={inputCls} type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="block">
          目標記憶率 <span className="float-right font-mono tabular-nums">{retention}%</span>
          <input aria-label="目標記憶率" className="mt-3 w-full accent-zinc-800 dark:accent-zinc-200" type="range" min={80} max={97} step={1} value={retention} onChange={(e) => setRetention(Number(e.target.value))} />
          <span className="mt-2 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">預設 90%。調高會縮短複習間隔、增加負擔；這是排程目標，並非保證正確率。設定於下次評分生效，保留既有學習紀錄。</span>
        </label>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={busy || !title.trim() || !Number.isInteger(Number(npd)) || Number(npd) < 0 || Number(npd) > 500}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put(`/api/decks/${deckId}/settings`, { new_per_day: Number(npd), target_date: target || null, request_retention: retention / 100 });
                if (canEdit && title !== deck.title) await api.put(`/api/decks/${deckId}`, { title });
                toast("已儲存");
                onSaved();
                onClose();
              } catch (error) { toast(errorMessage(error), "err"); }
              finally { setBusy(false); }
            }}
          >
            儲存
          </Button>
          {isAdmin && (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={async () => {
                if (!confirm("刪除整個字卡組（含所有人的學習紀錄）？")) return;
                await api.del(`/api/decks/${deckId}`);
                location.href = "/decks";
              }}
            >
              刪除字卡組
            </Button>
          )}
        </div>
        {deck.source_url && <div className="text-xs break-all text-slate-500">來源：{deck.source_url}</div>}
      </div>
    </Sheet>
  );
}
