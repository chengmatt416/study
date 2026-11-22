import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
vi.mock("@/lib/persistence/server-provider", () => ({ getServerPersistenceProvider: vi.fn() }));
import { enqueueTask, submitTask, validateTask, TASK_SCHEMA } from "./store";
import { listTasks, taskContext } from "./tasks";
import { MODEL_WORKFLOW, REVIEW_CATEGORIES } from "./workflow";

describe("Bounded durable MCP context and verified submissions", () => {
  let pg: PGlite;
  let pool: Pool;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    await pg.exec(TASK_SCHEMA);
    pool = { query: (sql: string, params: unknown[]) => pg.query(sql, params) } as unknown as Pool;
  });
  afterAll(async () => { await pg?.close(); });
  /** A task its author has read to the end, which validation now requires. */
  const enqueueRead = async (...args: Parameters<typeof enqueueTask>) => {
    const task = await enqueueTask(...args);
    for (let offset: number | null = 0; offset !== null;) offset = (await taskContext(args[0], args[1], task.id, new URLSearchParams(`offset=${offset}&limit=48000`)))!.next_offset;
    return task;
  };
  const review = (hash: string) => ({ request_sha256: hash, checks: REVIEW_CATEGORIES.map(category => ({ category, evidence: `Checked ${category} for this example: fourfold mass yields twice the period; no unsupported claims or untested browser results.` })), remaining_issues: [] });

  it("persists a million-word context and reads exact bounded Unicode pages with a stable hash", async () => {
    const request = { protocol: "study-openmaic-model/v1", workflow: MODEL_WORKFLOW, prompt: [{ role: "user", content: "source ".repeat(1_000_000) + "實驗🌱結果" }], tools: [] };
    const task = await enqueueTask(pool, "study:large", "large-run", "outline:epoch-0", request, 0);
    expect(task.request_bytes).toBeGreaterThan(4_000_000);
    expect(task).not.toHaveProperty("request");
    const page = await listTasks(pool, "study:large", new URLSearchParams("summary=1&run_id=large-run"));
    expect(page.tasks).toHaveLength(1);
    expect(JSON.stringify(page).length).toBeLessThan(6000);
    expect(page.tasks[0]).not.toHaveProperty("request");
    const read = await taskContext(pool, "study:large", task.id, new URLSearchParams("limit=48000"));
    expect([...read!.text]).toHaveLength(48_000);
    expect(read!.next_offset).toBe(48_000);
    const next = await taskContext(pool, "study:large", task.id, new URLSearchParams("offset=48000&limit=24"));
    const raw = (await pg.query<{ context: string }>("SELECT request::text AS context FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0].context;
    expect(read!.text + next!.text).toBe([...raw].slice(0, 48_024).join(""));
    expect(read!.request_sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    const end = await taskContext(pool, "study:large", task.id, new URLSearchParams(`offset=${read!.total_chars - 25}&limit=48`));
    expect(end!.next_offset).toBeNull();
    expect(end!.text).toBe([...raw].slice(-25).join(""));
    const unicodeOffset = [...raw.slice(0, raw.indexOf("實驗"))].length;
    const unicode = await taskContext(pool, "study:large", task.id, new URLSearchParams(`offset=${unicodeOffset}&limit=5`));
    expect(unicode!.text).toBe("實驗🌱結果");
    expect(await taskContext(pool, "study:other", task.id, new URLSearchParams())).toBeNull();
    await expect(taskContext(pool, "study:large", task.id, new URLSearchParams("limit=48001"))).rejects.toThrow("integer");
    await expect(taskContext(pool, "study:large", task.id, new URLSearchParams("offset=-1"))).rejects.toThrow("integer");
  }, 60_000);

  it("pages thousands of model turns without returning history payloads or another owner/epoch", async () => {
    await pg.query("INSERT INTO study_mcp_tasks(id,owner_id,run_id,fingerprint,source,request,created_at) SELECT 't-'||lpad(i::text,4,'0'),'study:paged','paged','fp-'||i,'scene:epoch-0','{}'::jsonb,'2026-01-01'::timestamptz FROM generate_series(1,2000) i");
    await enqueueTask(pool, "study:other", "paged", "scene:epoch-0", {}, 0);
    await enqueueTask(pool, "study:paged", "paged", "scene:epoch-1", {}, 0);
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const params = new URLSearchParams("summary=1&limit=20&run_id=paged");
      if (cursor) params.set("cursor", cursor);
      const page = await listTasks(pool, "study:paged", params);
      ids.push(...page.tasks.map(task => task.id));
      expect(page.tasks.every(task => !("request" in task))).toBe(true);
      cursor = page.next_cursor;
    } while (cursor);
    expect(ids).toHaveLength(2000);
    expect(new Set(ids).size).toBe(2000);
    expect(ids.at(-1)).toBe("t-2000");
    await expect(listTasks(pool, "study:paged", new URLSearchParams("summary=1&cursor=broken"))).rejects.toThrow("cursor");
  }, 60_000);

  it("rejects absent/stale/incomplete self-checks and invalid model output without consuming the pending task", async () => {
    const task = await enqueueRead(pool, "study:review", "review-run", "scene:epoch-0", { workflow: MODEL_WORKFLOW, tools: [{ type: "function", name: "calculate" }], responseFormat: { type: "json" } }, 0);
    const verified = review(task.request_sha256!);
    for (const output of [
      { text: "{}" },
      { text: "{}", verification: { ...verified, request_sha256: "stale" } },
      { text: "{}", verification: { ...verified, remaining_issues: ["Unverified unit conversion"] } },
      { text: "{}", verification: { ...verified, checks: [] } },
      { text: "not JSON", verification: verified },
      { text: "", verification: verified, tool_calls: [{ id: "bad", name: "undeclared", arguments: {} }] },
    ]) await expect(submitTask(pool, "study:review", task.id, 1, output)).rejects.toThrow();
    expect((await pg.query("SELECT status,version FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0]).toEqual({ status: "pending", version: 1 });
    const candidate = { text: '{"period_ratio":2}', verification: verified };
    const report = await validateTask(pool, "study:review", task.id, 1, candidate);
    expect(report?.ok).toBe(true);
    expect(await submitTask(pool, "study:review", task.id, 1, candidate, report?.ok ? report.validation_receipt : undefined)).toMatchObject({ status: "answered", version: 2 });
    expect(await submitTask(pool, "study:review", task.id, 1, { text: "{}", verification: verified })).toBeNull();
  });

  it("resumes pre-upgrade task fingerprints without creating a replacement turn", async () => {
    const original = { protocol: "study-openmaic-model/v1", prompt: [{ role: "user", content: "preserve order" }], tools: [] };
    const task = await enqueueRead(pool, "study:upgrade", "upgrade", "scene:epoch-0", original, 0);
    const resumed = await enqueueTask(pool, "study:upgrade", "upgrade", "scene:epoch-0", { protocol: original.protocol, workflow: MODEL_WORKFLOW, prompt: original.prompt, tools: original.tools }, 0);
    expect(resumed.id).toBe(task.id);
    expect(resumed.verification_required).toBe(false);
    expect(await submitTask(pool, "study:upgrade", task.id, 1, { text: "legacy reviewed externally" })).toMatchObject({ status: "answered" });
  });
});
