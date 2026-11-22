import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
vi.mock("@/lib/persistence/server-provider", () => ({ getServerPersistenceProvider: vi.fn() }));
import { enqueueTask, outputDigest, submitTask, TASK_SCHEMA, validateTask, type McpOutput } from "./store";
import { taskContext } from "./tasks";
import { MODEL_WORKFLOW, REVIEW_CATEGORIES } from "./workflow";

describe("reviewed draft preflight and exact-output submission", () => {
  let pg: PGlite, pool: Pool;
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
  const owner = "study:preflight";
  const request = { workflow: MODEL_WORKFLOW, responseFormat: { type: "json", schema: { type: "object", required: ["ratio"], properties: { ratio: { type: "number", minimum: 0 } }, additionalProperties: false } } };
  const candidate = (hash: string): McpOutput => ({ text: '{"ratio":2}', verification: { request_sha256: hash, remaining_issues: [], checks: REVIEW_CATEGORIES.map(category => ({ category, evidence: `${category}: independently recomputed sqrt(4)=2; source uses fixed spring constant. Browser checks not executed.` })) } });

  it("requires valid schema, complete self-review and successful preflight without advancing the turn", async () => {
    const task = await enqueueRead(pool, owner, "reviewed", "content:epoch-0", request, 0);
    const output = candidate(task.request_sha256!);
    await expect(submitTask(pool, owner, task.id, 1, output)).rejects.toThrow("Validate this exact");
    await expect(submitTask(pool, owner, task.id, 1, output, outputDigest(output))).rejects.toThrow("Validate this exact");
    const invalid = await validateTask(pool, owner, task.id, 1, { ...output, text: '{"ratio":"wrong"}' });
    expect(invalid).toMatchObject({ ok: false }); expect(invalid).not.toHaveProperty("validation_receipt");
    expect(await validateTask(pool, owner, task.id, 1, { text: '{"ratio":2}' })).toMatchObject({ ok: false });
    const report = await validateTask(pool, owner, task.id, 1, output);
    expect(report).toMatchObject({ ok: true, validation_receipt: outputDigest(output), expected_version: 1 });
    expect((await pg.query("SELECT status,version,response FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0]).toEqual({ status: "pending", version: 1, response: null });
    await expect(submitTask(pool, owner, task.id, 1, { ...output, text: '{"ratio":3}' }, outputDigest(output))).rejects.toThrow("Validate this exact");
    const changedReview = structuredClone(output); changedReview.verification!.checks[0].evidence += " Changed evidence.";
    await expect(submitTask(pool, owner, task.id, 1, changedReview, outputDigest(output))).rejects.toThrow("Validate this exact");
    expect(await submitTask(pool, owner, task.id, 1, output, outputDigest(output))).toMatchObject({ status: "answered", version: 2 });
    expect(await validateTask(pool, owner, task.id, 1, output)).toBeNull();
  });

  it("commits a large stored draft by receipt without retransferring its output", async () => {
    const task = await enqueueRead(pool, owner, "receipt-only", "content:epoch-0", { workflow: MODEL_WORKFLOW }, 0);
    const output = { ...candidate(task.request_sha256!), text: "完整教材與例題。".repeat(20_000) };
    const report = await validateTask(pool, owner, task.id, 1, output);
    expect(report?.ok).toBe(true);
    await expect(submitTask(pool, owner, task.id, 1, undefined, "a".repeat(64))).rejects.toThrow("No matching reviewed draft");
    expect(await submitTask(pool, "study:other", task.id, 1, undefined, outputDigest(output))).toBeNull();
    expect(await submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).toMatchObject({ status: "answered", version: 2 });
    const row = (await pg.query<{ response: McpOutput; validated_output: unknown; validated_output_sha256: string | null }>("SELECT response,validated_output,validated_output_sha256 FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0];
    expect(row.response).toEqual(output); expect(row.validated_output).toBeNull(); expect(row.validated_output_sha256).toBeNull();
    expect(await submitTask(pool, owner, task.id, 1, undefined, outputDigest(output))).toBeNull();
  });

  it("checks tool argument schema before any tool can be consumed and tolerates property ordering", async () => {
    const task = await enqueueRead(pool, owner, "tool", "content:epoch-0", { workflow: MODEL_WORKFLOW, toolChoice: { type: "tool", toolName: "calculate" }, tools: [{ type: "function", name: "calculate", inputSchema: { type: "object", required: ["mass"], properties: { mass: { type: "number", minimum: 0 } }, additionalProperties: false } }] }, 0);
    const output = { ...candidate(task.request_sha256!), text: "", tool_calls: [{ id: "c1", name: "calculate", arguments: { mass: "four" } }] };
    expect(await validateTask(pool, owner, task.id, 1, output)).toMatchObject({ ok: false });
    const good: McpOutput = { ...output, tool_calls: [{ id: "c1", name: "calculate", arguments: { mass: 4 } }] };
    const report = await validateTask(pool, owner, task.id, 1, good);
    expect(report?.ok).toBe(true);
    const reordered: McpOutput = { verification: good.verification, tool_calls: [{ arguments: { mass: 4 }, name: "calculate", id: "c1" }], text: "" };
    expect(outputDigest(good)).toBe(outputDigest(reordered));
    expect(await submitTask(pool, owner, task.id, 1, reordered, outputDigest(good))).toMatchObject({ status: "answered" });
  });

  it("keeps draft receipts isolated by owner, version and retry epoch", async () => {
    const task = await enqueueRead(pool, owner, "epoch", "content:epoch-0", request, 0);
    const output = candidate(task.request_sha256!);
    expect(await validateTask(pool, "study:other", task.id, 1, output)).toBeNull();
    expect(await validateTask(pool, owner, task.id, 2, output)).toBeNull();
    expect(await validateTask(pool, owner, task.id, 1, output)).toMatchObject({ ok: true });
    await pg.query("INSERT INTO study_mcp_epochs(owner_id,run_id,epoch) VALUES ($1,'epoch',1)", [owner]);
    expect(await validateTask(pool, owner, task.id, 1, output)).toBeNull();
    expect(await submitTask(pool, owner, task.id, 1, output, outputDigest(output))).toBeNull();
    expect((await pg.query("SELECT status,version FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0]).toEqual({ status: "pending", version: 1 });
  });

  it("requires new validation when a parallel reviewer replaces the candidate", async () => {
    const task = await enqueueRead(pool, owner, "parallel", "content:epoch-0", request, 0);
    const a = candidate(task.request_sha256!), b = { ...a, text: '{"ratio":4}' };
    await validateTask(pool, owner, task.id, 1, a);
    await validateTask(pool, owner, task.id, 1, b);
    await expect(submitTask(pool, owner, task.id, 1, a, outputDigest(a))).rejects.toThrow("Validate this exact");
    expect(await submitTask(pool, owner, task.id, 1, b, outputDigest(b))).toMatchObject({ status: "answered" });
  });

  it("refuses to validate a draft until its task was read from the start to the end", async () => {
    const task = await enqueueTask(pool, owner, "unread", "content:epoch-0", { ...request, prompt: [{ role: "user", content: "Source. ".repeat(4000) + "Title: 檢核：週期" }] }, 0);
    const output = candidate(task.request_sha256!);
    const read = (query: string) => taskContext(pool, owner, task.id, new URLSearchParams(query));
    const unread = await validateTask(pool, owner, task.id, 1, output);
    expect(unread).toMatchObject({ ok: false }); expect(unread!.errors.join()).toContain("Read the complete task");
    const first = await read("offset=0&limit=24000");
    expect(first).toMatchObject({ next_offset: 24000, context_read: false, next_action: "get_openmaic_core_task_context" });
    // The platform's own look at a task, the last page alone, and a page that skips ahead do not count as reading it.
    expect(await read(`offset=0&limit=48000&peek=1`)).toMatchObject({ next_offset: null, context_read: false });
    expect(await read(`offset=${first!.total_chars - 10}&limit=10`)).toMatchObject({ next_offset: null, context_read: false });
    expect((await validateTask(pool, owner, task.id, 1, output))!.errors.join()).toContain("24000 characters read so far");
    expect(await read("offset=24000&limit=24000")).toMatchObject({ next_offset: null, context_read: true });
    expect(await validateTask(pool, owner, task.id, 1, output)).toMatchObject({ ok: true, validation_receipt: outputDigest(output) });
  });

  it("rejects review evidence pasted across categories or repeated from the previous turn", async () => {
    const first = await enqueueRead(pool, owner, "evidence", "content:epoch-0", request, 0);
    const pasted = candidate(first.request_sha256!);
    for (const check of pasted.verification!.checks) check.evidence = "Checked everything carefully and it all looks correct.";
    expect((await validateTask(pool, owner, first.id, 1, pasted))!.errors.join()).toContain("needs its own evidence");
    const reviewed = candidate(first.request_sha256!);
    expect(await validateTask(pool, owner, first.id, 1, reviewed)).toMatchObject({ ok: true });
    expect(await submitTask(pool, owner, first.id, 1, undefined, outputDigest(reviewed))).toMatchObject({ status: "answered" });
    const second = await enqueueRead(pool, owner, "evidence", "content:epoch-0", { ...request, prompt: "next scene" }, 0);
    const repeated = candidate(second.request_sha256!);
    const refused = await validateTask(pool, owner, second.id, 1, repeated);
    expect(refused).toMatchObject({ ok: false }); expect(refused!.errors.join()).toContain("repeats the previous turn's evidence");
    const fresh = structuredClone(repeated); fresh.verification!.checks[0].evidence = "source_accuracy: compared the worked example on this slide with page 118; T = 2π√(m/k) and its units match.";
    expect(await validateTask(pool, owner, second.id, 1, fresh)).toMatchObject({ ok: true });
    // Another learner's run never counts as this one's previous turn.
    const other = await enqueueRead(pool, "study:else", "evidence", "content:epoch-0", request, 0);
    expect(await validateTask(pool, "study:else", other.id, 1, candidate(other.request_sha256!))).toMatchObject({ ok: true });
  });

  it("preserves already-issued review-only tasks without forcing a new client flow", async () => {
    const task = await enqueueRead(pool, owner, "legacy", "content:epoch-0", { workflow: { ...MODEL_WORKFLOW, preflight_required: false }, responseFormat: { type: "json" } }, 0);
    expect(task.preflight_required).toBe(false);
    expect(await submitTask(pool, owner, task.id, 1, candidate(task.request_sha256!))).toMatchObject({ status: "answered" });
  });
});
