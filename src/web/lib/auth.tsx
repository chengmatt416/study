import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, errorMessage } from "./api";
import type { User } from "./types";
import { Button, Spinner } from "../components/ui";

const AuthCtx = createContext<User | null>(null);

export function useUser(): User {
  const u = useContext(AuthCtx);
  if (!u) throw new Error("useUser 必須在 RequireAuth 內使用");
  return u;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const qc = useQueryClient();
  const { data, isPending, fetchStatus, isFetching, error, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const next = await api.get<{ user: User }>("/api/me");
      const previous = qc.getQueryData<{ user: User }>(["me"]);
      if (previous && previous.user.id !== next.user.id) qc.removeQueries({ predicate: query => query.queryKey[0] !== "me" });
      return next;
    },
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  if (error instanceof ApiError && [401, 403].includes(error.status)) return <Navigate to={`/login?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!data && (error || fetchStatus === "paused")) return <div className="grid h-full place-items-center p-6"><div className="max-w-md space-y-4 text-center"><h1 className="text-xl font-semibold">暫時無法確認登入狀態</h1><p role="alert" className="text-sm text-slate-500">{error ? errorMessage(error) : "目前沒有網路連線。連線恢復後可繼續開啟這個頁面。"}</p><Button disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "正在重試…" : "重新連線"}</Button></div></div>;
  if (isPending || !data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  const feature = loc.pathname.startsWith("/syllabus") ? "syllabi" : loc.pathname.startsWith("/notes") ? "notes" : loc.pathname.startsWith("/exams") || loc.pathname.startsWith("/attempts") ? "exams" : loc.pathname.startsWith("/writing") ? "writing" : loc.pathname.startsWith("/decks") ? "decks" : loc.pathname.startsWith("/tools") ? "tools" : loc.pathname.startsWith("/ai") ? "ai" : null;
  const [section, id] = loc.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const type = section === "notes" || section === "exams" ? "document" : section === "books" ? "book" : section === "decks" ? "deck" : null;
  const deniedContent = !!id && data.user.access?.denied?.some((r) => r.type === type && (r.id === id || r.slug === id));
  const blocked = deniedContent || (feature ? data.user.access?.features[feature] === false : loc.pathname === "/books" && data.user.access?.features.ebooks === false && data.user.access.features.booklets === false);
  return <AuthCtx.Provider key={data.user.id} value={data.user}><div className="flex h-full min-h-0 flex-col">{error && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100"><span>連線暫時中斷；目前頁面與作答會保留。</span><button type="button" disabled={isFetching} className="min-h-9 underline underline-offset-4 disabled:opacity-50" onClick={() => void refetch()}>{isFetching ? "正在重試…" : "重新連線"}</button></div>}<div className="min-h-0 flex-1">{blocked ? <div className="p-8"><h1 className="text-2xl font-semibold">此功能未對你的群組開放</h1><p className="mt-3">如需存取，請聯絡管理員。</p><a className="mt-4 inline-block underline" href="/">回到首頁</a></div> : children}</div></div></AuthCtx.Provider>;
}
