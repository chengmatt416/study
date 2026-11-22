import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
vi.mock("@/lib/persistence/server-provider", () => ({ getServerPersistenceProvider: vi.fn() }));
import { enqueueTask, TASK_SCHEMA } from "./store";
import { taskContext } from "./tasks";
import { CONTEXT_CHUNK_CHARS } from "./workflow";

describe("Immutable bounded context chunks", () => {
  let pg: PGlite;
  let pool: Pool;
  const queries: { sql: string; params: unknown[] }[] = [];
  beforeAll(async () => {
    pg = new PGlite(); await pg.waitReady; await pg.exec(TASK_SCHEMA);
    pool = { query: (sql: string, params: unknown[] = []) => { queries.push({ sql, params }); return pg.query(sql, params); } } as unknown as Pool;
  });
  afterAll(async () => { await pg?.close(); });

  it("serializes a million-word request once and serves later pages from bounded indexed chunks", async () => {
    const task = await enqueueTask(pool, "study:cached", "large", "scene:epoch-0", { prompt: "source ".repeat(1_000_000) + "中文🧪" }, 0);
    const raw = (await pg.query<{ raw: string }>("SELECT request::text AS raw FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0].raw;
    const first = await taskContext(pool, "study:cached", task.id, new URLSearchParams("limit=100"));
    expect(first!.text).toBe(raw.slice(0, 100));
    expect(first!.request_sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    const manifest = (await pg.query<{ request_chars: number }>("SELECT * FROM study_mcp_task_contexts WHERE task_id=$1", [task.id])).rows[0];
    expect(manifest.request_chars).toBe(Array.from(raw).length);
    queries.length = 0;
    const offset = CONTEXT_CHUNK_CHARS - 1;
    const middle = await taskContext(pool, "study:cached", task.id, new URLSearchParams(`offset=${offset}&limit=48000`));
    expect(middle!.text).toBe(raw.slice(offset, offset + 48_000));
    const end = await taskContext(pool, "study:cached", task.id, new URLSearchParams(`offset=${first!.total_chars - 4}&limit=48`));
    expect(end!.text).toBe(Array.from(raw).slice(-4).join(""));
    expect(end!.next_offset).toBeNull();
    expect(queries.every(query => !query.sql.includes("request::text"))).toBe(true);
    const reads = queries.filter(query => query.sql.startsWith("SELECT text FROM study_mcp_task_context_chunks"));
    expect(reads).toHaveLength(2);
    expect(reads.every(query => Number(query.params[2]) - Number(query.params[1]) <= 2)).toBe(true);
    const plan = await pg.query("EXPLAIN SELECT text FROM study_mcp_task_context_chunks WHERE task_id=$1 AND chunk_index BETWEEN 5 AND 7 ORDER BY chunk_index", [task.id]);
    expect(JSON.stringify(plan.rows)).toMatch(/Index (?:Only )?Scan/);
  }, 60_000);

  it("owns caches by the original task and preserves Unicode across arbitrary chunk boundaries", async () => {
    const task = await enqueueTask(pool, "study:unicode-cache", "unicode", "scene:epoch-0", { prompt: "🌱中文".repeat(20_000) }, 0);
    expect(await taskContext(pool, "study:other", task.id, new URLSearchParams())).toBeNull();
    expect((await pg.query<{ n: number }>("SELECT COUNT(*) AS n FROM study_mcp_task_contexts WHERE task_id=$1", [task.id])).rows[0].n).toBe(0);
    const raw = (await pg.query<{ raw: string }>("SELECT request::text AS raw FROM study_mcp_tasks WHERE id=$1", [task.id])).rows[0].raw;
    const offset = CONTEXT_CHUNK_CHARS - 3;
    const page = await taskContext(pool, "study:unicode-cache", task.id, new URLSearchParams(`offset=${offset}&limit=48000`));
    expect(page!.text).toBe(Array.from(raw).slice(offset, offset + 48_000).join(""));
    await pg.query("DELETE FROM study_mcp_tasks WHERE id=$1", [task.id]);
    expect((await pg.query<{ n: number }>("SELECT COUNT(*) AS n FROM study_mcp_task_contexts WHERE task_id=$1", [task.id])).rows[0].n).toBe(0);
    expect((await pg.query<{ n: number }>("SELECT COUNT(*) AS n FROM study_mcp_task_context_chunks WHERE task_id=$1", [task.id])).rows[0].n).toBe(0);
  });

  it("commits one complete cache during simultaneous first reads", async () => {
    const task = await enqueueTask(pool, "study:concurrent-cache", "concurrent", "scene:epoch-0", { prompt: "abc🌱".repeat(20_000) }, 0);
    const [left, right] = await Promise.all([
      taskContext(pool, "study:concurrent-cache", task.id, new URLSearchParams("offset=0&limit=20")),
      taskContext(pool, "study:concurrent-cache", task.id, new URLSearchParams("offset=24000&limit=20")),
    ]);
    expect(left!.request_sha256).toBe(right!.request_sha256);
    const count = (await pg.query<{ n: number }>("SELECT COUNT(*) AS n FROM study_mcp_task_context_chunks WHERE task_id=$1", [task.id])).rows[0].n;
    expect(count).toBe(Math.ceil(left!.total_chars / CONTEXT_CHUNK_CHARS));
  });
});
