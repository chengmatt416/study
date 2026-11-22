export interface SavedProgress {
  owner_id?: string;
  classroom_id?: string;
  scene_id: string | null;
  scene_index: number | null;
  modules: Record<string, { at: number; state: Record<string, unknown> }>;
  updated_at?: number | null;
}
export interface SceneChange { at: number; id: string; index: number }
export interface ModuleChange { at: number; state: Record<string, unknown> | null }
export interface PendingProgress { scene: SceneChange | null; modules: Record<string, ModuleChange> }
export type ProgressBody = { scene_id: string; scene_index: number } | { module: { scene_id: string; state: Record<string, unknown> | null } };
export const emptyProgress = (): SavedProgress => ({ scene_id: null, scene_index: null, modules: {} });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

/** Only unacknowledged changes are replayed, and only for the authenticated owner that created them. */
export function cachedChanges(value: unknown, ownerId: string): PendingProgress {
  const empty: PendingProgress = { scene: null, modules: {} };
  if (!record(value) || value.v !== 2 || value.owner_id !== ownerId || !record(value.pending)) return empty;
  const pending = value.pending;
  const rawScene = pending.scene;
  const scene = record(rawScene) && timestamp(rawScene.at) && id(rawScene.id) && typeof rawScene.index === 'number' && Number.isInteger(rawScene.index) && rawScene.index >= 0 && rawScene.index <= 5000
    ? { at: rawScene.at, id: rawScene.id, index: rawScene.index } : null;
  const modules = record(pending.modules) ? Object.fromEntries(Object.entries(pending.modules).filter(([key, item]) => id(key) && record(item) && timestamp(item.at) && (item.state === null || record(item.state))).sort(([, a], [, b]) => (b as ModuleChange).at - (a as ModuleChange).at).slice(0, 80)) as Record<string, ModuleChange> : {};
  return { scene, modules };
}

export function mergePendingProgress(server: SavedProgress, pending: PendingProgress): { saved: SavedProgress; pending: PendingProgress } {
  const saved = { ...server, modules: { ...server.modules } };
  const scene = pending.scene && pending.scene.at > (server.updated_at ?? 0) ? pending.scene : null;
  if (scene) { saved.scene_id = scene.id; saved.scene_index = scene.index; saved.updated_at = scene.at; }
  const modules: Record<string, ModuleChange> = {};
  for (const [key, item] of Object.entries(pending.modules)) {
    if (item.at <= (server.modules[key]?.at ?? 0)) continue;
    modules[key] = item;
    if (item.state === null) delete saved.modules[key]; else saved.modules[key] = { at: item.at, state: item.state };
  }
  return { saved, pending: { scene, modules } };
}

/** Keep writes serial and retain failed changes; a newer edit cannot be acknowledged by an older request. */
export class ProgressQueue {
  scene: SceneChange | null = null;
  modules = new Map<string, ModuleChange>();
  private inFlight: Promise<boolean> | null = null;
  constructor(pending?: PendingProgress) { if (pending) this.restore(pending); }
  restore(pending: PendingProgress) { this.scene = pending.scene; this.modules = new Map(Object.entries(pending.modules)); }
  snapshot(): PendingProgress { return { scene: this.scene, modules: Object.fromEntries(this.modules) }; }
  get size() { return (this.scene ? 1 : 0) + this.modules.size; }
  saveScene(sceneId: string, index: number, at: number) { this.scene = { at, id: sceneId, index }; }
  saveModule(sceneId: string, state: Record<string, unknown> | null, at: number) { this.modules.set(sceneId, { at, state }); }
  flush(send: (body: ProgressBody) => Promise<boolean>, acknowledged: (body: ProgressBody, change: SceneChange | ModuleChange) => void = () => {}): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.write(send, acknowledged).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  private async write(send: (body: ProgressBody) => Promise<boolean>, acknowledged: (body: ProgressBody, change: SceneChange | ModuleChange) => void): Promise<boolean> {
    while (this.size) {
      const scene = this.scene;
      if (scene) {
        try { if (!await send({ scene_id: scene.id, scene_index: scene.index })) return false; } catch { return false; }
        if (this.scene === scene) this.scene = null;
        acknowledged({ scene_id: scene.id, scene_index: scene.index }, scene);
      }
      for (const [sceneId, change] of [...this.modules]) {
        try { if (!await send({ module: { scene_id: sceneId, state: change.state } })) return false; } catch { return false; }
        if (this.modules.get(sceneId) === change) this.modules.delete(sceneId);
        acknowledged({ module: { scene_id: sceneId, state: change.state } }, change);
      }
    }
    return true;
  }
}
