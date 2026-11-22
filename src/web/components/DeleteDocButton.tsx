// 刪除重點整理/試題（移到垃圾桶；管理員可在後台復原或永久刪除）
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Trash } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { Button, toast } from "./ui";

export function DeleteDocButton({ slug, kind, title, createdBy, visibility }: { slug: string; kind: "note" | "exam"; title: string; createdBy: string | null; visibility?: "shared" | "private" }) {
  const user = useUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (user.role !== "admin" && createdBy !== user.id) return null;
  const remove = async () => {
    const what = kind === "exam" ? "試卷" : "重點整理";
    if (!confirm(visibility === "private" ? `永久刪除私人${what}「${title}」？此動作會移除自己的修訂與作答紀錄，無法復原。` : `刪除${what}「${title}」？會移到垃圾桶，管理員可復原。`)) return;
    try {
      await api.del(`/api/documents/${encodeURIComponent(slug)}${visibility === "private" ? "?permanent=1" : ""}`);
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast(`已刪除「${title}」`);
      navigate(kind === "exam" ? "/exams" : "/notes", { replace: true });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };
  return (
    <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10" onClick={remove}>
      <Trash size={18} /> 刪除
    </Button>
  );
}
