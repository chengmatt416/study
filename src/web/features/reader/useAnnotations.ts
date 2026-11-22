import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api, errorMessage } from "../../lib/api";
import { idb } from "../../lib/idb";
import type { Annotation } from "./PdfViewer";
import { annotationCache, AnnotationSync, validAnnotation, type AnnotationCache } from "./annotation-sync";

interface AnnotationRow { id: string; page: number; type: Annotation["type"]; data_json: string; color: string; visibility: "private" | "shared"; user_id: string; author: string | null }

export function useAnnotations(owner: string, book: string) {
  const sync = useMemo(() => {
    const key = `annotation-outbox:${encodeURIComponent(owner)}:${encodeURIComponent(book)}`;
    const update = (apply: (value: AnnotationCache) => AnnotationCache) => idb.update<AnnotationCache>(key, value => apply(annotationCache(value, owner, book)));
    return new AnnotationSync({
      owner, book,
      load: async () => {
        const result = await api.get<{ owner_id: string; annotations: AnnotationRow[] }>(`/api/books/${book}/annotations`);
        if (result.owner_id !== owner) throw new Error("登入身分已變更，請重新開啟這本書");
        const annotations = result.annotations.map(annotation => ({ ...annotation, color: annotation.color ?? (annotation.type === "note" ? "#fde68a" : "#111111"), data: JSON.parse(annotation.data_json), mine: annotation.user_id === owner }));
        if (!annotations.every(validAnnotation)) throw new Error("部分標注資料格式不正確，原資料已保留，請重試或聯絡管理員");
        return { owner_id: result.owner_id, annotations };
      },
      read: () => update(value => value),
      append: async changes => { await update(value => { const known = new Set(value.changes.map(change => change.id)); return { ...value, changes: [...value.changes, ...changes.filter(change => !known.has(change.id))] }; }); },
      acknowledge: async id => { await update(value => ({ ...value, changes: value.changes.filter(change => change.id !== id) })); },
      send: async change => {
        const body = { owner_id: owner, operation_id: change.id, delete: change.removed.map(annotation => annotation.id), create: change.added.map(annotation => ({ id: annotation.id, page: annotation.page, type: annotation.type, data: annotation.data, color: annotation.color, visibility: annotation.visibility })) };
        await api.post(`/api/books/${book}/annotations/batch`, body, { keepalive: new TextEncoder().encode(JSON.stringify(body)).byteLength < 48000, signal: AbortSignal.timeout(15000) });
      },
      message: errorMessage,
    });
  }, [owner, book]);
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  useEffect(() => {
    // A file that is not a library book (a chapter's PDF) has no annotation store: nothing is loaded or listened for.
    if (!book) return;
    void sync.load();
    const online = () => { void sync.retry(); };
    const beforeUnload = (event: BeforeUnloadEvent) => { const current = sync.getSnapshot(); if (current.pending && !current.locallySaved) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("online", online); window.removeEventListener("beforeunload", beforeUnload); sync.dispose(); };
  }, [sync, book]);
  const change = useCallback((removed: Annotation[], added: Annotation[]) => sync.change(removed, added), [sync]);
  return { ...snapshot, change, retry: sync.retry };
}
