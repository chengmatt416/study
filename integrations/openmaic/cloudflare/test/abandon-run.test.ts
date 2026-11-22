import { test, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgresEngine } from "../src/postgres-engine";
import { workersScope } from "@/lib/study-workers/context";
import { createGenerationRun, discardGenerationRun, readGenerationRun } from "@/lib/server/generation/run/store";
import { clearFinishedRunTasks, partMarker, startCoursePart } from "@/lib/study-mcp/start-part";
import { enqueueTask, taskPool } from "@/lib/study-mcp/store";
import { readCachedTaskContext } from "@/lib/study-mcp/task-context";
import type { GenerationRunInput } from "@/lib/server/generation/run/types";

test("regenerating a part opens a new run, and only a finished run's own tasks can be cleared", async () => {
  process.env.OPENMAIC_WORKERS = "1";
  process.env.OPENMAIC_MCP_MODE = "1";
  process.env.DATABASE_URL = "postgres://workers/abandon-run-contract";
  const pg = new PGlite({ parsers: { 20: value => value, 1700: value => value } });
  await pg.waitReady;
  const database = new PostgresEngine(pg, async () => {});
  const pending: Promise<unknown>[] = [];
  const scope = { env: { OPENMAIC_DATABASE: { getByName: () => database } }, context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }, alarm: true };
  const owner = "study:part-owner";
  const input = (part: string): GenerationRunInput => ({ requirement: "逐步解釋週期" + partMarker(part), materialIds: [], interactive: true, taskEngine: false, agents: { mode: "auto" }, outlineReview: "auto" });
  const create = (value: GenerationRunInput) => createGenerationRun(owner, value, { maxActiveRunsPerOwner: 10, maxWaitingRunsPerOwner: 10 });
  try {
    await workersScope.run(scope as Parameters<typeof workersScope.run>[0], async () => {
      const first = await startCoursePart(owner, "part-1", input("part-1"), create);
      const pool = await taskPool();
      const task = await enqueueTask(pool, owner, first.run.id, "scene-content:slide:epoch-0", { prompt: "第一頁" }, 0);
      await enqueueTask(pool, "study:other-owner", first.run.id, "scene-content:slide:epoch-0", { prompt: "別人的任務" }, 0);
      await readCachedTaskContext(pool, owner, task.id, 0, 10);
      const count = async (table: string) => (await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n;
      expect(await count("study_mcp_task_context_chunks")).toBe("1");

      // A run still waiting for its model turn must keep them.
      expect(await clearFinishedRunTasks(owner, first.run.id)).toBeNull();
      expect(await count("study_mcp_tasks")).toBe("2");

      await discardGenerationRun(first.run.id, owner);
      expect((await readGenerationRun(first.run.id, owner))?.state).toBe("ended");
      expect(await clearFinishedRunTasks(owner, first.run.id)).toBe(1);
      expect((await pool.query("SELECT owner_id FROM study_mcp_tasks")).rows).toEqual([{ owner_id: "study:other-owner" }]);
      expect(await count("study_mcp_task_context_chunks")).toBe("0");
      // Retrying after a lost response finds nothing left to do.
      expect(await clearFinishedRunTasks(owner, first.run.id)).toBe(0);
      expect(await clearFinishedRunTasks(owner, "run-AAAAAAAAAAAAAAAA")).toBe(0);

      const second = await startCoursePart(owner, "part-1:1", input("part-1:1"), create);
      expect(second.idempotent).toBe(false);
      expect(second.run.id).not.toBe(first.run.id);
      expect(await startCoursePart(owner, "part-1:1", input("part-1:1"), create)).toMatchObject({ idempotent: true, run: { id: second.run.id } });
      expect(await startCoursePart(owner, "part-1", input("part-1"), create)).toMatchObject({ idempotent: true, run: { id: first.run.id } });
    });
  } finally { await Promise.all(pending); await pg.close(); }
});
