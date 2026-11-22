import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getServerPersistenceProvider } from "@/lib/persistence/server-provider";
import { mcpScope } from "./context";
import { outputErrors } from "./output-validation";
import { MAX_CONTEXT_BYTES, reviewEvidence, verificationErrors, type McpVerification } from "./workflow";

export interface McpOutput {
  text: string;
  verification?: McpVerification;
  tool_calls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
}
export interface McpTask {
  id: string;
  owner_id: string;
  run_id: string;
  source: string;
  request?: unknown;
  request_bytes: number | null;
  request_sha256: string | null;
  verification_required: boolean;
  preflight_required: boolean;
  validation_revision: number;
  context_read?: boolean;
  context_read_chars?: number;
  validated_output_sha256?: string | null;
  response: McpOutput | null;
  version: number;
  status: "pending" | "answered";
  created_at: string;
}
export const TASK_SCHEMA = `CREATE TABLE IF NOT EXISTS study_mcp_tasks (
 id text PRIMARY KEY, owner_id text NOT NULL, run_id text NOT NULL, fingerprint text NOT NULL,
 source text NOT NULL, request jsonb NOT NULL, response jsonb, version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,run_id,fingerprint)
); ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS request_bytes integer;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS request_sha256 text;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS preflight_required boolean NOT NULL DEFAULT false;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS validated_output_sha256 text;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS validated_output jsonb;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS validation_revision integer NOT NULL DEFAULT 0;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS context_read_chars integer NOT NULL DEFAULT 0;
ALTER TABLE study_mcp_tasks ADD COLUMN IF NOT EXISTS context_read boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS study_mcp_epochs(owner_id text NOT NULL,run_id text NOT NULL,epoch integer NOT NULL DEFAULT 0,last_command text,PRIMARY KEY(owner_id,run_id)); CREATE INDEX IF NOT EXISTS study_mcp_tasks_owner_pending ON study_mcp_tasks(owner_id,status,created_at,id);
CREATE INDEX IF NOT EXISTS study_mcp_tasks_run_pending ON study_mcp_tasks(owner_id,run_id,status,created_at,id);`;
const initializedPools = new WeakMap<Pool, Promise<unknown>>();
function identityJson(request: unknown): string {
  if (request && typeof request === "object" && !Array.isArray(request) && (request as { workflow?: { protocol?: string } }).workflow?.protocol === "study-model-review/v1") {
    const { workflow: _workflow, ...original } = request as Record<string, unknown>;
    return JSON.stringify(original);
  }
  return JSON.stringify(request);
}
export async function taskPool(): Promise<Pool> {
  const { pool } = await getServerPersistenceProvider(
    process.env.DATABASE_URL ?? "",
  );
  let initialized = initializedPools.get(pool);
  if (!initialized) {
    initialized = pool.query(TASK_SCHEMA).catch(error => { initializedPools.delete(pool); throw error; });
    initializedPools.set(pool, initialized);
  }
  await initialized;
  return pool;
}
export function validOutput(value: unknown): value is McpOutput {
  if (!value || typeof value !== "object") return false;
  const v = value as McpOutput;
  return (
    typeof v.text === "string" &&
    v.text.length <= 2_000_000 &&
    (v.tool_calls === undefined ||
      (Array.isArray(v.tool_calls) &&
        v.tool_calls.length <= 64 &&
        v.tool_calls.every(
          (t) =>
            t !== null &&
            typeof t === "object" &&
            typeof t.id === "string" &&
            !!t.id &&
            typeof t.name === "string" &&
            !!t.name &&
            t.arguments !== null &&
            typeof t.arguments === "object" &&
            !Array.isArray(t.arguments),
        ) &&
        new Set(v.tool_calls.map((t) => t.id)).size === v.tool_calls.length)) &&
    (v.text.trim().length > 0 || !!v.tool_calls?.length)
  );
}
export async function enqueueTask(
  pool: Pool,
  ownerId: string,
  runId: string,
  source: string,
  request: unknown,
  ordinal: number,
): Promise<McpTask> {
  const json = JSON.stringify(request);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_CONTEXT_BYTES)
    throw new Error(
      "MCP model context exceeds 24 MB; split the source into bounded course volumes",
    );
  const fingerprint = createHash("sha256")
    .update(`${source}\n${identityJson(request)}\n${ordinal}`)
    .digest("hex");
  const result = await pool.query<McpTask>(
    `WITH payload AS (SELECT $6::jsonb AS value) INSERT INTO study_mcp_tasks(id,owner_id,run_id,fingerprint,source,request,request_bytes,request_sha256,verification_required,preflight_required) SELECT $1,$2,$3,$4,$5,value,octet_length(value::text),encode(sha256(convert_to(value::text,'UTF8')),'hex'),$7,$8 FROM payload WHERE true ON CONFLICT(owner_id,run_id,fingerprint) DO UPDATE SET fingerprint=excluded.fingerprint RETURNING id,owner_id,run_id,source,response,version,status,created_at,request_bytes,request_sha256,verification_required,preflight_required`,
    [randomUUID(), ownerId, runId, fingerprint, source, json, (request as { workflow?: { verification_required?: boolean } } | null)?.workflow?.verification_required === true, (request as { workflow?: { preflight_required?: boolean } } | null)?.workflow?.preflight_required === true],
  );
  return result.rows[0];
}
const activeEpoch = `(source NOT LIKE '%:epoch-%' OR source LIKE '%:epoch-' || COALESCE((SELECT epoch FROM study_mcp_epochs e WHERE e.owner_id=study_mcp_tasks.owner_id AND e.run_id=study_mcp_tasks.run_id),0)::text)`;
async function pendingTask(pool: Pool, ownerId: string, id: string, version: number) {
  const task = await pool.query<McpTask>(
    `SELECT jsonb_build_object('tools',request->'tools','toolChoice',request->'toolChoice','responseFormat',request->'responseFormat') AS request,run_id,request_sha256,verification_required,preflight_required,validated_output_sha256,validation_revision,context_read,context_read_chars FROM study_mcp_tasks WHERE id=$1 AND owner_id=$2 AND version=$3 AND status='pending' AND ${activeEpoch}`,
    [id, ownerId, version],
  );
  return task.rows[0] ?? null;
}
function checkedOutput(task: McpTask, output: McpOutput) {
  return [
    ...outputErrors(task.request, output),
    ...(task.verification_required ? verificationErrors(output.verification, task.request_sha256 ?? "") : []),
  ].slice(0, 30);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Hash the effective answer and its review, independent of JSON object property order. */
export function outputDigest(output: McpOutput): string {
  return createHash("sha256").update(JSON.stringify(canonical({ text: output.text, tool_calls: output.tool_calls ?? [], verification: output.verification ?? null }))).digest("hex");
}
const evidenceKey = (review: McpVerification | undefined) => JSON.stringify(reviewEvidence(review).sort());
/** A reviewed draft must come from the task it answers and from a review written for it. */
async function reviewProcessErrors(pool: Pool, ownerId: string, id: string, task: McpTask, output: McpOutput): Promise<string[]> {
  if (!task.verification_required) return [];
  // Nothing can be planned or checked against a request that was never read to its end.
  if (!task.context_read) return [`Read the complete task before drafting: call get_openmaic_core_task_context from offset 0 and follow next_offset until it is null (${task.context_read_chars ?? 0} characters read so far). The request ends with the scene this turn is for.`];
  const previous = await pool.query<{ verification: McpVerification | null }>(
    "SELECT response->'verification' AS verification FROM study_mcp_tasks WHERE owner_id=$1 AND run_id=$2 AND status='answered' AND id<>$3 ORDER BY created_at DESC,id DESC LIMIT 1",
    [ownerId, task.run_id, id],
  );
  const last = previous.rows[0]?.verification ?? undefined;
  if (last && reviewEvidence(output.verification).length && evidenceKey(last) === evidenceKey(output.verification))
    return ["verification repeats the previous turn's evidence word for word. Review this draft and write what you checked in it: the numbers recomputed, the source pages compared, the options or controls examined."];
  return [];
}
export async function validateTask(pool: Pool, ownerId: string, id: string, version: number, output: McpOutput) {
  if (!validOutput(output)) throw new Error("Invalid MCP output");
  const task = await pendingTask(pool, ownerId, id, version);
  if (!task) return null;
  const errors = checkedOutput(task, output);
  if (!errors.length) errors.push(...await reviewProcessErrors(pool, ownerId, id, task, output));
  if (errors.length) {
    // A failed replacement invalidates the old draft, but cannot erase a newer parallel validation.
    const cleared = await pool.query(`UPDATE study_mcp_tasks SET validated_output_sha256=NULL,validated_output=NULL,validation_revision=validation_revision+1 WHERE id=$1 AND owner_id=$2 AND version=$3 AND validation_revision=$4 AND status='pending' AND ${activeEpoch} RETURNING id`, [id, ownerId, version, task.validation_revision]);
    if (!cleared.rows[0] && !await pendingTask(pool, ownerId, id, version)) return null;
    return { ok: false as const, task_id: id, expected_version: version, errors, next_action: "Correct the draft and self-review, then validate again. This task has not advanced. If another reviewer ran concurrently, reload the task's current receipt before continuing." };
  }
  const digest = outputDigest(output);
  const saved = await pool.query(`UPDATE study_mcp_tasks SET validated_output_sha256=$1,validated_output=$5::jsonb,validation_revision=validation_revision+1 WHERE id=$2 AND owner_id=$3 AND version=$4 AND validation_revision=$6 AND status='pending' AND ${activeEpoch} RETURNING id`, [digest, id, ownerId, version, JSON.stringify(output), task.validation_revision]);
  if (!saved.rows[0]) return null;
  return { ok: true as const, task_id: id, expected_version: version, validation_receipt: digest, errors: [], next_action: "Submit only task_id, expected_version and validation_receipt; omit output so the stored verified draft is committed without resending large text. If supplying output it must match exactly. Editing text, tool calls or review requires validation again. No tools were executed; semantic/scientific and browser checks remain the author's responsibility." };
}
export async function submitTask(
  pool: Pool,
  ownerId: string,
  id: string,
  version: number,
  output: McpOutput | undefined,
  validationReceipt?: string,
): Promise<McpTask | null> {
  if (output === undefined) {
    if (typeof validationReceipt !== "string" || !/^[a-f0-9]{64}$/.test(validationReceipt)) throw new McpSubmissionError(["Provide the validation_receipt from validate_openmaic_core_step"]);
    const committed = await pool.query<McpTask>(
      `UPDATE study_mcp_tasks SET response=validated_output,validated_output=NULL,validated_output_sha256=NULL,status='answered',version=version+1 WHERE id=$1 AND owner_id=$2 AND version=$3 AND status='pending' AND validated_output IS NOT NULL AND validated_output_sha256=$4 AND ${activeEpoch} RETURNING id,owner_id,run_id,source,version,status,created_at`,
      [id, ownerId, version, validationReceipt],
    );
    if (committed.rows[0]) return committed.rows[0];
    if (await pendingTask(pool, ownerId, id, version)) throw new McpSubmissionError(["No matching reviewed draft; validate again to obtain the current validation_receipt"]);
    return null;
  }
  if (!validOutput(output)) throw new Error("Invalid MCP output");
  const task = await pendingTask(pool, ownerId, id, version);
  if (!task) return null;
  const errors = checkedOutput(task, output);
  const digest = outputDigest(output);
  if (task.preflight_required && (!task.validated_output_sha256 || validationReceipt !== digest || task.validated_output_sha256 !== digest))
    errors.push("Validate this exact reviewed output first with validate_openmaic_core_step and submit its validation_receipt; edits require validation again");
  if (errors.length) throw new McpSubmissionError(errors);
  const result = await pool.query<McpTask>(
    `UPDATE study_mcp_tasks SET response=$1::jsonb,validated_output=NULL,validated_output_sha256=NULL,status='answered',version=version+1 WHERE id=$2 AND owner_id=$3 AND version=$4 AND status='pending' AND ${activeEpoch} AND (NOT preflight_required OR validated_output_sha256=$5) RETURNING id,owner_id,run_id,source,version,status,created_at`,
    [JSON.stringify(output), id, ownerId, version, digest],
  );
  return result.rows[0] ?? null;
}
export class McpSubmissionError extends Error {
  constructor(public readonly errors: string[]) { super(errors.join("; ")); }
}
export async function requestMcpOutput(
  ownerId: string,
  source: string,
  request: unknown,
  signal?: AbortSignal,
  resolutionId = randomUUID(),
): Promise<McpOutput> {
  if (!ownerId.startsWith("study:"))
    throw new Error("MCP model requests require an authenticated STUDY owner");
  const pool = await taskPool();
  const scope = mcpScope.getStore();
  const hash = createHash("sha256")
    .update(`${source}\n${identityJson(request)}`)
    .digest("hex");
  const ordinal = scope?.counters.get(hash) ?? 0;
  scope?.counters.set(hash, ordinal + 1);
  const runId = scope?.runId ?? resolutionId;
  const epoch = await pool.query(
    "SELECT epoch FROM study_mcp_epochs WHERE owner_id=$1 AND run_id=$2",
    [ownerId, runId],
  );
  const task = await enqueueTask(
    pool,
    ownerId,
    runId,
    `${source}:epoch-${epoch.rows[0]?.epoch ?? 0}`,
    request,
    ordinal,
  );
  let waitMs = 750;
  for (;;) {
    signal?.throwIfAborted();
    const { rows } = await pool.query<McpTask>(
      "SELECT response FROM study_mcp_tasks WHERE id=$1 AND owner_id=$2",
      [task.id, ownerId],
    );
    if (!rows[0]) throw new Error("MCP task no longer exists");
    if (rows[0].response) return rows[0].response;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(finish, waitMs);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
    waitMs = Math.min(3000, waitMs + 250);
  }
}
