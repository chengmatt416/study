import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { withMcpScope } from "./context";
let pool: Pool;
vi.mock("@/lib/persistence/server-provider", () => ({
  getServerPersistenceProvider: async () => ({ pool }),
}));
import {
  TASK_SCHEMA,
  enqueueTask,
  submitTask,
  requestMcpOutput,
} from "./store";
const url = process.env.PG_CONTRACT_URL;
const schema = `study_mcp_qa_${Date.now()}`;
describe.skipIf(!url)("Durable PostgreSQL MCP turns", () => {
  beforeAll(async () => {
    const bootstrap = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 5000,
    });
    try {
      await bootstrap.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await bootstrap.end();
    }
    pool = new Pool({
      connectionString: url,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema}`,
    });
    await pool.query(TASK_SCHEMA);
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });
  it("deduplicates a replay and enforces owner and version atomically", async () => {
    const task = await enqueueTask(
      pool,
      "study:owner",
      "run-a",
      "outline",
      { prompt: "official" },
      0,
    );
    expect(
      (
        await enqueueTask(
          pool,
          "study:owner",
          "run-a",
          "outline",
          { prompt: "official" },
          0,
        )
      ).id,
    ).toBe(task.id);
    expect(
      await submitTask(pool, "study:other", task.id, 1, {
        text: "wrong owner",
      }),
    ).toBeNull();
    expect(
      await submitTask(pool, "study:owner", task.id, 2, { text: "stale" }),
    ).toBeNull();
    expect(
      await submitTask(pool, "study:owner", task.id, 1, { text: "valid" }),
    ).toMatchObject({ version: 2, status: "answered" });
    expect(
      await submitTask(pool, "study:owner", task.id, 1, { text: "replay" }),
    ).toBeNull();
  });
  it("resumes the provider after an external submission, including a fresh process scope replay", async () => {
    const request = { prompt: "scene prompt", tools: [] };
    const pending = withMcpScope("run-b", () =>
      requestMcpOutput("study:owner", "scene-content", request),
    );
    let id = "";
    await vi.waitFor(async () => {
      const read = await pool.query(
        "SELECT id FROM study_mcp_tasks WHERE run_id='run-b'",
      );
      expect(read.rows).toHaveLength(1);
      id = read.rows[0].id;
    });
    await submitTask(pool, "study:owner", id, 1, {
      text: "external model reply",
    });
    expect(await pending).toEqual({ text: "external model reply" });
    expect(
      await withMcpScope("run-b", () =>
        requestMcpOutput("study:owner", "scene-content", request),
      ),
    ).toEqual({ text: "external model reply" });
    expect(
      (await pool.query("SELECT id FROM study_mcp_tasks WHERE run_id='run-b'"))
        .rows,
    ).toHaveLength(1);
  });
  it("uses fresh model turns after an explicit retry epoch", async () => {
    const old = await enqueueTask(
      pool,
      "study:owner",
      "run-retry",
      "outline:epoch-0",
      { prompt: "outline" },
      0,
    );
    await submitTask(pool, "study:owner", old.id, 1, {
      text: "invalid outline",
    });
    await pool.query(
      "INSERT INTO study_mcp_epochs(owner_id,run_id,epoch,last_command) VALUES ('study:owner','run-retry',1,'retry-command')",
    );
    const pending = withMcpScope("run-retry", () =>
      requestMcpOutput("study:owner", "outline", { prompt: "outline" }),
    );
    let id = "";
    await vi.waitFor(async () => {
      const read = await pool.query(
        "SELECT id FROM study_mcp_tasks WHERE run_id='run-retry' AND source='outline:epoch-1'",
      );
      expect(read.rows).toHaveLength(1);
      id = read.rows[0].id;
    });
    expect(id).not.toBe(old.id);
    await submitTask(pool, "study:owner", id, 1, { text: "corrected outline" });
    expect(await pending).toEqual({ text: "corrected outline" });
  });
  it("an aborted process releases its waiter without deleting the durable task", async () => {
    const abort = new AbortController();
    const pending = withMcpScope("run-c", () =>
      requestMcpOutput(
        "study:owner",
        "actions",
        { prompt: "actions" },
        abort.signal,
      ),
    );
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(async () =>
      expect(
        (
          await pool.query(
            "SELECT id FROM study_mcp_tasks WHERE run_id='run-c'",
          )
        ).rows,
      ).toHaveLength(1),
    );
    abort.abort();
    await rejection;
    expect(
      (
        await pool.query(
          "SELECT status FROM study_mcp_tasks WHERE run_id='run-c'",
        )
      ).rows[0].status,
    ).toBe("pending");
  });
});
