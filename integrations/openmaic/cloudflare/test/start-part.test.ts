import { test, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgresEngine } from "../src/postgres-engine";
import { workersScope } from "@/lib/study-workers/context";
import { getServerPersistenceProvider } from "@/lib/persistence/server-provider";
import { createGenerationRun } from "@/lib/server/generation/run/store";
import { PartStartBusyError, partMarker, startCoursePart } from "@/lib/study-mcp/start-part";
import type { GenerationRunInput } from "@/lib/server/generation/run/types";

test("course-part starts are idempotent across timeouts, completion and concurrent Worker pg sessions", async () => {
  process.env.OPENMAIC_WORKERS = "1";
  process.env.OPENMAIC_MCP_MODE = "1";
  process.env.DATABASE_URL = "postgres://workers/start-part-contract";
  const pg = new PGlite({ parsers: { 20: value => value, 1700: value => value } });
  await pg.waitReady;
  const database = new PostgresEngine(pg, async () => {});
  const pending: Promise<unknown>[] = [];
  const scope = { env: { OPENMAIC_DATABASE: { getByName: () => database } }, context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }, alarm: true };
  const input = (part: string): GenerationRunInput => ({ requirement: "逐步解釋週期" + partMarker(part), materialIds: [], interactive: true, taskEngine: false, agents: { mode: "auto" }, outlineReview: "auto" });
  const create = (owner: string) => (value: GenerationRunInput) => createGenerationRun(owner, value, { maxActiveRunsPerOwner: 10, maxWaitingRunsPerOwner: 10 });
  try {
    await workersScope.run(scope as Parameters<typeof workersScope.run>[0], async () => {
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const start = vi.fn(async (value: GenerationRunInput) => {
        const run = await create("study:part-owner")(value);
        enter();
        await held;
        return run;
      });
      const first = startCoursePart("study:part-owner", "part-1", input("part-1"), start);
      await entered;
      await expect(startCoursePart("study:part-owner", "part-1", input("part-1"), start)).rejects.toBeInstanceOf(PartStartBusyError);
      release();
      const created = await first;
      expect(created.idempotent).toBe(false);
      await provider.pool.query("UPDATE generation_runs SET state='completed' WHERE id=$1", [created.run.id]);
      const recovered = await startCoursePart("study:part-owner", "part-1", input("part-1"), start);
      expect(recovered).toMatchObject({ idempotent: true, run: { id: created.run.id, state: "completed" } });
      expect(start).toHaveBeenCalledOnce();

      const lost = vi.fn(async (value: GenerationRunInput) => {
        await create("study:part-owner")(value);
        throw new Error("response lost after native commit");
      });
      await expect(startCoursePart("study:part-owner", "part-2", input("part-2"), lost)).rejects.toThrow("response lost");
      const retried = await startCoursePart("study:part-owner", "part-2", input("part-2"), lost);
      expect(retried.idempotent).toBe(true);
      expect(lost).toHaveBeenCalledOnce();
      const other = await startCoursePart("study:other-owner", "part-2", input("part-2"), create("study:other-owner"));
      expect(other.idempotent).toBe(false);
      expect(other.run.id).not.toBe(retried.run.id);
      const index = (await provider.pool.query("SELECT indexdef FROM pg_indexes WHERE indexname='study_mcp_generation_part_key'")).rows[0].indexdef;
      expect(index).toContain("UNIQUE INDEX");
      expect(index).toContain("owner_id");
      await expect(create("study:part-owner")(input("part-2"))).rejects.toMatchObject({ code: "23505", constraint: "study_mcp_generation_part_key" });
      // A second writer that committed after the lookup is recovered by the unique marker.
      const raced = await startCoursePart("study:part-owner", "part-3", input("part-3"), async value => {
        await create("study:part-owner")(value);
        return create("study:part-owner")(value);
      });
      expect(raced.idempotent).toBe(true);
      expect((await provider.pool.query("SELECT count(*) AS n FROM generation_runs")).rows[0].n).toBe("4");
    });
  } finally { await Promise.all(pending); await pg.close(); }
});
