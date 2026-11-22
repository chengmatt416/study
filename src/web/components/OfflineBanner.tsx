import { useEffect, useState } from "react";
import { CloudArrowUp, CloudSlash } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { flushReviewOutbox, legacyReviewCount, outboxSize, recoverLegacyReviews } from "../features/decks/outbox";
import { useUser } from "../lib/auth";
import { errorMessage } from "../lib/api";
import { Button, Sheet } from "./ui";

export function OfflineBanner({ floating }: { floating?: boolean }) {
  const user = useUser();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [legacy, setLegacy] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const [own, old] = await Promise.all([outboxSize(user.id), legacyReviewCount()]);
        if (active) { setPending(own); setLegacy(old); setError(""); }
      } catch (cause) { if (active) setError(errorMessage(cause)); }
    };
    const sync = async () => { await flushReviewOutbox(user.id); await read(); };
    const on = () => {
      setOnline(true);
      void sync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("study-review-outbox", read);
    void sync();
    const t = setInterval(() => { if (navigator.onLine) void sync(); else void read(); }, 15000);
    return () => {
      active = false;
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("study-review-outbox", read);
      clearInterval(t);
    };
  }, [user.id]);
  if (online && !pending && !legacy && !error) return null;
  return (
    <><div className={clsx("flex flex-wrap items-center justify-center gap-2 text-xs", floating ? "sticky top-0 z-30 bg-amber-100/90 px-4 py-1.5 text-amber-900 backdrop-blur dark:bg-amber-900/80 dark:text-amber-100" : "ml-auto rounded-lg bg-amber-100 px-3 py-1 text-amber-900")}>
      {!online ? <CloudSlash size={14} /> : <CloudArrowUp size={14} />}
      <span role="status">{error || (!online ? "離線中：複習紀錄會於連線後同步；權限控管內容需連線讀取" : pending ? `${pending} 筆複習紀錄等待同步…` : "此瀏覽器有先前尚未確認帳號的複習紀錄")}</span>
      {legacy > 0 && <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => setRecovering(true)}>恢復先前紀錄（{legacy}）</button>}
    </div>
    <Sheet open={recovering} onClose={() => { if (!busy) setRecovering(false); }} title="恢復未同步的複習紀錄">
      <div className="space-y-4 p-5 text-sm leading-relaxed">
        <p>這個瀏覽器有 {legacy} 筆舊紀錄未標示作答帳號。只有在確定是你用 <strong className="break-all">{user.email}</strong> 作答時，才恢復到目前帳號。</p>
        <p>若是別人的紀錄，請保留，讓原作答者登入後恢復。取消不會刪除任何紀錄。</p>
        {error && <p role="alert" className="text-rose-600">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={() => setRecovering(false)}>保留，稍後恢復</Button><Button variant="primary" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          try { await recoverLegacyReviews(user.id); setRecovering(false); await flushReviewOutbox(user.id); }
          catch (cause) { setError(errorMessage(cause)); }
          finally { setBusy(false); }
        }}>{busy ? "正在恢復…" : "這些是我的紀錄，恢復同步"}</Button></div>
      </div>
    </Sheet></>
  );
}
