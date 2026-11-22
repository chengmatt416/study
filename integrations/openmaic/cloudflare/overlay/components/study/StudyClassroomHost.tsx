'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSettingsStore } from '@/lib/store/settings';
import { installStudyKitBridge } from '@/lib/study-classroom/adaptive';
import { useStudyResume } from '@/lib/study-classroom/progress';
import { keepClassroomSession } from '@/lib/study-classroom/session';

export function StudyClassroomHost({ hosted }: { hosted: boolean }) {
  const pathname = usePathname();
  const [sessionExpired, setSessionExpired] = useState(false);
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sessionExpired) { document.body.dataset.studySessionExpired = 'true'; notice.current?.focus(); }
    return () => { delete document.body.dataset.studySessionExpired; };
  }, [sessionExpired]);
  useEffect(() => {
    setSessionExpired(false);
    if (!hosted) return;
    const classroom = pathname?.match(/^\/classroom\/([A-Za-z0-9_-]+)\/?$/)?.[1];
    if (classroom) return keepClassroomSession(classroom, () => setSessionExpired(true));
  }, [hosted, pathname]);
  useEffect(() => { installStudyKitBridge(); }, []);
  useStudyResume();
  useEffect(() => {
    // Keep saved upstream voice settings from re-enabling narration.
    useSettingsStore.getState().setTTSMuted(true);
    useSettingsStore.getState().setAutoPlayLecture(false);
    if (window.matchMedia('(max-width: 700px)').matches) useSettingsStore.getState().setSidebarCollapsed(true);
    if (hosted && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => registration.update()).catch(() => {});
    }
  }, [hosted]);
  return sessionExpired ? <div ref={notice} tabIndex={-1} role="alert" className="study-session-expired">課堂登入已到期或變更。<a href="/">返回 STUDY 重新開課</a>後可繼續已儲存的進度。</div> : null;
}
