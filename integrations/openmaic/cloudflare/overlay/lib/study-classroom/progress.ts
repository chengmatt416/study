'use client';
// Unsynced changes stay in an owner-scoped outbox until the server acknowledges them.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStageStore } from '@/lib/store/stage';
import { unlockStudyPanel } from './lock';
import { cachedChanges, emptyProgress, mergePendingProgress, ProgressQueue, type ProgressBody, type SavedProgress } from './progress-sync';
export type { SavedProgress } from './progress-sync';

const ENDPOINT = '/api/openmaic/live/progress';
let loaded: Promise<SavedProgress> | null = null;
let saved = emptyProgress();
let pending = new ProgressQueue();
let timer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;
let warned = false;
let scope = '';
let generation = 0;
let retryable = true;
let confirmed = false;
let flushing: Promise<void> | null = null;

const cacheKey = (owner: string) => 'study-progress-v2:' + owner + ':' + scope;
const classroomId = () => /^\/classroom\/([A-Za-z0-9_-]+)\/?$/.exec(scope)?.[1] ?? '';
const readCache = (owner: string): unknown => { try { return JSON.parse(localStorage.getItem(cacheKey(owner)) ?? 'null'); } catch { return null; } };
const writeCache = () => {
  if (!saved.owner_id) return;
  try { localStorage.setItem(cacheKey(saved.owner_id), JSON.stringify({ v: 2, owner_id: saved.owner_id, pending: pending.snapshot() })); }
  catch { /* private mode or full: in-memory changes are still retried */ }
};
function currentScope() {
  const path = typeof location === 'undefined' ? '' : location.pathname;
  if (scope === path) return;
  scope = path; generation++; loaded = null; saved = emptyProgress(); pending = new ProgressQueue();
  confirmed = false; retryable = true;
  clearTimeout(timer); timer = undefined; retryDelay = 2000; warned = false;
}
const schedule = (delay = 1000) => { if (retryable && pending.size && !timer) timer = setTimeout(() => { timer = undefined; void flushStudyProgress(); }, delay); };

export function loadStudyProgress(): Promise<SavedProgress> {
  currentScope();
  if (loaded) return loaded;
  const asked = generation;
  retryable = true; confirmed = false;
  const request = fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000) })
    .then(async response => {
      if (!response.ok) {
        if ([401, 403].includes(response.status) && asked === generation) { writeCache(); retryable = false; }
        throw new Error(String(response.status));
      }
      const value = await response.json() as SavedProgress;
      if (asked !== generation) return emptyProgress();
      if (typeof value.owner_id !== 'string' || !value.owner_id) { loaded = null; return emptyProgress(); }
      if (!value.classroom_id) { loaded = null; return emptyProgress(); }
      if (value.classroom_id !== classroomId()) { loaded = null; retryable = false; return emptyProgress(); }
      const server: SavedProgress = { owner_id: value.owner_id, classroom_id: value.classroom_id, scene_id: value.scene_id ?? null, scene_index: value.scene_index ?? null, modules: value.modules ?? {}, updated_at: value.updated_at ?? null };
      const local = saved.owner_id && saved.owner_id !== server.owner_id ? new ProgressQueue() : pending;
      const cached = mergePendingProgress(server, cachedChanges(readCache(server.owner_id!), server.owner_id!));
      // Edits made while this read was in flight belong to the current page and take precedence over its disk copy.
      const merged = mergePendingProgress(cached.saved, local.snapshot());
      pending = new ProgressQueue({ scene: merged.pending.scene ?? cached.pending.scene, modules: { ...cached.pending.modules, ...merged.pending.modules } });
      saved = mergePendingProgress(server, pending.snapshot()).saved;
      confirmed = true;
      writeCache(); schedule(); return saved;
    })
    .catch(() => {
      // Authentication must be confirmed before reading another person's cached state on a shared browser.
      if (asked === generation) loaded = null;
      return emptyProgress();
    });
  loaded = request;
  return request;
}

