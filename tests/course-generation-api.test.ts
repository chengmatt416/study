import { selfReviewFor } from "./helpers/blueprint-draft";
import { blueprint } from "./helpers/blueprint";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { generatedCourse, moduleOutput, planOutput, quizOutput, reviewOutput } from "./fixtures/course-generation";

// Execute the real migrations and route SQL against SQLite, including batch atomicity.
function d1(db: DatabaseSync) {
  const prepare = (sql: string, params: (string | number | null)[] = []) => ({
    execute: () => db.prepare(sql).all(...params),
    bind: (...values: (string | number | null)[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: db.prepare(sql).run(...params), results: [] }),
  });
  return {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push({ results: statement.execute() });
        db.exec("COMMIT");
        return results;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
}

describe("課程 API 與真實 MCP 工具鏈", () => {
  let db: DatabaseSync;
  const user = { id: "user-1", email: "learner@example.test", name: "Learner", avatar_url: null, role: "member" as const };
  const ctx = { waitUntil: () => undefined };
  let env: Parameters<typeof callApi>[0];
  const request = <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => callApi<T>(env, ctx as ExecutionContext, user, method, path, body);
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    for (const name of ["0001_init", "0002_booklets_trash", "0003_pause_review", "0004_note_courses", "0005_course_generations", "0006_access_groups", "0007_review_settings", "0008_mcp_pdf_grants", "0009_syllabi", "0010_private_content", "0011_openmaic_core_runs", "0013_ib_subject_resources", "0020_alignment", "0028_chapters", "0029_generation_reviews", "0030_content_judgments", "0031_chapter_visibility", "0032_chapter_material_books"]) db.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
    db.exec("INSERT INTO users (id,email,created_at) VALUES ('user-1','learner@example.test',1), ('user-2','other@example.test',1)");
    db.exec("INSERT INTO documents (id,kind,slug,title,status,created_by,created_at,updated_at) VALUES ('note-1','note','physics','Physics','published','user-1',1,1), ('exam-1','exam','exam','Exam','published','user-1',1,1)");
    db.exec("INSERT INTO revisions (id,document_id,body_md,source,created_at) VALUES ('revision-1','note-1','# Physics\nT = 2π√(m/k)','import',1)");
    db.exec("UPDATE documents SET current_revision_id='revision-1',baseline_revision_id='revision-1' WHERE id='note-1'");
    env = { DB: d1(db) } as Parameters<typeof callApi>[0];
  });
  afterEach(() => db.close());

  async function ready() {
    let result = await request("POST", "/api/course-generations", { note_slug: "physics", topic: "週期與質量" });
    for (const output of [planOutput, moduleOutput, quizOutput, reviewOutput]) {
      result = await request("POST", `/api/course-generations/${result.generation_id}/step`, { expected_version: result.version, output });
    }
    return result;
  }

  it("空課程、儲存、重讀、版本衝突與刪除級聯", async () => {
    expect(await request("GET", "/api/documents/physics/course")).toMatchObject({ course: null, version: 0 });
    await expect(request("PUT", "/api/documents/physics/course", { course: generatedCourse() })).rejects.toMatchObject({ status: 400 });
    await expect(request("PUT", "/api/documents/physics/course", { course: {}, expected_version: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(request("PUT", "/api/documents/exam/course", { course: generatedCourse(), expected_version: 0 })).rejects.toMatchObject({ status: 400 });
    expect(await request("PUT", "/api/documents/physics/course", { course: generatedCourse(), expected_version: 0 })).toMatchObject({ version: 1 });
    await expect(request("PUT", "/api/documents/physics/course", { course: generatedCourse(), expected_version: 0 })).rejects.toMatchObject({ status: 409 });
    expect(await request("PUT", "/api/documents/physics/course", { course: generatedCourse(), expected_version: 1 })).toMatchObject({ version: 2 });
    expect(await request("GET", "/api/documents/physics/course")).toMatchObject({ version: 2, course: generatedCourse() });
    db.exec("UPDATE documents SET status='archived' WHERE id='note-1'");
    await expect(request("GET", "/api/documents/physics/course")).rejects.toMatchObject({ status: 404 });
    db.exec("DELETE FROM documents WHERE id='note-1'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM note_courses").get()).toMatchObject({ n: 0 });
  });

  it("草稿可恢復、拒絕跳步與錯誤版本，所有步驟完成後原子發布", async () => {
    const start = await request("POST", "/api/course-generations", { note_slug: "physics", topic: "週期" });
    expect(start).toMatchObject({ step: "plan", version: 1, source_markdown: expect.stringContaining("Physics") });
    expect(await request("GET", `/api/course-generations/${start.generation_id}`)).toMatchObject({ step: "plan", version: 1 });
    await expect(request("POST", `/api/course-generations/${start.generation_id}/publish`, { expected_version: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(request("POST", `/api/course-generations/${start.generation_id}/step`, { expected_version: 1, output: moduleOutput })).rejects.toMatchObject({ status: 422 });
    const advanced = await request("POST", `/api/course-generations/${start.generation_id}/step`, { expected_version: 1, output: planOutput });
    expect(advanced).toMatchObject({ step: "module", version: 2 });
    await expect(request("POST", `/api/course-generations/${start.generation_id}/step`, { expected_version: 1, output: planOutput })).rejects.toMatchObject({ status: 409 });
    const result = await ready();
    const published = await request("POST", `/api/course-generations/${result.generation_id}/publish`, { expected_version: result.version });
    expect(published).toMatchObject({ status: "published", course_version: 1, url: "/notes/physics?view=course" });
    expect(await request("GET", `/api/course-generations/${result.generation_id}`)).toMatchObject({ status: "published" });
    expect(await request("GET", "/api/documents/physics/course")).toHaveProperty("course.scenes.length", 2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='course.save'").get()).toMatchObject({ n: 1 });
  });

  it("筆記變更或成品更新時不會覆蓋；草稿限本人存取", async () => {
    const result = await ready();
    await expect(callApi(env, ctx as ExecutionContext, { ...user, id: "user-2" }, "GET", `/api/course-generations/${result.generation_id}`)).rejects.toMatchObject({ status: 404 });
    await request("PUT", "/api/documents/physics/course", { course: generatedCourse(), expected_version: 0 });
    await expect(request("POST", `/api/course-generations/${result.generation_id}/publish`, { expected_version: result.version })).rejects.toMatchObject({ status: 409 });
    expect(await request("GET", `/api/course-generations/${result.generation_id}`)).toMatchObject({ status: "active" });
    const second = await ready();
    db.exec("UPDATE documents SET current_revision_id=NULL WHERE id='note-1'");
    await expect(request("POST", `/api/course-generations/${second.generation_id}/publish`, { expected_version: second.version })).rejects.toMatchObject({ status: 409 });
  });

  it("透過 MCP 協定完成工具探索與完整生成，read-only 授權不能建立草稿", async () => {
    async function connect(scopes: string[]) {
      const server = buildServer({ env, ctx: ctx as ExecutionContext, user, scopes, origin: "https://study.example.test" });
      const client = new Client({ name: "external-chatbot-test", version: "1.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      return { client, close: async () => { await client.close(); await server.close(); } };
    }
    const read = await connect(["study:read"]);
    try {
      const result = await read.client.callTool({ name: "submit_course_blueprint", arguments: { note_slug: "physics", topic: "週期", blueprint: blueprint(), self_review: selfReviewFor(blueprint()), mode: "yolo" } });
      expect(result.isError).toBe(true);
      expect(db.prepare("SELECT COUNT(*) AS n FROM course_generations").get()).toMatchObject({ n: 0 });
    } finally { await read.close(); }
    const write = await connect(["study:read", "study:write"]);
    try {
      const list = await write.client.listTools();
      expect(list.tools.some((t) => t.name === "save_note_course")).toBe(false);
      for (const name of ["start_course_generation", "submit_course_generation_step", "revise_course_generation", "publish_course_generation"]) {
        expect(list.tools.some((t) => t.name === name)).toBe(true);
        expect(WRITE_TOOLS.has(name)).toBe(true);
      }
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await write.client.callTool({ name, arguments: args });
        if (result.isError) throw new Error(JSON.stringify(result));
        const first = result.content[0];
        if (first.type !== "text") throw new Error("expected text");
        return JSON.parse(first.text);
      };
      const draft = await call("submit_course_blueprint", { note_slug: "physics", topic: "週期", blueprint: blueprint(), self_review: selfReviewFor(blueprint()), mode: "yolo" });
      expect(draft).toMatchObject({ status: "approved", mode: "yolo" });
      const unavailable = await write.client.callTool({ name: "start_course_generation", arguments: { note_slug: "physics", topic: "週期", blueprint_draft_id: draft.draft_id } });
      expect(unavailable.isError).toBe(true);
      expect(JSON.stringify(unavailable.content)).toContain("完整 OpenMAIC core");
      // Historical drafts still use the revision tools, but new MCP starts require the official core.
      let step = await request("POST", "/api/course-generations", { note_slug: "physics", topic: "週期" });
      for (const output of [planOutput, moduleOutput, quizOutput, reviewOutput]) step = await call("submit_course_generation_step", { generation_id: step.generation_id, expected_version: step.version, output });
      expect(step.step).toBe("publish");
      expect(await call("publish_course_generation", { generation_id: step.generation_id, expected_version: step.version })).toMatchObject({ status: "published", url: "https://study.example.test/notes/physics?view=course" });
    } finally { await write.close(); }
  });
});
