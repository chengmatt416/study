'use client';
// The "your turn" hint: the teacher pointed at something in an interactive module and the learner has not operated it yet.
// The module kit draws the spotlight and laser inside the iframe; this store lets the dock say the same thing in words.
import { useSyncExternalStore } from 'react';
export interface StudyOperate { content: string; at: number }
let current: StudyOperate | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function setStudyOperate(content: unknown) {
  const text = typeof content === 'string' ? content.trim().slice(0, 200) : '';
  current = { content: text || '請操作被標示的器材', at: Date.now() };
  clearTimeout(timer); timer = setTimeout(clearStudyOperate, 90000);
  notify();
}
export function clearStudyOperate() { if (!current) return; clearTimeout(timer); current = null; notify(); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useStudyOperate = (): StudyOperate | null => useSyncExternalStore(subscribe, () => current, () => null);
