import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
vi.mock("@/lib/persistence/server-provider", () => ({ getServerPersistenceProvider: vi.fn() }));
import { enqueueTask, outputDigest, submitTask, TASK_SCHEMA, validateTask, type McpOutput } from "./store";
import { listTasks, taskContext } from "./tasks";
import { MODEL_WORKFLOW, REVIEW_CATEGORIES } from "./workflow";

describe("Recoverable reviewed drafts", () => {
  let pg: PGlite, pool: Pool;
  const owner = "study:receipt-recovery";
  const request = { workflow: MODEL_WORKFLOW, responseFormat: { type: "json", schema: { type: "object", required: ["ratio"], properties: { ratio: { type: "number" } }, additionalProperties: false } } };
  const candidate = (hash: string, ratio = 2): McpOutput => ({ text: JSON.stringify({ ratio }), verification: { request_sha256: hash, remaining_issues: [], checks: REVIEW_CATEGORIES.map(category => ({ category, evidence: `${category}: independently checked the source, calculation, boundaries and schema; browser tests were not executed.` })) } });
  const summary = (run: string) => listTasks(pool, owner, new URLSearchParams({ summary: "1", run_id: run }));
  beforeAll(async () => {
    pg = new PGlite(); await pg.waitReady; await pg.exec(TASK_SCHEMA);
    pool = { query: (sql: string, params: unknown[]) => pg.query(sql, params) } as unknown as Pool;
  });
  afterAll(async () => { await pg?.close(); });
  /** A task its author has read to the end, which validation now requires. */
  const enqueueRead = async (...args: Parameters<typeof enqueueTask>) => {
    const task = await enqueueTask(...args);
    for (let offset: number | null = 0; offset !== null;) offset = (await taskContext(args[0], args[1], task.id, new URLSearchParams(`offset=${offset}&limit=48000`)))!.next_offset;
    return task;
  };

  it("recovers a large validated draft from bounded summaries and context without transferring its body", async () => {
    const task = await enqueueRead(pool, owner, "large-resume", "scene:epoch-0", { workflow: MODEL_WORKFLOW, prompt: "Full source. ".repeat(10_000) }, 0);
    const output = { ...candidate(task.request_sha256!), text: "Complete reviewed teaching content. ".repeat(20_000) };
    await validateTask(pool, owner, task.id, 1, output);
    const list = await summary(task.run_id);
    expect(list.tasks[0]).toMatchObject({ id: task.id, version: 1, validation_receipt: outputDigest(output), next_action: "submit_openmaic_core_step" });
    expect(list.tasks[0]).not.toHaveProperty("request");
    expect(list.tasks[0]).not.toHaveProperty("validated_output");
    expect(JSON.stringify(list).length).toBeLessThan(7000);
    const context = await taskContext(pool, owner, task.id, new URLSearchParams("limit=32"));
    expect(context).toMatchObject({ version: 1, active_epoch: true, validation_receipt: outputDigest(output), next_action: "submit_openmaic_core_step", next_offset: 32 });
    expect(context!.text).toHaveLength(32);
    expect(context).not.toHaveProperty("validated_output");
    expect(await submitTask(pool, owner, task.id, list.tasks[0].version, undefined, list.tasks[0].validation_receipt)).toMatchObject({ status: "answered", version: 2 });
    expect(await taskContext(pool, owner, task.id, new URLSearchParams("limit=1"))).toMatchObject({ version: 2, validation_receipt: null, next_action: "get_openmaic_core_step" });
    const answered = await listTasks(pool, owner, new URLSearchParams({ summary: "1", run_id: task.run_id, status: "answered" }));
    expect(answered.tasks[0]).toMatchObject({ validation_receipt: null, next_action: "get_openmaic_core_step" });
    expect((await pg.query<{ response: McpOutput }>("SELECT response FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0].response).toEqual(output);
  });

  it("keeps receipts scoped to the owner, pending version and active retry epoch", async () => {
    const task = await enqueueRead(pool, owner, "scope", "scene:epoch-0", request, 0);
    const output = candidate(task.request_sha256!);
    await validateTask(pool, owner, task.id, 1, output);
    expect((await listTasks(pool, "study:other", new URLSearchParams("summary=1"))).tasks).toEqual([]);
    expect(await taskContext(pool, "study:other", task.id, new URLSearchParams())).toBeNull();
    expect(await validateTask(pool, "study:other", task.id, 1, { ...output, text: "{}" })).toBeNull();
    expect(await validateTask(pool, owner, task.id, 2, { ...output, text: "{}" })).toBeNull();
    expect((await summary(task.run_id)).tasks[0].validation_receipt).toBe(outputDigest(output));
    await pg.query("INSERT INTO study_mcp_epochs(owner_id,run_id,epoch) VALUES ($1,$2,1)", [owner, task.run_id]);
    expect((await summary(task.run_id)).tasks).toEqual([]);
    expect(await taskContext(pool, owner, task.id, new URLSearchParams("limit=1"))).toMatchObject({ active_epoch: false, validation_receipt: null, next_action: "get_openmaic_core_step" });
    expect(await submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).toBeNull();
    expect(await validateTask(pool, owner, task.id, 1, { ...output, text: "{}" })).toBeNull();
  });

  it("invalidates the previous stored draft when a replacement fails preflight", async () => {
    const task = await enqueueRead(pool, owner, "failed-replacement", "scene:epoch-0", request, 0);
    const output = candidate(task.request_sha256!);
    await validateTask(pool, owner, task.id, 1, output);
    expect(await validateTask(pool, owner, task.id, 1, { ...output, text: '{"ratio":"wrong"}' })).toMatchObject({ ok: false });
    const row = (await pg.query("SELECT status,version,validated_output,validated_output_sha256 FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0];
    expect(row).toEqual({ status: "pending", version: 1, validated_output: null, validated_output_sha256: null });
    expect((await summary(task.run_id)).tasks[0]).toMatchObject({ validation_receipt: null, next_action: "get_openmaic_core_task_context" });
    await expect(submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).rejects.toThrow("No matching reviewed draft");
    const first = await taskContext(pool, owner, task.id, new URLSearchParams("limit=1"));
    expect(first).toMatchObject({ validation_receipt: null, next_action: "get_openmaic_core_task_context" });
    expect(await taskContext(pool, owner, task.id, new URLSearchParams({ offset: String(first!.total_chars), limit: "1" }))).toMatchObject({ next_offset: null, next_action: "validate_openmaic_core_step" });
  });

  function delayPendingRead() {
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { observed = resolve; });
    let delayed = false;
    const delayedPool = { query: async (sql: string, params: unknown[]) => {
      const result = await pg.query(sql, params);
      if (!delayed && sql.startsWith("SELECT jsonb_build_object")) { delayed = true; observed(); await gate; }
      return result;
    } } as unknown as Pool;
    return { delayedPool, ready, release };
  }

  it("does not let an older failed review erase a newer validation of the same draft", async () => {
    const task = await enqueueRead(pool, owner, "parallel-failure", "scene:epoch-0", request, 0);
    const output = candidate(task.request_sha256!);
    await validateTask(pool, owner, task.id, 1, output);
    const delay = delayPendingRead();
    const invalid = validateTask(delay.delayedPool, owner, task.id, 1, { ...output, text: "{}" });
    await delay.ready;
    try { expect(await validateTask(pool, owner, task.id, 1, output)).toMatchObject({ ok: true }); }
    finally { delay.release(); }
    expect(await invalid).toMatchObject({ ok: false });
    expect((await summary(task.run_id)).tasks[0].validation_receipt).toBe(outputDigest(output));
    expect(await submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).toMatchObject({ status: "answered" });
  });

  it("does not let a slow successful review replace a newer validated draft", async () => {
    const task = await enqueueRead(pool, owner, "parallel-success", "scene:epoch-0", request, 0);
    const output = candidate(task.request_sha256!), newer = candidate(task.request_sha256!, 4);
    const delay = delayPendingRead();
    const slow = validateTask(delay.delayedPool, owner, task.id, 1, output);
    await delay.ready;
    try { expect(await validateTask(pool, owner, task.id, 1, newer)).toMatchObject({ ok: true }); }
    finally { delay.release(); }
    expect(await slow).toBeNull();
    expect((await summary(task.run_id)).tasks[0].validation_receipt).toBe(outputDigest(newer));
    await expect(submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).rejects.toThrow("No matching reviewed draft");
    expect(await submitTask(pool, owner, task.id, 1, undefined, outputDigest(newer))).toMatchObject({ status: "answered" });
  });
});
