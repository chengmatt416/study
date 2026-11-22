'use client';
// 提問與討論 on a phone: the whole conversation as a transcript, and a way to step away to the lesson and come back.
// The live session itself is untouched by stepping away (it keeps running and keeps its place); only the sheet hides.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useStageStore } from '@/lib/store/stage';

export interface LogMessage { id: string; role: 'user' | 'teacher' | 'agent'; name: string; color: string | null; text: string }
export interface LogSession { id: string; type: 'qa' | 'discussion'; title: string; status: string; messages: LogMessage[] }
export interface ChatLike {
  id: string; type: string; title: string; status: string; sceneId?: string; createdAt?: number;
  messages: { id: string; role: string; parts?: { type: string; text?: string }[]; metadata?: { senderName?: string; originalRole?: string; agentColor?: string } }[];
}

const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/-]{3,40}\))$/i;
const NAMES = { user: '你', teacher: '老師', agent: '同學' } as const;

/** The questions and discussions of one scene as transcript sessions. Lectures and messages with no text are left out. */
export function discussionLog(chats: readonly ChatLike[], sceneId: string | null): LogSession[] {
  return chats
    .filter(chat => (chat.type === 'qa' || chat.type === 'discussion') && (!chat.sceneId || !sceneId || chat.sceneId === sceneId))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(chat => ({
      id: chat.id, type: chat.type as 'qa' | 'discussion', title: chat.title, status: chat.status,
      messages: chat.messages.flatMap<LogMessage>(message => {
        const text = (message.parts ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim();
        if (!text) return [];
        const role: LogMessage['role'] = message.metadata?.originalRole === 'teacher' || message.metadata?.originalRole === 'agent' || message.metadata?.originalRole === 'user'
          ? message.metadata.originalRole : message.role === 'user' ? 'user' : 'agent';
        const color = message.metadata?.agentColor?.trim();
        return [{ id: message.id, role, name: message.metadata?.senderName?.trim() || NAMES[role], color: color && COLOR.test(color) ? color : null, text }];
      }),
    }))
    .filter(session => session.messages.length > 0);
}
export const logMessageCount = (log: readonly LogSession[]): number => log.reduce((sum, session) => sum + session.messages.length, 0);

let minimized = false; let seen = 0; let totalNow = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** Hides or shows the sheet. Hiding remembers how many messages were read, so the pill can say how many are new. */
export function setStudyDiscussionMinimized(value: boolean) { if (minimized === value && seen === totalNow) return; minimized = value; seen = totalNow; notify(); }

export function useStudyDiscussion(): { minimized: boolean; unread: number; total: number } {
  const chats = useStageStore(state => state.chats) as unknown as ChatLike[];
  const sceneId = useStageStore(state => state.currentSceneId);
  const total = useMemo(() => logMessageCount(discussionLog(chats, sceneId)), [chats, sceneId]);
  const away = useSyncExternalStore(subscribe, () => minimized, () => false);
  const read = useSyncExternalStore(subscribe, () => seen, () => 0);
  useEffect(() => { totalNow = total; if (!minimized) { seen = total; } notify(); }, [total]);
  useEffect(() => { minimized = false; seen = totalNow; notify(); }, [sceneId]);
  return { minimized: away, unread: away ? Math.max(0, total - read) : 0, total };
}
