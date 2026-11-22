// 20MB 分段上傳（R2 multipart）：並行 3 段、每段失敗重試 3 次、可續傳（重新選同一檔案即從斷點繼續）。
import { api, ApiError } from "../../lib/api";
import { openPdf } from "./pdf";
import { pdfjs } from "./pdf";
import type { Book } from "../../lib/types";
import { matchesLegacyUpload, uploadResumeKey, type UploadMetadata } from "../../../shared/book-upload";
import { readPdfPageText } from "./text-content";

export interface UploadProgress {
  phase: "analyzing" | "uploading" | "finishing" | "done" | "error";
  sent: number;
  total: number;
  message?: string;
}

interface InitRes {
  uploadId: string;
  bookId: string;
  partSize: number;
  partCount: number;
}

/** 本機分析 PDF：頁數、是否有文字層、封面縮圖 */
export async function analyzePdf(file: File): Promise<{ pageCount: number; hasText: boolean; cover: Blob | null }> {
  const url = URL.createObjectURL(file);
  let task: ReturnType<typeof openPdf> | undefined;
  try {
    task = openPdf(url);
    const doc = (await task.promise) as pdfjs.PDFDocumentProxy;
    let hasText = false;
    for (const p of [1, Math.min(5, doc.numPages), Math.min(20, doc.numPages)]) {
      if ((await readPdfPageText(await doc.getPage(p))).trim()) {
        hasText = true;
        break;
      }
    }
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 360 / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width;
    canvas.height = vp.height;
    await page.render({ canvas, viewport: vp }).promise;
    const cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.8));
    const pageCount = doc.numPages;
    return { pageCount, hasText, cover };
  } finally {
    await task?.destroy().catch(() => {});
    URL.revokeObjectURL(url);
  }
}

async function putPart(uploadId: string, n: number, blob: Blob, attempt = 1): Promise<void> {
  try {
    const res = await fetch(`/api/books/uploads/${encodeURIComponent(uploadId)}/parts/${n}`, { method: "PUT", body: blob, credentials: "same-origin" });
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`, res.status);
  } catch (e) {
    if (attempt >= 3 || (e instanceof ApiError && e.status < 500 && e.status !== 429)) throw e;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return putPart(uploadId, n, blob, attempt + 1);
  }
}

export async function uploadBook(
  file: File,
  meta: UploadMetadata,
  onProgress: (p: UploadProgress) => void,
  ownerId: string,
): Promise<string> {
  onProgress({ phase: "analyzing", sent: 0, total: file.size });
  const info = await analyzePdf(file).catch(() => ({ pageCount: 0, hasText: false, cover: null }));

  let init: InitRes | null = null;
  let done = new Set<number>();
  const key = uploadResumeKey(file, meta, ownerId);
  const legacyKey = `upload:${file.name}:${file.size}:${file.lastModified}`;
  const saved = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
  if (saved) {
    try {
      const s = JSON.parse(saved) as InitRes;
      const status = await api.get<{ doneParts: number[]; book_id: string; size_bytes: number; created_by: string | null }>(`/api/books/uploads/${encodeURIComponent(s.uploadId)}`);
      const { book } = await api.get<{ book: Book }>(`/api/books/${encodeURIComponent(s.bookId)}`);
      if (!matchesLegacyUpload(meta, ownerId, status, file.size, book)) throw new Error("上傳作業與目前的課綱或檔案不符");
      init = s;
      done = new Set(status.doneParts);
      localStorage.setItem(key, saved);
    } catch {
      localStorage.removeItem(key);
    }
  }
  if (!init) {
    init = await api.post<InitRes>("/api/books/uploads", {
      ...meta,
      owner_id: ownerId,
      size: file.size,
      filename: file.name,
      page_count: info.pageCount || undefined,
      has_text_layer: info.hasText,
    });
    localStorage.setItem(key, JSON.stringify(init));
  }
  const { uploadId, partSize, partCount, bookId } = init;
  const partLen = (n: number) => Math.min(partSize, file.size - (n - 1) * partSize);
  let sent = [...done].reduce((s, n) => s + partLen(n), 0);
  onProgress({ phase: "uploading", sent, total: file.size });

  const queue = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const n = queue.shift()!;
      const blob = file.slice((n - 1) * partSize, (n - 1) * partSize + partLen(n));
      await putPart(uploadId, n, blob);
      sent += blob.size;
      onProgress({ phase: "uploading", sent, total: file.size, message: `第 ${n}/${partCount} 段完成` });
    }
  });
  await Promise.all(workers);

  onProgress({ phase: "finishing", sent: file.size, total: file.size });
  await api.post(`/api/books/uploads/${encodeURIComponent(uploadId)}/complete`);
  localStorage.removeItem(key);
  if (localStorage.getItem(legacyKey) === saved) localStorage.removeItem(legacyKey);
  if (info.cover) await fetch(`/api/books/${bookId}/cover`, { method: "PUT", body: info.cover, headers: { "content-type": info.cover.type || "image/png" }, credentials: "same-origin" });
  if (meta.book_id && info.pageCount) await api.put(`/api/books/${bookId}`, { page_count: info.pageCount, has_text_layer: info.hasText });
  onProgress({ phase: "done", sent: file.size, total: file.size });
  return bookId;
}
