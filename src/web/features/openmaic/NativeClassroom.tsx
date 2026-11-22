import { useEffect } from "react";
import { api } from "../../lib/api";
import { Button } from "../../components/ui";
import "./lesson.css";
import { ClassroomLaunchProgress } from "./ClassroomLaunchProgress";
import { warmClassroom, type LaunchSession } from "./classroom-launch";
import { useClassroomLaunch } from "./useClassroomLaunch";

export function NativeClassroom({ slug, title, version }: { slug?: string; title: string; version: string }) {
  const { busy, blocked, error, step, elapsed, launch, cancel } = useClassroomLaunch();
  // Start the classroom service while the learner is still reading this page.
  useEffect(() => { if (slug) void warmClassroom(slug, (path, body) => api.post(path, body)); }, [slug]);
  return <section className="mastery-course"><header className="course-masthead"><p className="lesson-eyebrow">STUDY 課堂 · OpenMAIC {version}</p><h2>{title}</h2></header><div className="course-welcome"><p className="course-welcome-statement">一步一步，<br />學到理解為止。</p><p className="course-intro">先確認起點，再逐步學習、動手互動與檢核。教學對話會停下來等你，點擊「繼續」才進到下一句；公式、白板與互動內容同步呈現。</p><Button variant="primary" className="min-h-11" disabled={busy || blocked || !slug} onClick={() => { if (slug) void launch(signal => api.post<LaunchSession>("/api/openmaic/launch", { note_slug: slug }, { signal })); }}>{busy ? "正在開啟課堂…" : blocked ? "其他課堂開啟中…" : error ? "重試開啟課堂" : "進入課堂"}</Button>{busy && <ClassroomLaunchProgress step={step} elapsed={elapsed} onCancel={cancel} focusOnMount />}{!slug && <p className="course-session-note">儲存後即可開啟課堂。</p>}{error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}</div></section>;
}
