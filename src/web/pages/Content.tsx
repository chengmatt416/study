import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowCounterClockwise, BookOpen, Cards, CaretRight, Exam, Folder, FolderPlus, MagnifyingGlass, NotePencil, PencilSimple, Star, Trash, X } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { fmtRelative } from "../lib/format";
import { mergeSearchParams } from "../lib/search-params";
import { Badge, Button, Card, Empty, ErrorBox, fieldCls, IconButton, inputCls, Loading, PageHeader, Sheet, SubjectDot, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import type { ContentFolder, ContentItem, ContentType } from "../../shared/content";
import { refreshChapterData } from "../features/chapters/sync";

const kindNames: Record<string, string> = { note: "重點整理", exam: "模擬試題", book: "電子書", booklet: "資料手冊", syllabus: "學期課綱", deck: "字卡" };
const itemKey = (item: { type: ContentType; id: string }) => `${item.type}:${item.id}`;

function folderPath(folder: ContentFolder, folders: ContentFolder[]): string {
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parent = folder.parent_id;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const next = folders.find((f) => f.id === parent);
    if (!next) break;
    names.unshift(next.name);
    parent = next.parent_id;
  }
  return names.join(" / ");
}

function ContentIcon({ kind }: { kind: string }) {
  const Icon = kind === "note" ? NotePencil : kind === "exam" ? Exam : kind === "deck" ? Cards : BookOpen;
  return <Icon size={22} />;
}

