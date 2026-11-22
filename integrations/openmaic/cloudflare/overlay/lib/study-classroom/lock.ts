'use client';
// The interactive panel of a scene stays locked until the teacher's dialogue tells the learner to operate it, so the
// lesson is followed in order. The dock registers the scene and unlocks it; the panel host reads this store.
import { useSyncExternalStore } from 'react';
export type LockPhase = 'waiting' | 'speaking';
interface Lock { phase: LockPhase }
let locks: Record<string, Lock> = {};
const unlocked = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => { locks = { ...locks }; for (const listener of listeners) listener(); };

/** Registers an interactive scene as locked (unless it was unlocked already); `started` tells whether the dialogue has begun. */
export function lockStudyPanel(sceneId: string, started: boolean) {
  if (unlocked.has(sceneId)) return;
  const phase: LockPhase = started ? 'speaking' : 'waiting';
  if (locks[sceneId]?.phase === phase) return;
  locks[sceneId] = { phase }; notify();
}
export function unlockStudyPanel(sceneId: string) {
  if (unlocked.has(sceneId) && !locks[sceneId]) return;
  unlocked.add(sceneId); delete locks[sceneId]; notify();
}
/** Forgets everything, for a different classroom. */
export function resetStudyPanelLocks() { unlocked.clear(); locks = {}; notify(); }
export const isStudyPanelLocked = (sceneId: string): boolean => !!locks[sceneId];
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** The lock on a scene's panel, or null when it is open. */
export const useStudyPanelLock = (sceneId: string): Lock | null => useSyncExternalStore(subscribe, () => locks[sceneId] ?? null, () => null);

/** Whether a scene's dialogue has reached the point where the learner should operate the panel. */
export const shouldUnlockPanel = (input: { completed: boolean; cue: boolean; hasDialogue: boolean }): boolean => input.completed || input.cue || !input.hasDialogue;
