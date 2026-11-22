import type { Pool } from "pg";
import { CONTEXT_CHUNK_CHARS, MODEL_WORKFLOW } from "./workflow";
import { currentTaskEpoch, readCachedTaskContext, recoverableReceipt } from "./task-context";

export class McpQueryError extends Error {}
function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new McpQueryError(`Expected an integer from ${min} to ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new McpQueryError(`Expected an integer from ${min} to ${max}`);
  return parsed;
}
function cursorParts(cursor: string | null): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    if (cursor.length > 512) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !Number.isFinite(Date.parse(value[0])) || typeof value[1] !== "string" || value[1].length > 200) throw new Error();
    return [value[0], value[1]];
  } catch { throw new McpQueryError("Invalid task cursor"); }
}

export async function listTasks(pool: Pool, ownerId: string, params: URLSearchParams) {
  const summary = params.get("summary") === "1";
  const limit = summary ? numberParam(params.get("limit"), 1, 1, 20) : 1;
  const status = params.get("status") ?? "pending";
  if (!["pending", "answered", "all"].includes(status)) throw new McpQueryError("status must be pending, answered or all");
  const [afterTime, afterId] = cursorParts(params.get("cursor"));
  const fields = summary ? "id,run_id,source,version,status,created_at,request_bytes,request_sha256,verification_required,preflight_required" : "id,run_id,source,request,version,status,created_at,request_bytes,request_sha256,verification_required,preflight_required";
  const { rows } = await pool.query(
    `SELECT ${fields},${recoverableReceipt},to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM study_mcp_tasks t WHERE owner_id=$1 AND ($2::text IS NULL OR run_id=$2) AND ($3='all' OR status=$3) AND ${currentTaskEpoch} AND ($4::timestamptz IS NULL OR (created_at,id)>($4::timestamptz,$5::text)) ORDER BY created_at,id LIMIT $6`,
    [ownerId, params.get("run_id"), status, afterTime, afterId, limit + (summary ? 1 : 0)],
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  // The whole request travels with a full listing, so the reader has it.
  if (!summary && page.length) await pool.query("UPDATE study_mcp_tasks SET context_read=true WHERE owner_id=$1 AND id=ANY($2::text[]) AND status='pending'", [ownerId, page.map(row => row.id)]);
  return {
    tasks: page.map(({ cursor_created_at: _cursor, ...row }) => ({ ...row, next_action: row.validation_receipt ? "submit_openmaic_core_step" : row.status === "pending" ? "get_openmaic_core_task_context" : "get_openmaic_core_step", ...(summary ? { context_endpoint: `/api/study-mcp/tasks/${encodeURIComponent(row.id)}?offset=0&limit=${CONTEXT_CHUNK_CHARS}` } : {}) })),
    next_cursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.cursor_created_at, last.id])).toString("base64url") : null,
    workflow: MODEL_WORKFLOW,
    next_action: page.length
      ? "A pending task with validation_receipt already has a stored reviewed draft: resume by submitting its id as task_id, version as expected_version and validation_receipt only, omitting output. Otherwise read the complete context with the paginated endpoint before drafting, independently self-check and correct it, call validate_openmaic_core_step, and fix all reported errors before receipt-only submission. Follow next_cursor for more tasks; do not replay answered history. The official core executes tools and validates later stages."
      : "No pending model turn yet. Poll the run status and tasks again; do not invent a task or stop at an outline.",
  };
}

export async function taskContext(pool: Pool, ownerId: string, id: string, params: URLSearchParams) {
  const offset = numberParam(params.get("offset"), 0, 0, 100_000_000);
  const limit = numberParam(params.get("limit"), CONTEXT_CHUNK_CHARS, 1, 48_000);
  const task = await readCachedTaskContext(pool, ownerId, id, offset, limit);
  if (!task) return null;
  if (offset > task.total_chars) throw new McpQueryError("offset exceeds task context length");
  const end = Math.min(task.total_chars, offset + limit);
  // Reading counts only from where the last page stopped, so the end cannot be fetched alone to unlock validation.
  // `peek` is the platform looking at a task for its own checks, which is not the author reading it.
  let contextRead = false;
  if (params.get("peek") !== "1" && task.status === "pending") {
    const marked = await pool.query<{ context_read: boolean }>(
      "UPDATE study_mcp_tasks SET context_read_chars=GREATEST(context_read_chars,$3::integer),context_read=context_read OR $3::integer>=$4::integer WHERE id=$1 AND owner_id=$2 AND context_read_chars>=$5::integer RETURNING context_read",
      [id, ownerId, end, task.total_chars, offset],
    );
    contextRead = marked.rows[0]?.context_read === true;
  }
  const nextAction = task.status !== "pending" || !task.active_epoch ? "get_openmaic_core_step" : task.validation_receipt ? "submit_openmaic_core_step" : end < task.total_chars ? "get_openmaic_core_task_context" : "validate_openmaic_core_step";
  return { ...task, offset, next_offset: end < task.total_chars ? end : null, context_read: contextRead, next_action: nextAction, offset_unit: "unicode_codepoints", content_type: "application/json", workflow: MODEL_WORKFLOW };
}