export default function Content() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") || "active";
  const folderId = params.get("folder_id") || "";
  const kind = params.get("kind") || "";
  const query = params.get("q") || "";
  const sort = params.get("sort") || "recent";
  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState("");
  const [editing, setEditing] = useState<ContentFolder | "new" | null>(null);
  const [deleting, setDeleting] = useState<ContentItem[] | null>(null);
  useEffect(() => { setSearch(query); }, [query]);
  useEffect(() => { setSelected(new Set()); }, [view, folderId, kind, query, sort]);
  const foldersQuery = useQuery({ queryKey: ["content-folders"], queryFn: () => api.get<{ folders: ContentFolder[] }>("/api/content/folders") });
  const folders = foldersQuery.data?.folders ?? [];
  const currentFolder = folders.find((f) => f.id === folderId);
  const itemsQuery = useInfiniteQuery({
    queryKey: ["content", view, folderId, kind, query, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ view, limit: "50", sort });
      if (folderId) p.set("folder_id", folderId);
      if (kind) p.set("kind", kind);
      if (query) p.set("q", query);
      if (pageParam) p.set("cursor", pageParam);
      return api.get<{ items: ContentItem[]; next_cursor: string | null }>(`/api/content?${p}`);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = itemsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const chosen = items.filter((item) => selected.has(itemKey(item)));
  const childFolders = folders.filter((f) => f.parent_id === (currentFolder?.id ?? null));
  const sortedFolders = [...folders].sort((a, b) => folderPath(a, folders).localeCompare(folderPath(b, folders), "zh-Hant"));
  const updateFilter = (values: Record<string, string>) => {
    setParams(mergeSearchParams(values));
    setSelected(new Set());
  };
  const refresh = async () => {
    // Deleting or moving content also changes what chapters show, so their lists refresh too.
    await Promise.all([refreshChapterData(qc), ...["books", "booklets"].map((key) => qc.invalidateQueries({ queryKey: [key] }))]);
  };
  const organize = async (targets: ContentItem[], change: { folder_id?: string | null; archived?: boolean; starred?: boolean }) => {
    if (!targets.length || busy) return;
    setBusy(true);
    try {
      await api.post("/api/content/bulk", { items: targets.map(({ type, id }) => ({ type, id })), ...change });
      setSelected(new Set());
      setMoving(false);
      await refresh();
      toast(change.archived === true ? "已封存，可在「已封存」找回" : change.archived === false ? "已移回使用中" : change.folder_id !== undefined ? "已移動內容" : change.starred ? "已加入收藏" : "已取消收藏");
    } catch (error) { toast(errorMessage(error), "err"); }
    finally { setBusy(false); }
  };
  const remove = async (targets: ContentItem[]) => {
    if (!targets.length || busy) return;
    setBusy(true);
    let done = 0;
    const failed: string[] = [];
    for (const item of targets) {
      try {
        if (item.type === "document") await api.del(`/api/documents/${encodeURIComponent(item.slug ?? item.id)}`);
        else if (item.type === "deck") await api.del(`/api/decks/${encodeURIComponent(item.id)}`);
        else await api.del(`/api/books/${encodeURIComponent(item.id)}`);
        done++;
      } catch (error) { failed.push(`${item.title}：${errorMessage(error)}`); }
    }
    setSelected(new Set());
    setDeleting(null);
    await refresh();
    setBusy(false);
    if (failed.length) toast(`已刪除 ${done} 筆，${failed.length} 筆失敗：${failed[0]}`, "err");
    else toast(`已刪除 ${done} 筆`);
  };
  const toggleSelected = (item: ContentItem) => {
    const key = itemKey(item);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (next.size < 100) next.add(key);
      return next;
    });
  };
  const title = currentFolder?.name ?? (folderId === "root" ? "未分類" : view === "archived" ? "已封存" : view === "starred" ? "收藏" : "全部內容");

  return <Page wide>
    <PageHeader title="內容庫" subtitle="一起整理重點、課程、試題、字卡與電子書。資料夾、收藏與封存僅影響自己的清單。" actions={<Button onClick={() => setEditing("new")}><FolderPlus size={18} /> 新增資料夾</Button>} />
    <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <nav aria-label="內容分類" className="flex flex-wrap gap-1 lg:flex-col">
          {[
            { value: "active", label: "使用中", icon: Folder },
            { value: "starred", label: "收藏", icon: Star },
            { value: "archived", label: "已封存", icon: Archive },
            { value: "all", label: "全部內容", icon: BookOpen },
          ].map(({ value, label, icon: Icon }) => <Button key={value} variant={view === value && !folderId ? "primary" : "ghost"} className="justify-start" onClick={() => updateFilter({ view: value, folder_id: "" })}><Icon size={18} />{label}</Button>)}
          <Button variant={folderId === "root" ? "primary" : "ghost"} className="justify-start" onClick={() => updateFilter({ folder_id: "root" })}><Folder size={18} />未分類</Button>
        </nav>
        <div className="mt-5 hidden border-t border-slate-200 pt-4 lg:block dark:border-white/10">
          <h2 className="mb-2 px-4 text-xs font-semibold text-slate-500">資料夾</h2>
          {foldersQuery.isLoading ? <p className="px-4 text-sm text-slate-500">載入中…</p> : sortedFolders.length === 0 ? <p className="px-4 text-sm text-slate-500">建立資料夾，整理不同主題。</p> : <nav aria-label="資料夾" className="max-h-[55vh] space-y-1 overflow-y-auto">
            {sortedFolders.map((folder) => <button key={folder.id} aria-current={folder.id === folderId ? "page" : undefined} onClick={() => updateFilter({ folder_id: folder.id })} className={clsx("flex min-h-10 w-full items-center gap-2 rounded-xl px-4 py-2 text-left text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2", folder.id === folderId ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/5")}>
              <Folder size={17} className="shrink-0" /><span className="min-w-0 flex-1 break-words">{folderPath(folder, folders)}</span><span className="text-xs tabular-nums opacity-60">{folder.item_count}</span>
            </button>)}
          </nav>}
        </div>
        {foldersQuery.error && <div className="mt-3"><ErrorBox error={foldersQuery.error} /><Button size="sm" onClick={() => void foldersQuery.refetch()}>重新讀取資料夾</Button></div>}
      </aside>
      <section className="min-w-0 space-y-4" aria-label={title}>
        <div className="flex flex-wrap items-center gap-2">
          {currentFolder && <button className="rounded-lg px-1 py-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white" onClick={() => updateFilter({ folder_id: currentFolder.parent_id ?? "" })}>上一層<CaretRight className="ml-1 inline" size={12} /></button>}
          <h2 className="min-w-0 flex-1 break-words text-xl font-semibold">{title}</h2>
          {currentFolder && <IconButton label="資料夾設定" onClick={() => setEditing(currentFolder)}><PencilSimple size={18} /></IconButton>}
          <span aria-live="polite" className="text-xs text-slate-500">{items.length} 筆{itemsQuery.hasNextPage ? "以上" : ""}</span>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); updateFilter({ q: search.trim() }); }} className="flex flex-wrap gap-2" role="search" aria-label="搜尋內容標題">
          <div className="relative min-w-40 flex-1">
            <MagnifyingGlass size={17} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input aria-label="搜尋內容標題" className={inputCls + " pl-10"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋標題…" maxLength={200} type="search" />
          </div>
          <Button type="submit">搜尋</Button>
          <select aria-label="內容類型" className={fieldCls + " min-w-28 flex-1 sm:flex-none"} value={kind} onChange={(event) => updateFilter({ kind: event.target.value })}><option value="">所有類型</option>{Object.entries(kindNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
          <select aria-label="排序方式" className={fieldCls + " min-w-28 flex-1 sm:flex-none"} value={sort} onChange={(event) => updateFilter({ sort: event.target.value })}><option value="recent">最近更新</option><option value="title">標題排序</option></select>
          <select aria-label="選擇資料夾" className={inputCls + " lg:hidden"} value={folderId} onChange={(event) => updateFilter({ folder_id: event.target.value })}><option value="">所有資料夾</option><option value="root">未分類</option>{sortedFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder, folders)}</option>)}</select>
        </form>
        {query && <div className="flex items-center gap-2 text-sm text-slate-500">搜尋「{query}」<IconButton label="清除搜尋" onClick={() => { setSearch(""); updateFilter({ q: "" }); }}><X size={16} /></IconButton></div>}
        {!query && !kind && childFolders.length > 0 && folderId !== "root" && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {childFolders.map((folder) => <button key={folder.id} onClick={() => updateFilter({ folder_id: folder.id })} className="hairline flex min-h-14 min-w-0 items-center gap-2 rounded-2xl bg-white/70 px-3 py-3 text-left text-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-white/5 dark:hover:bg-white/10"><Folder size={21} className="shrink-0 text-slate-400" /><span className="min-w-0 flex-1 break-words font-medium">{folder.name}</span><span className="text-xs text-slate-500">{folder.item_count}</span></button>)}
        </div>}
        {items.length > 0 && <div className="flex min-h-10 flex-wrap items-center gap-2 text-sm">
          <label className="flex min-h-10 cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-ink-900 dark:accent-white" checked={items.slice(0, 100).every((item) => selected.has(itemKey(item)))} onChange={(event) => setSelected(event.target.checked ? new Set(items.slice(0, 100).map(itemKey)) : new Set())} />選取{items.length > 100 ? "前 100 筆" : "本頁內容"}</label>
          <span className="mr-auto text-xs text-slate-500" role="status">{chosen.length ? `已選 ${chosen.length} 筆` : "選取內容後，可批次移動或封存"}</span>
          {chosen.length > 0 && <>
            <Button size="sm" disabled={busy} onClick={() => { setDestination(currentFolder?.id ?? ""); setMoving(true); }}><Folder size={16} />移動</Button>
            <Button size="sm" disabled={busy} onClick={() => void organize(chosen, { starred: view !== "starred" })}><Star size={16} />{view === "starred" ? "取消收藏" : "收藏"}</Button>
            <Button size="sm" disabled={busy} onClick={() => void organize(chosen, { archived: view !== "archived" })}>{view === "archived" ? <ArrowCounterClockwise size={16} /> : <Archive size={16} />}{view === "archived" ? "取消封存" : "封存"}</Button>
            <Button size="sm" disabled={busy || !chosen.some((item) => item.can_delete)} title={chosen.some((item) => item.can_delete) ? undefined : "沒有你可以刪除的內容"} onClick={() => setDeleting(chosen.filter((item) => item.can_delete))}><Trash size={16} />刪除</Button>
            <IconButton label="取消選取" disabled={busy} onClick={() => setSelected(new Set())}><X size={17} /></IconButton>
          </>}
        </div>}
        {itemsQuery.error && items.length > 0 && !itemsQuery.isFetchNextPageError && <Card className="space-y-3 p-4"><p className="text-sm font-medium">目前顯示上次載入的內容，更新暫時失敗。</p><ErrorBox error={itemsQuery.error} /><Button disabled={itemsQuery.isFetching} onClick={() => void itemsQuery.refetch()}>{itemsQuery.isFetching ? "重試中…" : "重新讀取內容"}</Button></Card>}
        {itemsQuery.isLoading ? <Loading /> : itemsQuery.error && items.length === 0 ? <Card className="space-y-3 p-4"><ErrorBox error={itemsQuery.error} /><Button onClick={() => void itemsQuery.refetch()}>重試</Button></Card> : items.length === 0 ? <Empty icon={view === "archived" ? <Archive size={36} /> : <Folder size={36} />} title={query || kind ? "沒有符合的內容" : view === "archived" ? "還沒有封存內容" : "這裡還沒有內容"}>
          {query || kind ? "試試其他關鍵字或內容類型。" : view === "archived" ? "封存後的教材會保留在這裡，隨時可以找回。" : currentFolder ? "選取教材並移動到這個資料夾。" : "從重點整理、模擬試題、字卡或電子書新增教材。"}
        </Empty> : <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/70 dark:border-white/10 dark:bg-ink-900/70" aria-busy={busy}>
          {items.map((item) => <div key={itemKey(item)} className={clsx("flex items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-0 sm:px-4 dark:border-white/5", selected.has(itemKey(item)) && "bg-slate-100/80 dark:bg-white/5")}>
            <label className="grid min-h-11 min-w-7 shrink-0 cursor-pointer place-items-center"><input type="checkbox" aria-label={`選取 ${item.title}`} checked={selected.has(itemKey(item))} disabled={busy || !selected.has(itemKey(item)) && selected.size >= 100} onChange={() => toggleSelected(item)} className="h-4 w-4 accent-ink-900 dark:accent-white" /></label>
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 sm:grid dark:bg-white/5 dark:text-slate-300"><ContentIcon kind={item.kind} /></span>
            <div className="min-w-0 flex-1">
              <Link className="block break-words rounded font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2" to={item.url}>{item.title}</Link>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500"><span>{kindNames[item.kind] ?? item.kind}</span><SubjectDot subjectId={item.subject_id} />{item.has_course && <Badge>互動課程</Badge>}{item.archived_at && <Badge>已封存</Badge>}{item.folder_id && <span className="inline-flex max-w-full items-center gap-1"><Folder size={12} className="shrink-0" /><span className="truncate">{folders.find((folder) => folder.id === item.folder_id)?.name ?? "資料夾"}</span></span>}<span>更新於 {fmtRelative(item.updated_at)}</span></div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <IconButton className="min-h-11 min-w-11" label={item.starred ? `取消收藏 ${item.title}` : `收藏 ${item.title}`} disabled={busy} aria-pressed={item.starred} onClick={() => void organize([item], { starred: !item.starred })}><Star size={18} weight={item.starred ? "fill" : "regular"} /></IconButton>
              <IconButton className="min-h-11 min-w-11" label={item.archived_at ? `取消封存 ${item.title}` : `封存 ${item.title}`} disabled={busy} onClick={() => void organize([item], { archived: !item.archived_at })}>{item.archived_at ? <ArrowCounterClockwise size={18} /> : <Archive size={18} />}</IconButton>
              {item.can_delete && <IconButton className="min-h-11 min-w-11" label={`刪除 ${item.title}`} disabled={busy} onClick={() => setDeleting([item])}><Trash size={18} /></IconButton>}
            </div>
          </div>)}
        </div>}
        {itemsQuery.isFetchNextPageError && <div role="alert" className="text-sm text-rose-600">{errorMessage(itemsQuery.error)}</div>}
        {itemsQuery.hasNextPage && <div className="flex justify-center"><Button disabled={itemsQuery.isFetchingNextPage} onClick={() => void itemsQuery.fetchNextPage()}>{itemsQuery.isFetchingNextPage ? "載入中…" : "載入更多內容"}</Button></div>}
      </section>
    </div>
    <Sheet open={moving} onClose={() => { if (!busy) setMoving(false); }} title={`移動 ${chosen.length} 筆內容`}><form className="space-y-4 p-4" onSubmit={(event) => { event.preventDefault(); void organize(chosen, { folder_id: destination || null }); }}><label className="block text-sm">目的地<select className={inputCls + " mt-2"} value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">未分類</option>{sortedFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder, folders)}</option>)}</select></label><Button variant="primary" className="w-full" type="submit" disabled={busy || !chosen.length}>{busy ? "移動中…" : "移動到這裡"}</Button></form></Sheet>
    <Sheet open={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title={deleting?.length === 1 ? `刪除「${deleting[0].title}」？` : `刪除 ${deleting?.length ?? 0} 筆內容？`}>
      <div className="space-y-4 p-4 text-sm">
        {deleting && chosen.length > deleting.length && <p className="text-slate-500">另有 {chosen.length - deleting.length} 筆你沒有刪除權限，會保留。</p>}
        <ul className="space-y-1">{deleting?.slice(0, 8).map((item) => <li key={itemKey(item)} className="break-words">· {item.title}<span className="text-slate-500">（{kindNames[item.kind] ?? item.kind}）</span></li>)}{(deleting?.length ?? 0) > 8 && <li className="text-slate-500">…還有 {deleting!.length - 8} 筆</li>}</ul>
        <p className="text-slate-500">{deleting?.some((item) => item.type !== "document") ? "重點整理與試題會移到垃圾桶，管理員可還原；字卡組與電子書會永久刪除，無法復原。" : "重點整理與試題會移到垃圾桶，管理員可還原。"}</p>
        <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => deleting && void remove(deleting)}><Trash size={16} />{busy ? "刪除中…" : "確定刪除"}</Button><Button disabled={busy} onClick={() => setDeleting(null)}>取消</Button></div>
      </div>
    </Sheet>
    {editing && <FolderEditor folder={editing} folders={folders} defaultParent={currentFolder?.id ?? null} onClose={() => setEditing(null)} onSaved={async (deleted) => { if (deleted && currentFolder?.id === (editing as ContentFolder).id) updateFilter({ folder_id: currentFolder.parent_id ?? "" }); await refresh(); }} />}
  </Page>;
}

