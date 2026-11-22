// Saved classroom position: the scene the learner was on, and the state of each interactive module they used.
// The module state is produced by the module kit and is only ever data: it is size-bounded here and re-validated by the kit before use.
export interface ModuleSave { at: number; state: Record<string, unknown> }
export interface ClassroomProgress { scene_id: string | null; scene_index: number | null; modules: Record<string, ModuleSave>; updated_at: number | null }
export const MAX_MODULE_BYTES = 12000;
/** Handwriting a learner left on a page is saved under `ink:<scene id>` and may be larger than a module's state. */
export const MAX_INK_BYTES = 40000;
export const MAX_MODULES = 40;
export const isInkKey = (id: string): boolean => id.startsWith('ink:');
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
export const progressId = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);

export interface ProgressUpdate { scene_id?: string; scene_index?: number; module?: { scene_id: string; state: Record<string, unknown> | null } }

/** A request body as a safe update, or the reason it is not one. */
export function parseProgressUpdate(body: unknown): ProgressUpdate | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '進度格式錯誤';
  const input = body as Record<string, unknown>; const update: ProgressUpdate = {};
  if (input.scene_id !== undefined) { const id = progressId(input.scene_id); if (!id) return 'scene_id 格式錯誤'; update.scene_id = id; }
  if (input.scene_index !== undefined) { if (typeof input.scene_index !== 'number' || !Number.isInteger(input.scene_index) || input.scene_index < 0 || input.scene_index > 5000) return 'scene_index 格式錯誤'; update.scene_index = input.scene_index; }
  if (input.module !== undefined) {
    const module = input.module as { scene_id?: unknown; state?: unknown } | null; const id = progressId(module?.scene_id);
    if (!module || !id) return 'module.scene_id 格式錯誤';
    if (module.state === null) update.module = { scene_id: id, state: null };
    else if (module.state && typeof module.state === 'object' && !Array.isArray(module.state)) {
      if (JSON.stringify(module.state).length > (isInkKey(id) ? MAX_INK_BYTES : MAX_MODULE_BYTES)) return isInkKey(id) ? '筆跡太大' : '互動模組進度太大';
      update.module = { scene_id: id, state: module.state as Record<string, unknown> };
    } else return 'module.state 必須是物件或 null';
  }
  return update.scene_id === undefined && update.module === undefined ? '沒有可儲存的進度' : update;
}

/** The saved modules after one update; the oldest are dropped past MAX_MODULES. */
export function mergeModules(modules: Record<string, ModuleSave>, update: ProgressUpdate, now: number): Record<string, ModuleSave> {
  const next = { ...modules };
  if (update.module) { if (update.module.state === null) delete next[update.module.scene_id]; else next[update.module.scene_id] = { at: now, state: update.module.state }; }
  // Modules and handwriting each keep their newest MAX_MODULES, so writing on pages never pushes module progress out.
  for (const ink of [false, true]) {
    const ids = Object.keys(next).filter(id => isInkKey(id) === ink).sort((a, b) => next[b].at - next[a].at);
    for (const id of ids.slice(MAX_MODULES)) delete next[id];
  }
  return next;
}
