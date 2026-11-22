import { expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgresEngine } from "../src/postgres-engine";
import { workersScope } from "@/lib/study-workers/context";
import { WorkersPool } from "@/lib/study-workers/database";
import { enqueueTask, submitTask, taskPool, validateTask, type McpOutput } from "@/lib/study-mcp/store";
import { readCachedTaskContext } from "@/lib/study-mcp/task-context";
import { taskContext } from "@/lib/study-mcp/tasks";
import { CONTEXT_CHUNK_CHARS, MODEL_WORKFLOW, REVIEW_CATEGORIES } from "@/lib/study-mcp/workflow";

test("verified preflight receipts and bounded immutable context work through the Workers database RPC", async () => {
  process.env.OPENMAIC_WORKERS = "1";
  process.env.OPENMAIC_MCP_MODE = "1";
  process.env.DATABASE_URL = "postgres://workers/preflight-contract";
  const pg = new PGlite({ parsers: { 20: value => value, 1700: value => value } });
  await pg.waitReady;
  const database = new PostgresEngine(pg, async () => {});
  const queries = vi.spyOn(database, "query");
  const pending: Promise<unknown>[] = [];
  const scope = { env: { OPENMAIC_DATABASE: { getByName: () => database } }, context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }, alarm: true };
  const owner = "study:worker-preflight";
  try {
    await workersScope.run(scope as Parameters<typeof workersScope.run>[0], async () => {
      const pool = await taskPool();
      expect(pool).toBeInstanceOf(WorkersPool);
      const task = await enqueueTask(pool, owner, "worker-preflight-run", "scene:epoch-0", {
        protocol: "study-openmaic-model/v1", workflow: MODEL_WORKFLOW,
        prompt: [{ role: "user", content: "Complete source, units and worked example. ".repeat(2500) + "實驗🌱結果" }],
        toolChoice: { type: "tool", toolName: "calculate" },
        tools: [{ type: "function", name: "calculate", inputSchema: {
          type: "object", properties: { ratio: { type: "number", minimum: 1 }, unit: { enum: ["s"] } }, required: ["ratio", "unit"], additionalProperties: false,
        } }],
      }, 0);
      const output: McpOutput = {
        text: "", tool_calls: [{ id: "call-1", name: "calculate", arguments: { ratio: 2, unit: "s" } }],
        verification: { request_sha256: task.request_sha256!, remaining_issues: [], checks: REVIEW_CATEGORIES.map(category => ({
          category, evidence: `Checked ${category} against this task's source and schema; no browser test is claimed for this calculation-only turn.`,
        })) },
      };
      const bad = structuredClone(output);
      bad.tool_calls![0].arguments.ratio = "incorrect type";
      expect(await validateTask(pool, owner, task.id, 1, bad)).toMatchObject({ ok: false, expected_version: 1, errors: [expect.stringContaining("/ratio")] });
      expect((await pool.query("SELECT status,version,response,validated_output_sha256 FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0])
        .toEqual({ status: "pending", version: 1, response: null, validated_output_sha256: null });
      await expect(submitTask(pool, owner, task.id, 1, output)).rejects.toThrow("Validate this exact reviewed output first");

      expect(await validateTask(pool, owner, task.id, 1, output)).toMatchObject({
        ok: false, errors: [expect.stringContaining("Read the complete task before drafting")],
      });
      for (let offset: number | null = 0; offset !== null;) {
        const page = await taskContext(pool, owner, task.id, new URLSearchParams({ offset: String(offset) }));
        if (!page) throw Error("Expected task context");
        offset = page.next_offset;
      }

      const validation = await validateTask(pool, owner, task.id, 1, output);
      expect(validation).toMatchObject({ ok: true, task_id: task.id, expected_version: 1, errors: [] });
      if (!validation?.ok) throw Error("Expected a successful preflight receipt");
      expect(validation.validation_receipt).toMatch(/^[a-f0-9]{64}$/);
      expect((await pool.query("SELECT status,version,response FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0]).toEqual({ status: "pending", version: 1, response: null });
      await expect(submitTask(pool, owner, task.id, 1, output, "0".repeat(64))).rejects.toThrow("Validate this exact reviewed output first");
      const changed = structuredClone(output);
      changed.tool_calls![0].arguments.ratio = 3;
      await expect(submitTask(pool, owner, task.id, 1, changed, validation.validation_receipt)).rejects.toThrow("Validate this exact reviewed output first");
      expect(await validateTask(pool, "study:other", task.id, 1, output)).toBeNull();

      expect(await readCachedTaskContext(pool, "study:other", task.id, 0, 100)).toBeNull();
      const first = await readCachedTaskContext(pool, owner, task.id, 0, 1000);
      expect(first).toMatchObject({ id: task.id, version: 1, status: "pending", request_sha256: task.request_sha256 });
      expect(Array.from(first!.text)).toHaveLength(1000);
      const canonical = (await pg.query<{ text: string }>("SELECT request::text AS text FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0].text;
      expect(first!.text).toBe(Array.from(canonical).slice(0, 1000).join(""));
      expect(first!.total_chars).toBe(Array.from(canonical).length);
      queries.mockClear();
      const offset = CONTEXT_CHUNK_CHARS - 1;
      const chunk = await readCachedTaskContext(pool, owner, task.id, offset, CONTEXT_CHUNK_CHARS);
      expect(chunk!.text).toBe(Array.from(canonical).slice(offset, offset + CONTEXT_CHUNK_CHARS).join(""));
      expect(queries.mock.calls.some(([sql]) => sql.includes("WITH canonical"))).toBe(false);
      const reads = queries.mock.calls.filter(([sql]) => sql.includes("SELECT text FROM study_mcp_task_context_chunks"));
      expect(reads).toHaveLength(1);
      expect(reads[0][1]).toEqual([task.id, 0, 1]);
      const unicodeOffset = Array.from(canonical.slice(0, canonical.indexOf("實驗"))).length;
      expect((await readCachedTaskContext(pool, owner, task.id, unicodeOffset, 5))!.text).toBe("實驗🌱結果");

      await expect(submitTask(pool, owner, task.id, 1, undefined, "0".repeat(64))).rejects.toThrow("No matching reviewed draft");
      expect(await submitTask(pool, owner, task.id, 1, undefined, validation.validation_receipt)).toMatchObject({ status: "answered", version: 2 });
      const stored = (await pool.query("SELECT response,validated_output,validated_output_sha256 FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0];
      expect(stored).toEqual({ response: output, validated_output: null, validated_output_sha256: null });
      expect(await submitTask(pool, owner, task.id, 1, output, validation.validation_receipt)).toBeNull();
      const answered = await readCachedTaskContext(pool, owner, task.id, 0, 1000);
      expect(answered).toMatchObject({ status: "answered", version: 2, text: first!.text, request_sha256: task.request_sha256 });

      const stale = await enqueueTask(pool, owner, "worker-preflight-stale", "scene:epoch-0", { workflow: MODEL_WORKFLOW, tools: [] }, 0);
      await pool.query("INSERT INTO study_mcp_epochs(owner_id,run_id,epoch) VALUES ($1,$2,1)", [owner, stale.run_id]);
      expect(await validateTask(pool, owner, stale.id, 1, output)).toBeNull();
      expect(await submitTask(pool, owner, stale.id, 1, output)).toBeNull();
    });
  } finally {
    queries.mockRestore();
    await Promise.all(pending);
    await pg.close();
  }
});
