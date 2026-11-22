import { listActiveGenerationRuns, readGenerationRun, type StoredRun } from "@/lib/server/generation/run/store";
import type { GenerationRunInput } from "@/lib/server/generation/run/types";
import type { Pool, PoolClient } from "pg";
import { taskPool } from "./store";

const PART_INDEX = "study_mcp_generation_part_key";
const PART_EXPRESSION = String.raw`substring(input->>'requirement' FROM '\[study-long-course-part:([A-Za-z0-9_.:-]{1,128})\]$')`;
const indexedPools = new WeakMap<Pool, Promise<unknown>>();
async function ensurePartIndex(pool: Pool) {
  let ready = indexedPools.get(pool);
  if (!ready) {
    ready = pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${PART_INDEX} ON generation_runs(owner_id,(${PART_EXPRESSION}))`).catch(error => { indexedPools.delete(pool); throw error; });
    indexedPools.set(pool, ready);
  }
  await ready;
}
async function existingPart(client: PoolClient, ownerId: string, partId: string) {
  const found = await client.query<{ id: string }>(`SELECT id FROM generation_runs WHERE owner_id=$1 AND ${PART_EXPRESSION}=$2 LIMIT 1`, [ownerId, partId]);
  if (!found.rows[0]) return null;
  const existing = await readGenerationRun(found.rows[0].id, ownerId);
  if (!existing) throw new Error("The course part's native run is no longer available");
  return existing;
}

/** Clears the model turns of a run that can never ask for another, so they stop showing up as pending work. Null while the run can still ask. */
export async function clearFinishedRunTasks(ownerId: string, runId: string): Promise<number | null> {
  const run = await readGenerationRun(runId, ownerId);
  if (run && run.state !== "ended" && run.state !== "completed") return null;
  const pool = await taskPool();
  const removed = await pool.query("DELETE FROM study_mcp_tasks WHERE owner_id=$1 AND run_id=$2", [ownerId, runId]);
  await pool.query("DELETE FROM study_mcp_epochs WHERE owner_id=$1 AND run_id=$2", [ownerId, runId]);
  return removed.rowCount ?? 0;
}

export class PartStartBusyError extends Error {
  constructor() { super("This course part is already being started; retry with the same part_id"); }
}
export function partMarker(partId: string) { return `\n[study-long-course-part:${partId}]`; }

/** Recover the native run even when its creation committed before the caller lost its response. */
export async function startCoursePart(
  ownerId: string,
  partId: string,
  input: GenerationRunInput,
  start: (input: GenerationRunInput) => Promise<StoredRun>,
): Promise<{ run: StoredRun; idempotent: boolean }> {
  // The official reader bootstraps/migrates its own generation schema first.
  await listActiveGenerationRuns(ownerId);
  const pool = await taskPool();
  await ensurePartIndex(pool);
  const client = await pool.connect();
  const lock = `study.long-course.start:${ownerId}:${partId}`;
  let acquired = false;
  let broken = false;
  let heartbeat: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired", [lock]);
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) throw new PartStartBusyError();
    // The Workers pg adapter expires idle virtual sessions after 30 seconds.
    timer = setInterval(() => {
      heartbeat ??= client.query("SELECT 1").catch(() => { broken = true; }).finally(() => { heartbeat = undefined; });
    }, 10_000);
    const existing = await existingPart(client, ownerId, partId);
    if (existing) return { run: existing, idempotent: true };
    try { return { run: await start(input), idempotent: false }; }
    catch (error) {
      // The unique marker also fences a start whose advisory session was lost.
      const conflict = error as { code?: string; constraint?: string };
      if (conflict?.code !== "23505" || conflict.constraint !== PART_INDEX) throw error;
      const recovered = await existingPart(client, ownerId, partId);
      if (!recovered) throw error;
      return { run: recovered, idempotent: true };
    }
  } finally {
    clearInterval(timer);
    await heartbeat;
    if (acquired) {
      try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]); }
      catch { broken = true; }
    }
    client.release(broken);
  }
}
