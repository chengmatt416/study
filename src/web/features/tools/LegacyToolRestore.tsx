import { useState } from "react";
import { Button, Sheet } from "../../components/ui";
import { useUser } from "../../lib/auth";

export function LegacyToolRestore({ available, onRestore, disabled, replace }: { available: boolean; onRestore: () => boolean | Promise<boolean>; disabled?: boolean; replace?: boolean }) {
  const user = useUser();
  const [open, setOpen] = useState(false), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  return <>
    <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setConfirmed(false); setError(false); setOpen(true); }}>恢復此裝置先前的內容</Button>
    <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title="恢復先前的工具內容"><div className="space-y-4 p-5 text-sm">
      <p>此裝置保留了尚未連結帳號的舊內容。只有確定是自己的紀錄時，才匯入目前帳號。</p>
      {replace && <p>恢復會取代目前工具中的內容。若要保留目前輸入，請先複製備份。</p>}
      <p className="break-all text-slate-500">目前帳號：{user.email}</p>
      <label className="flex min-h-11 items-start gap-3"><input className="mt-1" type="checkbox" disabled={busy} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我確認這些內容屬於自己，並希望匯入目前帳號。</span></label>
      {error && <p role="alert" className="text-rose-600">目前無法恢復或儲存。原內容仍保留在此裝置，請確認連線與瀏覽器儲存空間後再試。</p>}
      <Button variant="primary" disabled={!confirmed || busy} onClick={async () => { setBusy(true); setError(false); try { if (await onRestore()) setOpen(false); else setError(true); } catch { setError(true); } finally { setBusy(false); } }}>{busy ? "恢復中…" : "確認恢復"}</Button>
    </div></Sheet>
  </>;
}
