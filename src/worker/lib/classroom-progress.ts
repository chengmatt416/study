import type { ClassroomProgress, ModuleSave, ProgressUpdate } from '../../shared/classroom-progress';
import { mergeModules } from '../../shared/classroom-progress';

export async function getClassroomProgress(env: Pick<Env, 'DB'>, userId: string, classroom: string): Promise<ClassroomProgress> {
  const row = await env.DB.prepare('SELECT scene_id,scene_index,modules_json,updated_at FROM classroom_progress WHERE user_id=? AND classroom_id=?').bind(userId, classroom).first<{ scene_id: string | null; scene_index: number | null; modules_json: string; updated_at: number }>();
  if (!row) return { scene_id: null, scene_index: null, modules: {}, updated_at: null };
  let modules: Record<string, ModuleSave> = {};
  try { const parsed = JSON.parse(row.modules_json); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) modules = parsed; } catch { /* a damaged row is treated as no module progress */ }
  return { scene_id: row.scene_id, scene_index: row.scene_index, modules, updated_at: row.updated_at };
}

export async function saveClassroomProgress(env: Pick<Env, 'DB'>, userId: string, classroom: string, update: ProgressUpdate, now = Date.now()): Promise<void> {
  const current = await getClassroomProgress(env, userId, classroom);
  const modules = mergeModules(current.modules, update, now);
  await env.DB.prepare(`INSERT INTO classroom_progress(user_id,classroom_id,scene_id,scene_index,modules_json,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,classroom_id) DO UPDATE SET scene_id=COALESCE(excluded.scene_id,scene_id),scene_index=COALESCE(excluded.scene_index,scene_index),modules_json=excluded.modules_json,updated_at=excluded.updated_at`)
    .bind(userId, classroom, update.scene_id ?? null, update.scene_index ?? null, JSON.stringify(modules), now).run();
}