async function put(body: ProgressBody, owner: string, classroom: string, asked: number): Promise<boolean> {
  if (asked !== generation || !confirmed || saved.owner_id !== owner || saved.classroom_id !== classroom) return false;
  try {
    const response = await fetch(ENDPOINT, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, owner_id: owner, classroom_id: classroom }), keepalive: true, signal: AbortSignal.timeout(12000) });
    if (asked !== generation) return false;
    if ([401, 403, 409].includes(response.status)) {
      writeCache(); loaded = null; confirmed = false; retryable = false;
      return false;
    }
    retryable = response.ok || response.status === 429 || response.status >= 500;
    return response.ok;
  } catch { if (asked === generation) retryable = true; return false; }
}
export function flushStudyProgress(): Promise<void> {
  currentScope(); clearTimeout(timer); timer = undefined;
  if (flushing) return flushing;
  flushing = writeProgress().finally(() => { flushing = null; if (retryable && pending.size) schedule(retryDelay); });
  return flushing;
}
async function writeProgress(): Promise<void> {
  if (!pending.size) return;
  await loadStudyProgress();
  const owner = saved.owner_id;
  if (!confirmed || !owner) { if (retryable) { schedule(retryDelay); retryDelay = Math.min(30000, retryDelay * 2); } return; }
  const asked = generation, outbox = pending, classroom = classroomId();
  retryable = true;
  const ok = await outbox.flush(body => put(body, owner, classroom, asked), (body, change) => {
    if (asked !== generation) return;
    if (outbox !== pending) {
      if ('scene_id' in body && pending.scene === change) pending.scene = null;
      else if ('module' in body && pending.modules.get(body.module.scene_id) === change) pending.modules.delete(body.module.scene_id);
    }
    writeCache();
  });
  if (asked !== generation) return;
  writeCache();
  if (ok) {
    retryDelay = 2000;
    if (!pending.size) { if (warned) toast.success('學習進度已同步'); warned = false; }
  } else {
    if (!warned) toast.warning(retryable ? '進度尚未同步，連線恢復後會再試一次' : '進度暫時無法同步，請重新開啟課堂');
    warned = true;
    if (retryable && pending.size) { schedule(retryDelay); retryDelay = Math.min(30000, retryDelay * 2); }
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushStudyProgress());
  window.addEventListener('online', () => { loaded = null; void flushStudyProgress(); });
}

export function saveStudyScene(sceneId: string, index: number) {
  currentScope();
  saved = { ...saved, scene_id: sceneId, scene_index: index };
  pending.saveScene(sceneId, index, Date.now()); writeCache(); schedule();
}
export function saveStudyModule(sceneId: string, state: Record<string, unknown> | null) {
  currentScope();
  const at = Date.now(), modules = { ...saved.modules };
  if (state) modules[sceneId] = { at, state }; else delete modules[sceneId];
  saved = { ...saved, modules };
  pending.saveModule(sceneId, state, at); writeCache(); schedule();
}
export async function savedModuleState(sceneId: string): Promise<Record<string, unknown> | null> {
  await loadStudyProgress();
  return saved.modules[sceneId]?.state ?? null;
}
/** The scene an interactive iframe belongs to; Core titles each pooled frame "Interactive Scene <id>". */
export function sceneOfFrame(source: unknown): string | null {
  for (const frame of Array.from(document.querySelectorAll('iframe'))) if (frame.contentWindow === source) return /^Interactive Scene (.+)$/.exec(frame.title)?.[1] ?? null;
  return null;
}

/** Brings the learner back to the scene they left, then keeps saving the scene they are on. */
export function useStudyResume() {
  const key = useStageStore(state => state.scenes.map(scene => scene.id).join('|'));
  const currentId = useStageStore(state => state.currentSceneId);
  const [resumed, setResumed] = useState('');
  const [attempt, setAttempt] = useState(0);
  const asked = useRef('');
  const resumeDelay = useRef(2000);
  useEffect(() => { const retry = () => { asked.current = ''; setAttempt(value => value + 1); }; window.addEventListener('online', retry); return () => window.removeEventListener('online', retry); }, []);
  useEffect(() => {
    if (!key || asked.current === key) return;
    asked.current = key;
    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void loadStudyProgress().then(progress => {
      if (!alive) return;
      if (!progress.owner_id) {
        if (retryable) { retryTimer = setTimeout(() => { asked.current = ''; setAttempt(value => value + 1); }, resumeDelay.current); resumeDelay.current = Math.min(30000, resumeDelay.current * 2); }
        return;
      }
      resumeDelay.current = 2000;
      const store = useStageStore.getState();
      for (const sceneId of Object.keys(progress.modules)) if (!sceneId.startsWith('ink:')) unlockStudyPanel(sceneId);
      const target = progress.scene_id && store.scenes.some(scene => scene.id === progress.scene_id) ? progress.scene_id : null;
      if (target && target !== store.currentSceneId && store.scenes[0]?.id === store.currentSceneId) {
        store.setCurrentSceneId(target);
        toast(`已回到上次的進度：${store.scenes.find(scene => scene.id === target)?.title ?? ''}`, { duration: 3500 });
      }
      setResumed(key);
    });
    return () => { alive = false; clearTimeout(retryTimer); };
  }, [key, attempt]);
  useEffect(() => {
    if (!key || resumed !== key || !currentId) return;
    const index = useStageStore.getState().scenes.findIndex(scene => scene.id === currentId);
    if (index >= 0) saveStudyScene(currentId, index);
  }, [currentId, key, resumed]);
}
