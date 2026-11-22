import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Button, Card, ErrorBox } from "../../components/ui";
import type { LaunchSession } from "./classroom-launch";
import { ClassroomLaunchProgress } from "./ClassroomLaunchProgress";
import { useClassroomLaunch } from "./useClassroomLaunch";

interface Course { id: string; title: string; total_parts: number; published_parts: number }
interface Part { id: string; title: string; position: number; source_chars: number; generation_id: string | null; published_at: number | null }
interface CoursePage { courses: Course[]; next_offset: number | null }
interface PartPage { parts: Part[]; next_offset: number | null; total_parts: number; published_parts: number }

export function LongCoursePanel({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const launcher = useClassroomLaunch();
  const [opening, setOpening] = useState<{ courseId: string; part: Part } | null>(null);
  const start = (courseId: string, part: Part) => {
    if (launcher.busy || launcher.blocked) return;
    setOpening({ courseId, part });
    void launcher.launch(signal => api.post<LaunchSession>(`/api/long-courses/${encodeURIComponent(courseId)}/parts/${encodeURIComponent(part.id)}/launch`, {}, { signal }));
  };
  const courses = useInfiniteQuery({ queryKey: ["long-courses", slug], initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<CoursePage>(`/api/long-courses?note_slug=${encodeURIComponent(slug)}&offset=${pageParam}`),
    getNextPageParam: page => page.next_offset ?? undefined, refetchInterval: 30_000,
  });
  if (courses.error && !courses.data) return <Card className="space-y-3 p-4"><ErrorBox error={courses.error} /><Button size="sm" className="min-h-11" onClick={() => void courses.refetch()}>重試載入課程</Button></Card>;
  if (!courses.data?.pages.some(page => page.courses.length)) return null;
  return <section className="space-y-4" aria-label="分冊課程">
    <div><h2 className="text-lg font-semibold">分冊課程</h2><p className="mt-1 text-sm text-slate-500">按章節依序學習，每冊保留完整教學、互動與檢核。</p></div>
    {courses.error && <div className="space-y-2" role="status"><p className="text-sm text-slate-500">暫時無法更新課程，已載入的內容仍可使用。</p><Button size="sm" className="min-h-11" onClick={() => void courses.refetch()}>重新更新課程</Button></div>}
    {courses.data.pages.flatMap(page => page.courses).map(course => <CourseParts key={course.id} course={course} canEdit={canEdit} launcher={launcher} opening={opening?.courseId === course.id ? opening.part : null} onLaunch={part => start(course.id, part)} />)}
    {courses.hasNextPage && <Button className="min-h-11" disabled={courses.isFetchingNextPage} onClick={() => void courses.fetchNextPage()}>載入更多課程</Button>}
  </section>;
}
function CourseParts({ course, canEdit, launcher, opening, onLaunch }: { course: Course; canEdit: boolean; launcher: ReturnType<typeof useClassroomLaunch>; opening: Part | null; onLaunch: (part: Part) => void }) {
  const [open, setOpen] = useState(true);
  const parts = useInfiniteQuery({ queryKey: ["long-course-parts", course.id], initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<PartPage>(`/api/long-courses/${encodeURIComponent(course.id)}?offset=${pageParam}`),
    getNextPageParam: page => page.next_offset ?? undefined, enabled: open, refetchInterval: query => open && (query.state.data?.pages.length ?? 0) <= 1 ? 30_000 : false,
  });
  const first = parts.data?.pages[0];
  return <Card className="p-4 md:p-6">
    <button type="button" className="flex min-h-11 w-full items-start justify-between gap-3 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-4" aria-expanded={open} aria-controls={`course-${course.id}`} onClick={() => setOpen(!open)}>
      <span><span className="font-semibold">{course.title}</span><span className="mt-1 block text-xs text-slate-500">已發布 {first?.published_parts ?? course.published_parts} / {first?.total_parts ?? course.total_parts} 冊</span></span><span aria-hidden="true">{open ? "−" : "+"}</span>
    </button>
    {opening && launcher.busy && <div className="mt-4"><p className="text-sm font-medium">正在開啟第 {opening.position} 冊：{opening.title}</p><ClassroomLaunchProgress step={launcher.step} elapsed={launcher.elapsed} onCancel={launcher.cancel} focusOnMount /></div>}
    {opening && launcher.error && <div className="mt-4 space-y-2"><p role="alert" className="text-sm text-rose-600">{launcher.error}</p><Button size="sm" className="min-h-11" onClick={() => onLaunch(opening)}>重試開啟這一冊</Button></div>}
    {open && <div id={`course-${course.id}`} className="mt-4 space-y-3">
      {parts.isLoading && <p role="status" className="text-sm text-slate-500">正在載入分冊…</p>}
      {parts.error && <div className="space-y-2"><ErrorBox error={parts.error} /><Button size="sm" className="min-h-11" onClick={() => void (parts.isFetchNextPageError ? parts.fetchNextPage() : parts.refetch())}>重試載入分冊</Button></div>}
      {first?.parts.length === 0 && <p className="text-sm text-slate-500">{canEdit ? "尚未加入分冊。請讓已連接 MCP 的 chatbot 讀取 get_openmaic_guide，逐冊建立與檢查。" : "課程正在準備，發布後即可開始。"}</p>}
      <ol className="divide-y divide-slate-100">
        {parts.data?.pages.flatMap(page => page.parts).map(part => <li key={part.id} className="flex flex-wrap items-center gap-3 py-3">
          <span className="w-8 shrink-0 font-mono text-xs text-slate-400">{String(part.position).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{part.title}</span><span className="mt-1 block text-xs text-slate-500">{part.published_at ? "已發布" : part.generation_id ? "已啟動，可由 MCP 查詢與續接" : "等待生成"} · {part.source_chars.toLocaleString()} 字元來源</span></span>
          <Button size="sm" className="min-h-11" disabled={!part.published_at || launcher.busy || launcher.blocked} onClick={() => onLaunch(part)}>{opening?.id === part.id && launcher.busy ? "正在開啟…" : opening?.id === part.id && launcher.error ? "重試開啟" : "開始學習"}</Button>
        </li>)}
      </ol>
      {parts.hasNextPage && <Button size="sm" className="min-h-11" disabled={parts.isFetchingNextPage} onClick={() => void parts.fetchNextPage()}>載入更多分冊</Button>}
    </div>}

  </Card>;
}
