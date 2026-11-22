export type SyncTone = "red" | "orange" | "green";

export interface AnnotationSyncView {
  ready: boolean;
  pending: number;
  saving: boolean;
  locallySaved: boolean;
  error: string | null;
}

export interface ReadingProgressView {
  ready: boolean;
  pending: unknown;
  saving: boolean;
  locallySaved: boolean;
  error: string | null;
}

export interface ReaderSyncStatus {
  tone: SyncTone;
  pulse: boolean;
  label: string;
  annotationText: string;
  annotationActionLabel: string | null;
  progressText: string;
  progressActionLabel: string | null;
}

/**
 * Combines annotation and reading-progress outbox states into one toolbar dot
 * (green = synced, orange = loading/pending/saving, red = error) plus popover details.
 */
export function resolveReaderSyncStatus(annotation: AnnotationSyncView, progress: ReadingProgressView): ReaderSyncStatus {
  const annotationText = annotation.error
    ? `${annotation.error}。${!annotation.ready ? "PDF 仍可閱讀，標注暫停。" : annotation.locallySaved ? "未同步的標注會保留在此裝置。" : "尚未暫存，請保持頁面開啟。"}`
    : !annotation.ready
      ? "正在讀取標注…"
      : annotation.saving
        ? `正在同步 ${annotation.pending} 筆標注…`
        : annotation.pending > 0
          ? `有 ${annotation.pending} 筆標注尚未同步，連線恢復後會重試。`
          : "標注已同步";

  const annotationActionLabel = annotation.error
    ? annotation.ready
      ? "重試同步"
      : "重新讀取標注"
    : annotation.pending > 0 && !annotation.saving
      ? "立即同步"
      : null;

  const progressText = progress.error
    ? `${progress.error}。${progress.pending ? (progress.locallySaved ? "閱讀位置已保留在此裝置，連線恢復後會重試。" : "閱讀位置尚未暫存，請保持頁面開啟。") : "暫時無法恢復本機閱讀位置，仍可閱讀 PDF。"}`
    : !progress.ready
      ? "正在讀取閱讀進度…"
      : progress.saving
        ? "正在同步閱讀位置…"
        : progress.pending
          ? "閱讀位置已保留在此裝置，待同步。"
          : "閱讀位置已同步";

  const progressActionLabel = progress.error ? "重試閱讀進度" : null;

  if (annotation.error || progress.error) {
    const label = annotation.error && progress.error
      ? "標注與閱讀進度同步失敗"
      : annotation.error
        ? (annotation.ready ? "標注同步失敗" : "標注讀取失敗")
        : "閱讀進度同步失敗";
    return { tone: "red", pulse: false, label, annotationText, annotationActionLabel, progressText, progressActionLabel };
  }

  const loadingOrSaving = !annotation.ready || !progress.ready || annotation.saving || progress.saving;
  if (loadingOrSaving || annotation.pending > 0 || Boolean(progress.pending)) {
    const label = !annotation.ready
      ? "正在讀取標注…"
      : annotation.saving
        ? `正在同步 ${annotation.pending} 筆標注…`
        : annotation.pending > 0
          ? `有 ${annotation.pending} 筆標注等待同步`
          : !progress.ready
            ? "正在讀取閱讀進度…"
            : progress.saving
              ? "正在同步閱讀位置…"
              : "閱讀位置待同步";
    return { tone: "orange", pulse: loadingOrSaving, label, annotationText, annotationActionLabel, progressText, progressActionLabel };
  }

  return { tone: "green", pulse: false, label: "已同步", annotationText, annotationActionLabel, progressText, progressActionLabel };
}
