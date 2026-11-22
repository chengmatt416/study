import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_COURSE_BYTES, validateCourse, type NoteCourse, type OpenMaicCourse } from "../../../shared/openmaic";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, ErrorBox, Loading, toast } from "../../components/ui";
import { CoursePlayer } from "./CoursePlayer";
import { CourseSetup } from "./CourseSetup";
import { LongCoursePanel } from "./LongCoursePanel";
import { ClassroomLaunchProvider } from "./useClassroomLaunch";

interface NoteCoursePanelProps { slug: string; title: string; canGenerate?: boolean; canEdit?: boolean }
export function NoteCoursePanel(props: NoteCoursePanelProps) {
  return <ClassroomLaunchProvider><NoteCourseContent {...props} /></ClassroomLaunchProvider>;
}
function NoteCourseContent({ slug, title, canGenerate = true, canEdit = true }: NoteCoursePanelProps) {
  const qc = useQueryClient();
  const path = `/api/documents/${encodeURIComponent(slug)}/course`;
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ["note-course", slug], queryFn: () => api.get<NoteCourse>(path), refetchInterval: 15_000 });
  const progress = useQuery({ queryKey: ["course-generations", slug], queryFn: () => api.get<{ generations: { id: string; status: string; step: string; completed_modules: number; total_modules: number | null }[] }>(`/api/course-generations?note_slug=${encodeURIComponent(slug)}`), refetchInterval: 10_000 });
  const [draft, setDraft] = useState<{ course: OpenMaicCourse; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  if (isLoading) return <><LongCoursePanel slug={slug} canEdit={canEdit} /><Loading /></>;
  if (error || !data) return <><LongCoursePanel slug={slug} canEdit={canEdit} /><ErrorBox error={error} /></>;
  const course = draft?.course ?? data.course;

  const importFile = async (file?: File) => {
    if (!file) return;
    setImportError(null);
    try {
      if (file.size > MAX_COURSE_BYTES) throw new Error("課程檔案超出 950 KB 上限，請將課程拆成多份重點整理。");
      const contents = await file.text();
      const input = /\.html?$/i.test(file.name) ? { schema: "study-openmaic/v1", format: "openmaic-html", title, html: contents } : contents;
      const v = validateCourse(input);
      if (!v.ok) throw new Error(v.errors.join("\n"));
      setDraft({ course: v.course, version: data.version });
    } catch (e) { setImportError(errorMessage(e)); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.put(path, { course: draft.course, expected_version: draft.version });
      await qc.invalidateQueries({ queryKey: ["note-course", slug] });
      await qc.invalidateQueries({ queryKey: ["documents", "note"] });
      await qc.invalidateQueries({ queryKey: ["doc", slug] });
      setDraft(null);
      toast("課程已儲存");
    } catch (e) { toast(errorMessage(e), "err"); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <LongCoursePanel slug={slug} canEdit={canEdit} />
    {progress.data?.generations[0]?.status === "active" && <Card className="space-y-2 p-4" role="status" aria-live="polite">
      <h2 className="font-semibold">課程生成進度</h2>
      <p className="text-sm text-slate-500">目前進度：{{ plan: "規劃課程", module: "逐個生成互動模組", quiz: "生成理解測驗", review: "整體檢查與修正", publish: "準備發布" }[progress.data.generations[0].step] ?? "生成中"}；互動模組 {progress.data.generations[0].completed_modules} / {progress.data.generations[0].total_modules ?? "待規劃"}。</p>
      <p className="text-xs text-slate-500">請在 chatbot 中繼續對話。若對話中斷，可讓它呼叫 list_course_generations 與 get_course_generation_step 恢復。</p>
    </Card>}
    {course && <Card className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-sm text-slate-500">{draft ? "預覽・尚未儲存" : `已儲存課程・版本 ${data.version}`}</span>
        {draft ? <>
          <Button size="sm" disabled={busy} onClick={() => setDraft(null)}>取消預覽</Button>
          <Button size="sm" variant="primary" disabled={busy || draft.version !== data.version} onClick={save}>{busy ? "儲存中…" : "儲存到重點整理"}</Button>
        </> : <Button size="sm" onClick={() => {
          const blob = new Blob([JSON.stringify(course, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = `${slug}.course.json`; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>匯出課程 JSON</Button>}
      </div>
      {draft && draft.version !== data.version && <p role="alert" className="mb-4 text-sm text-rose-600">課程已被其他人更新。請取消預覽，檢查新版本後重新匯入。</p>}
      <CoursePlayer key={draft ? `draft-${draft.version}` : `saved-${data.version}`} course={course} slug={slug} />
    </Card>}
    {data.course && canEdit && <Button size="sm" onClick={() => setManage(!manage)}>{manage ? "隱藏課程管理" : "更新或管理課程"}</Button>}
    {canEdit && (!data.course || manage) && <>{canGenerate && <Card className="p-4 md:p-6"><CourseSetup title={title} slug={slug} /></Card>}
    <Card className="space-y-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">匯入既有課程</h2>
        <Button size="sm" onClick={() => void refetch()}>重新讀取 MCP 儲存的課程</Button>
      </div>
      <p className="text-sm leading-6 text-slate-500">選擇 OpenMAIC 離線 HTML、相容課程 JSON 或原生 manifest.json（interactive / quiz）。包含 slide / pbl 的課程請在 OpenMAIC 匯出為離線 HTML。ZIP 請先在 OpenMAIC 開啟再匯出。上限 950 KB；單一 HTML 最多 800,000 字元。匯入後先預覽，再儲存。</p>
      <label className="block text-sm">課程檔案<input disabled={busy || !!draft} className="mt-2 block w-full text-sm" type="file" accept=".html,.htm,.json" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      {importError && <p role="alert" className="whitespace-pre-wrap text-sm text-rose-600">{importError}</p>}
    </Card></>}
  </div>;
}
