import type { Pool } from "pg";
import { CONTEXT_CHUNK_CHARS } from "./workflow";

const CONTEXT_SCHEMA = [`CREATE TABLE IF NOT EXISTS study_mcp_task_contexts (
 task_id text PRIMARY KEY REFERENCES study_mcp_tasks(id) ON DELETE CASCADE,
 request_chars integer NOT NULL, request_bytes integer NOT NULL, request_sha256 text NOT NULL
)`, `CREATE TABLE IF NOT EXISTS study_mcp_task_context_chunks (
 task_id text NOT NULL REFERENCES study_mcp_task_contexts(task_id) ON DELETE CASCADE,
 chunk_index integer NOT NULL, text text NOT NULL, PRIMARY KEY(task_id,chunk_index)
)`];
const initializedPools = new WeakMap<Pool, Promise<unknown>>();

export async function ensureContextSchema(pool: Pool) {
  let ready = initializedPools.get(pool);
  if (!ready) {
    ready = (async () => { for (const statement of CONTEXT_SCHEMA) await pool.query(statement); })().catch(error => { initializedPools.delete(pool); throw error; });
    initializedPools.set(pool, ready);
  }
  await ready;
}

interface ContextMetadata {
  id: string;
  run_id: string;
  source: string;
  version: number;
  status: string;
  verification_required: boolean;
  preflight_required: boolean;
  active_epoch: boolean;
  validation_receipt: string | null;
  total_chars: number | null;
  request_bytes: number | null;
  request_sha256: string | null;
}
export const currentTaskEpoch = "(t.source NOT LIKE '%:epoch-%' OR t.source LIKE '%:epoch-' || COALESCE((SELECT epoch FROM study_mcp_epochs e WHERE e.owner_id=t.owner_id AND e.run_id=t.run_id),0)::text)";
export const recoverableReceipt = `CASE WHEN t.status='pending' AND t.validated_output IS NOT NULL AND ${currentTaskEpoch} THEN t.validated_output_sha256 ELSE NULL END AS validation_receipt`;
const metadataSql = `SELECT t.id,t.run_id,t.source,t.version,t.status,t.verification_required,t.preflight_required,
 ${currentTaskEpoch} AS active_epoch,${recoverableReceipt},
 c.request_chars AS total_chars,c.request_bytes,c.request_sha256
 FROM study_mcp_tasks t LEFT JOIN study_mcp_task_contexts c ON c.task_id=t.id
 WHERE t.id=$1 AND t.owner_id=$2`;

/** Materialize immutable JSON once; later pages read at most three small indexed chunks. */
export async function readCachedTaskContext(pool: Pool, ownerId: string, id: string, offset: number, limit: number) {
  await ensureContextSchema(pool);
  let task = (await pool.query<ContextMetadata>(metadataSql, [id, ownerId])).rows[0];
  if (!task) return null;
  if (task.total_chars === null) {
    // The context manifest and all its chunks commit together, including during concurrent first reads.
    await pool.query(`WITH canonical AS MATERIALIZED (
      SELECT id,request::text AS text FROM study_mcp_tasks WHERE id=$1 AND owner_id=$2
    ), inserted AS (
      INSERT INTO study_mcp_task_contexts(task_id,request_chars,request_bytes,request_sha256)
      SELECT id,char_length(text),octet_length(text),encode(sha256(convert_to(text,'UTF8')),'hex') FROM canonical
      ON CONFLICT(task_id) DO NOTHING RETURNING task_id,request_chars
    ) INSERT INTO study_mcp_task_context_chunks(task_id,chunk_index,text)
      SELECT c.id,i,substring(c.text FROM i*$3::integer+1 FOR $3::integer)
      FROM canonical c JOIN inserted m ON m.task_id=c.id
      CROSS JOIN LATERAL generate_series(0,(m.request_chars-1)/$3::integer) i`,
    [id, ownerId, CONTEXT_CHUNK_CHARS]);
    task = (await pool.query<ContextMetadata>(metadataSql, [id, ownerId])).rows[0];
    if (!task) return null;
  }
  const totalChars = task.total_chars;
  if (totalChars === null) throw new Error("The immutable task context could not be cached");
  const firstChunk = Math.floor(offset / CONTEXT_CHUNK_CHARS);
  const lastChunk = Math.floor((offset + limit - 1) / CONTEXT_CHUNK_CHARS);
  const { rows } = await pool.query<{ text: string }>(
    "SELECT text FROM study_mcp_task_context_chunks WHERE task_id=$1 AND chunk_index BETWEEN $2 AND $3 ORDER BY chunk_index",
    [id, firstChunk, lastChunk],
  );
  const text = Array.from(rows.map(chunk => chunk.text).join("")).slice(offset % CONTEXT_CHUNK_CHARS, offset % CONTEXT_CHUNK_CHARS + limit).join("");
  return { ...task, total_chars: totalChars, text };
}
