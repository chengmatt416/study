import { describe, expect, it } from "vitest";
import { resolveReaderSyncStatus, type AnnotationSyncView, type ReadingProgressView } from "../src/web/features/reader/sync-status";

const syncedAnnotation = (over: Partial<AnnotationSyncView> = {}): AnnotationSyncView => ({
  ready: true,
  pending: 0,
  saving: false,
  locallySaved: true,
  error: null,
  ...over,
});

const syncedProgress = (over: Partial<ReadingProgressView> = {}): ReadingProgressView => ({
  ready: true,
  pending: null,
  saving: false,
  locallySaved: true,
  error: null,
  ...over,
});

describe("resolveReaderSyncStatus", () => {
  it("returns green without pulse when annotations and reading progress are synced", () => {
    const status = resolveReaderSyncStatus(syncedAnnotation(), syncedProgress());
    expect(status).toEqual({
      tone: "green",
      pulse: false,
      label: "已同步",
      annotationText: "標注已同步",
      annotationActionLabel: null,
      progressText: "閱讀位置已同步",
      progressActionLabel: null,
    });
  });

  it("returns pulsing orange while loading initial annotations or reading progress", () => {
    const loadingAnns = resolveReaderSyncStatus(syncedAnnotation({ ready: false }), syncedProgress());
    expect(loadingAnns.tone).toBe("orange");
    expect(loadingAnns.pulse).toBe(true);
    expect(loadingAnns.label).toBe("正在讀取標注…");
    expect(loadingAnns.annotationActionLabel).toBeNull();

    const loadingProg = resolveReaderSyncStatus(syncedAnnotation(), syncedProgress({ ready: false }));
    expect(loadingProg.tone).toBe("orange");
    expect(loadingProg.pulse).toBe(true);
    expect(loadingProg.label).toBe("正在讀取閱讀進度…");
  });

  it("returns pulsing orange while saving annotations or progress without duplicate sync button", () => {
    const savingAnns = resolveReaderSyncStatus(syncedAnnotation({ pending: 2, saving: true }), syncedProgress());
    expect(savingAnns.tone).toBe("orange");
    expect(savingAnns.pulse).toBe(true);
    expect(savingAnns.label).toBe("正在同步 2 筆標注…");
    expect(savingAnns.annotationText).toBe("正在同步 2 筆標注…");
    expect(savingAnns.annotationActionLabel).toBeNull();

    const savingProg = resolveReaderSyncStatus(syncedAnnotation(), syncedProgress({ pending: { page: 5 }, saving: true }));
    expect(savingProg.tone).toBe("orange");
    expect(savingProg.pulse).toBe(true);
    expect(savingProg.label).toBe("正在同步閱讀位置…");
  });

  it("returns steady orange with immediate sync button when offline edits await retry", () => {
    const queued = resolveReaderSyncStatus(syncedAnnotation({ pending: 3 }), syncedProgress({ pending: { page: 7 } }));
    expect(queued.tone).toBe("orange");
    expect(queued.pulse).toBe(false);
    expect(queued.label).toBe("有 3 筆標注等待同步");
    expect(queued.annotationText).toBe("有 3 筆標注尚未同步，連線恢復後會重試。");
    expect(queued.annotationActionLabel).toBe("立即同步");
    expect(queued.progressText).toBe("閱讀位置已保留在此裝置，待同步。");
    expect(queued.progressActionLabel).toBeNull();
  });

  it("returns red when annotation sync fails and adapts label and message to readiness/local cache", () => {
    const syncErr = resolveReaderSyncStatus(syncedAnnotation({ error: "連線逾時", pending: 1, locallySaved: true }), syncedProgress());
    expect(syncErr.tone).toBe("red");
    expect(syncErr.pulse).toBe(false);
    expect(syncErr.label).toBe("標注同步失敗");
    expect(syncErr.annotationText).toBe("連線逾時。未同步的標注會保留在此裝置。");
    expect(syncErr.annotationActionLabel).toBe("重試同步");

    const loadErr = resolveReaderSyncStatus(syncedAnnotation({ ready: false, error: "503", locallySaved: false }), syncedProgress());
    expect(loadErr.tone).toBe("red");
    expect(loadErr.label).toBe("標注讀取失敗");
    expect(loadErr.annotationText).toBe("503。PDF 仍可閱讀，標注暫停。");
    expect(loadErr.annotationActionLabel).toBe("重新讀取標注");
  });

  it("returns red when reading progress fails and gives red precedence over orange annotation queue", () => {
    const progErr = resolveReaderSyncStatus(
      syncedAnnotation({ pending: 1, saving: true }),
      syncedProgress({ error: "offline", pending: { page: 4 }, locallySaved: false }),
    );
    expect(progErr.tone).toBe("red");
    expect(progErr.pulse).toBe(false);
    expect(progErr.label).toBe("閱讀進度同步失敗");
    expect(progErr.progressText).toBe("offline。閱讀位置尚未暫存，請保持頁面開啟。");
    expect(progErr.progressActionLabel).toBe("重試閱讀進度");

    const bothErr = resolveReaderSyncStatus(
      syncedAnnotation({ error: "errA", locallySaved: false }),
      syncedProgress({ error: "errB", pending: null }),
    );
    expect(bothErr.tone).toBe("red");
    expect(bothErr.label).toBe("標注與閱讀進度同步失敗");
    expect(bothErr.annotationText).toBe("errA。尚未暫存，請保持頁面開啟。");
    expect(bothErr.progressText).toBe("errB。暫時無法恢復本機閱讀位置，仍可閱讀 PDF。");
    expect(bothErr.annotationActionLabel).toBe("重試同步");
    expect(bothErr.progressActionLabel).toBe("重試閱讀進度");
  });
});
