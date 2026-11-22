// 試卷的資料手冊選擇器：選擇既有手冊，或直接上傳新的
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "@phosphor-icons/react";
import { api, errorMessage } from "../../lib/api";
import type { Book } from "../../lib/types";
import { fieldCls, toast } from "../../components/ui";
import { UploadSheet } from "../reader/UploadSheet";
import { useUser } from "../../lib/auth";

export function BookletPicker({ slug, value }: { slug: string; value: string | null }) {
  const user = useUser();
  const qc = useQueryClient();
  const [current, setCurrent] = useState(value ?? "");
  const [uploading, setUploading] = useState(false);
  const { data } = useQuery({ queryKey: ["booklets"], queryFn: () => api.get<{ books: Book[] }>("/api/books?kind=booklet") });

  const save = async (id: string) => {
    setCurrent(id);
    try {
      await api.put(`/api/documents/${encodeURIComponent(slug)}`, { booklet_id: id || null });
      toast(id ? "已連結資料手冊" : "已移除資料手冊");
      qc.invalidateQueries({ queryKey: ["paper", slug] });
      qc.invalidateQueries({ queryKey: ["doc", slug] });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  return (
    <div className="flex items-center gap-1.5" title="作答時可開啟的資料手冊">
      <FileText size={18} className="shrink-0 text-slate-500" />
      <select
        className={fieldCls + " h-9 w-auto max-w-56 pr-8 text-xs"}
        value={current}
        onChange={(e) => (e.target.value === "__upload" ? setUploading(true) : void save(e.target.value))}
        aria-label="資料手冊"
      >
        <option value="">無資料手冊</option>
        {data?.books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
          </option>
        ))}
        {user.access?.defaults.booklets !== false && <option value="__upload">＋ 上傳新的資料手冊…</option>}
      </select>
      <UploadSheet open={uploading} onClose={() => setUploading(false)} kind="booklet" onUploaded={(id) => void save(id)} />
    </div>
  );
}
