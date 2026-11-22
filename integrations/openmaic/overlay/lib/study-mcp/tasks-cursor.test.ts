import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
vi.mock("@/lib/persistence/server-provider", () => ({ getServerPersistenceProvider: vi.fn() }));
import { TASK_SCHEMA } from "./store";
import { listTasks } from "./tasks";

describe("Lossless task cursors", () => {
  let pg: PGlite;
  let pool: Pool;
  beforeAll(async () => {
    pg = new PGlite(); await pg.waitReady; await pg.exec(TASK_SCHEMA);
    pool = { query: (sql: string, params: unknown[]) => pg.query(sql, params) } as unknown as Pool;
  });
  afterAll(async () => { await pg?.close(); });

  it("finishes pagination when timestamps differ below JavaScript millisecond precision", async () => {
    const timestamps = ["2026-01-01T00:00:00.123455Z", "2026-01-01T00:00:00.123456Z", "2026-01-01T00:00:00.123456Z", "2026-01-01T00:00:00.123457Z", "2026-01-01T00:00:00.124001Z"];
    for (const [index, timestamp] of timestamps.entries()) await pg.query(
      "INSERT INTO study_mcp_tasks(id,owner_id,run_id,fingerprint,source,request,created_at) VALUES ($1,'study:cursor','run',$1,'scene:epoch-0','{}',$2::timestamptz)",
      [`micro-${index}`, timestamp],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
      const query = new URLSearchParams("summary=1&limit=2");
      if (cursor) query.set("cursor", cursor);
      const page = await listTasks(pool, "study:cursor", query);
      seen.push(...page.tasks.map(task => task.id));
      expect(page.tasks.every(task => !("cursor_created_at" in task))).toBe(true);
      if (pageNumber === 0) {
        expect(JSON.parse(Buffer.from(page.next_cursor!, "base64url").toString("utf8"))[0]).toBe(timestamps[1]);
        expect(page.tasks[1].created_at).toBeInstanceOf(Date);
      }
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual(timestamps.map((_, index) => `micro-${index}`));
  });
});
