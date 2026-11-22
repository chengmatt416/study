import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LockSimple, Trash, UsersThree } from "@phosphor-icons/react";
import type { PracticeLibrary } from "../../../shared/practice";
import type { Visibility } from "../../../shared/visibility";
import { Button, Sheet } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { sheetAnimation, type PracticeSettings } from "./settings";

export function PracticeLibrarySheet({ open, userId, canShare, motion, onClose, onChanged }: {
  open: boolean;
  userId: string;
  canShare: boolean;
  motion: PracticeSettings["motion"];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const library = useQuery({
    queryKey: ["practice-library", userId],
    queryFn: ({ signal }) => api.get<PracticeLibrary>("/api/practice/library", { signal }),
    enabled: open,
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (open) { setError(""); setStatus(""); }
  }, [open]);

  const privateCount = library.data?.private_count ?? 0;
  const sharedCount = library.data?.shared_count ?? 0;
  const total = privateCount + sharedCount;

  async function change(action: Visibility | "clear") {
    if (busy) return;
    if (action === "clear" && !window.confirm(`永久清除你建立的全部 ${total} 項混合複習內容？已共享的內容也會一併移除。`)) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      if (action === "clear") {
        const { deleted } = await api.del<{ deleted: number }>("/api/practice/library");
        setStatus(`已清除 ${deleted} 項內容。`);
      } else {
        const { changed } = await api.put<{ changed: number }>("/api/practice/library/visibility", { visibility: action });
        setStatus(action === "shared" ? `已分享 ${changed} 項內容給全體成員。` : `已將 ${changed} 項內容改為私人。`);
      }
      await Promise.all([library.refetch(), onChanged()]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return <Sheet open={open} onClose={() => { if (!busy) onClose(); }} title="管理混合複習內容" animation={sheetAnimation(motion)}>
    <div className="practice-library-sheet">
      {library.isPending ? <p role="status">正在讀取內容數量…</p> : library.isError ? <>
        <p role="alert">{errorMessage(library.error)}</p>
        <Button onClick={() => void library.refetch()} disabled={library.isFetching}>重新載入</Button>
      </> : <>
        <div className="practice-library-counts">
          <span><LockSimple size={17} />私人 <strong>{privateCount}</strong></span>
          <span><UsersThree size={18} />已共享 <strong>{sharedCount}</strong></span>
        </div>
        <p>這裡管理你建立的混合複習內容。分享後，全體成員都可在複習時選用。</p>
        {!canShare && privateCount > 0 && <p>你的群組目前未開放共享內容寫入。</p>}
        <div className="practice-library-actions">
          <Button variant="primary" disabled={busy || !canShare || !privateCount} onClick={() => void change("shared")}>
            <UsersThree size={19} />全部分享給成員
          </Button>
          {sharedCount > 0 && <Button disabled={busy} onClick={() => void change("private")}>
            <LockSimple size={18} />全部改為私人
          </Button>}
        </div>
        <div className="practice-library-clear">
          <Button variant="danger" disabled={busy || !total} onClick={() => void change("clear")}>
            <Trash size={18} />清除我的全部內容
          </Button>
          <p>會永久移除你建立的題目、字卡與觀念，包含已共享的內容。</p>
        </div>
      </>}
      {busy && <p role="status">正在更新內容…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  </Sheet>;
}
