// One button for the owner to flip a note, exam or flashcard deck between private and shared.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, LockSimpleOpen } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import type { Visibility } from "../../shared/visibility";
import { Button, toast } from "./ui";

export function VisibilityButton({ kind, id, title, createdBy, visibility }: { kind: "document" | "deck"; id: string; title: string; createdBy: string | null | undefined; visibility?: Visibility }) {
  const user = useUser();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!createdBy || createdBy !== user.id) return null;
  const isPrivate = visibility === "private";
  const canShare = user.access?.features.shared_write !== false;
  const flip = async () => {
    const next: Visibility = isPrivate ? "shared" : "private";
    setBusy(true);
    try {
      await api.put(`/api/${kind === "deck" ? "decks" : "documents"}/${encodeURIComponent(id)}/visibility`, { visibility: next });
      for (const key of [["doc", id], ["deck", id], ["documents"], ["decks"]]) qc.invalidateQueries({ queryKey: key });
      toast(next === "private" ? `「${title}」現在只有你看得到` : `「${title}」已分享給有權限的成員`);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };
  const label = isPrivate ? "分享給成員" : "改為私人";
  return (
    <Button size="sm" variant="ghost" onClick={flip} disabled={busy || (isPrivate && !canShare)} aria-label={`目前${isPrivate ? "私人" : "共享"}，${label}`} title={isPrivate ? (canShare ? "目前僅自己可見；按一下分享給有權限的成員" : "你的群組已停用共享內容寫入") : "目前有權限的成員可見；按一下改為僅自己可見"}>
      {isPrivate ? <LockSimpleOpen size={18} /> : <Lock size={18} />} {busy ? "切換中…" : label}
    </Button>
  );
}
