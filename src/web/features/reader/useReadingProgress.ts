import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { idb } from "../../lib/idb";
import { readingProgressCache, ReadingProgressSync, type ReadingProgressCache, type ReadingProgressServer } from "./reading-progress";

export function useReadingProgress(owner: string, book: string, server: ReadingProgressServer | undefined) {
  const queryClient = useQueryClient();
  const serverRef = useRef(server);
  serverRef.current = server;
  const sync = useMemo(() => {
    const key = `reading-outbox:${encodeURIComponent(owner)}:${encodeURIComponent(book)}`;
    const update = (apply: (value: ReadingProgressCache) => ReadingProgressCache) => idb.update<ReadingProgressCache>(key, value => apply(readingProgressCache(value, owner, book)));
    return new ReadingProgressSync({
      owner, book,
      read: () => update(value => value),
      write: async pending => (await update(value => ({ ...value, pending: value.pending && value.pending.changed_at > pending.changed_at ? value.pending : pending }))).pending!,
      acknowledge: async id => (await update(value => ({ ...value, pending: value.pending?.id === id ? null : value.pending }))).pending,
      send: async pending => {
        const response = await api.put<{ progress_updated_at: number; progress_changed_at: number; page?: number }>(`/api/books/${book}/progress`, { owner_id: owner, page: pending.page, changed_at: pending.changed_at }, { keepalive: true, signal: AbortSignal.timeout(15000) });
        queryClient.setQueryData<ReadingProgressServer>(["book", book], current => current?.owner_id === owner ? { ...current, lastPage: response.page ?? pending.page, progress_updated_at: response.progress_updated_at, progress_changed_at: response.progress_changed_at } : current);
      },
      message: errorMessage,
    });
  }, [owner, book, queryClient]);
  const snapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  useEffect(() => { if (server) void sync.initialize(server); }, [server, sync]);
  useEffect(() => {
    const online = () => { if (serverRef.current) void sync.initialize(serverRef.current).then(() => sync.retry()); };
    const beforeUnload = (event: BeforeUnloadEvent) => { const current = sync.getSnapshot(); if (current.pending && !current.locallySaved) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("online", online); window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("online", online); window.removeEventListener("beforeunload", beforeUnload); sync.dispose(); };
  }, [sync]);
  const save = useCallback((page: number) => sync.save(page), [sync]);
  const retry = useCallback(() => serverRef.current ? sync.initialize(serverRef.current).then(() => sync.retry()) : Promise.resolve(), [sync]);
  return { ...snapshot, save, retry };
}