function FolderEditor({ folder, folders, defaultParent, onClose, onSaved }: { folder: ContentFolder | "new"; folders: ContentFolder[]; defaultParent: string | null; onClose: () => void; onSaved: (deleted?: boolean) => Promise<void> }) {
  const [name, setName] = useState(folder === "new" ? "" : folder.name);
  const [parent, setParent] = useState(folder === "new" ? defaultParent ?? "" : folder.parent_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const excluded = new Set<string>();
  if (folder !== "new") {
    excluded.add(folder.id);
    for (let index = 0; index < folders.length; index++) for (const candidate of folders) if (candidate.parent_id && excluded.has(candidate.parent_id)) excluded.add(candidate.id);
  }
  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
    try {
      if (remove && folder !== "new") await api.del(`/api/content/folders/${encodeURIComponent(folder.id)}`);
      else if (folder === "new") await api.post("/api/content/folders", { name: name.trim(), parent_id: parent || null });
      else await api.put(`/api/content/folders/${encodeURIComponent(folder.id)}`, { name: name.trim(), parent_id: parent || null });
      await onSaved(remove);
      toast(remove ? "已刪除空資料夾" : "已儲存資料夾");
      onClose();
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  };
  return <Sheet open onClose={() => { if (!busy) onClose(); }} title={folder === "new" ? "新增資料夾" : "資料夾設定"}>
    <form className="space-y-4 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block text-sm">資料夾名稱<input autoFocus required maxLength={120} className={inputCls + " mt-2"} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="block text-sm">放置位置<select className={inputCls + " mt-2"} value={parent} onChange={(event) => setParent(event.target.value)}><option value="">最上層</option>{folders.filter((candidate) => !excluded.has(candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{folderPath(candidate, folders)}</option>)}</select></label>
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex flex-wrap gap-2"><Button variant="primary" type="submit" disabled={busy || !name.trim()}>{busy ? "處理中…" : "儲存"}</Button>{folder !== "new" && <Button className="ml-auto" type="button" disabled={busy} onClick={() => void save(true)}>刪除空資料夾</Button>}</div>
      {folder !== "new" && (folder.item_count > 0 || folder.child_count > 0) && <p className="text-xs text-slate-500">先移出內容與子資料夾，就能刪除此資料夾。</p>}
    </form>
  </Sheet>;
}
