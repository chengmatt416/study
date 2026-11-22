'use client';

import { useEffect, useState } from 'react';

/** The query classroom.css uses for its phone layout; keep the two identical. */
export const STUDY_PHONE_QUERY = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)';

export function useStudyPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(STUDY_PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

/** How much of the layout viewport's bottom an on-screen keyboard covers. Small gaps are browser toolbars, not keyboards. */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number }): number {
  const covered = Math.round(layoutHeight - viewport.height - viewport.offsetTop);
  return covered < 80 ? 0 : covered;
}

/** Publishes the keyboard height as --study-kb so a fixed bottom sheet can sit above the keyboard instead of behind it. */
export function useStudyKeyboardInset(active: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty('--study-kb', `${keyboardInset(window.innerHeight, viewport)}px`);
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--study-kb');
    };
  }, [active]);
}
