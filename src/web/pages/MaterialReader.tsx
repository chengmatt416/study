import { Link, Navigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, DownloadSimple } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { Badge, ErrorBox, Loading, PageHeader } from "../components/ui";
import { Page } from "../layouts/Shell";
import { MaterialViewer } from "../features/chapters/MaterialViewer";
import type { ChapterDetail } from "../../shared/chapter";
import { ALWAYS_FRESH } from "../features/chapters/sync";

const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Opens one uploaded chapter material. A PDF goes straight to the default ebook reader (its record is created on the first
 * open, so annotations, bookmarks and progress are saved like any book); the other formats open in their viewers here.
 */
export default function MaterialReader() {
  const { id = "", materialId = "" } = useParams();
  const enc = { id: encodeURIComponent(id), materialId: encodeURIComponent(materialId) };
  const chapterPath = `/chapters/${enc.id}`;
  const fileUrl = `/api/chapters/${enc.id}/materials/${enc.materialId}/file`;
  const chapter = useQuery({ queryKey: ["chapter", id], queryFn: () => api.get<{ chapter: ChapterDetail }>(`/api/chapters/${enc.id}`).then((r) => r.chapter), ...ALWAYS_FRESH });
  const material = chapter.data?.material_list.find((m) => m.id === materialId);
  const reader = useQuery({
    queryKey: ["chapter-material-reader", id, materialId],
    queryFn: () => api.post<{ book_id: string }>(`/api/chapters/${enc.id}/materials/${enc.materialId}/reader`),
    enabled: material?.format === "pdf",
    staleTime: Infinity,
  });

  const back = <Link to={chapterPath} className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm hover:bg-slate-900/5"><ArrowLeft size={16} />回到章節</Link>;
  if (chapter.isLoading) return <Page><Loading /></Page>;
  if (!chapter.data) return <Page><ErrorBox error={chapter.error} /></Page>;
  if (!material) return <Page>{back}<ErrorBox error="找不到這份教材，可能已被刪除" /></Page>;

  if (material.format === "pdf") {
    if (reader.data) return <Navigate to={`/books/${encodeURIComponent(reader.data.book_id)}`} replace />;
    if (reader.error) return <Page>{back}<ErrorBox error={reader.error} /></Page>;
    return <Page><Loading label="開啟 PDF" /></Page>;
  }

  return <Page>
    <div className="mb-2">{back}</div>
    <PageHeader eyebrow={chapter.data.title}
      title={material.filename}
      subtitle={`${formatSize(material.size)}${material.sections ? ` · ${material.sections} 段` : ""}`}
      actions={<>
        <Badge>{material.format.toUpperCase()}</Badge>
        <a href={fileUrl} download={material.filename} className="inline-flex h-10 items-center gap-2 rounded-2xl px-4 text-sm font-medium hover:bg-slate-900/5"><DownloadSimple size={17} />下載原檔</a>
      </>} />
    <MaterialViewer format={material.format} fileUrl={fileUrl} filename={material.filename} />
  </Page>;
}
