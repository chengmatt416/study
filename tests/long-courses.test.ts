import { passClassroomReview, startFromBlueprint } from "./helpers/blueprint-draft";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./helpers/d1";
import { blueprint } from "./helpers/blueprint";
import { callApi } from "../src/worker/mcp/internal";
import type { OpenMaicCoreEnv } from "../src/worker/lib/openmaic-core";
import { verifyOpenMaicTicket } from "../src/shared/openmaic-transport";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const user = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
const secret = "long-course-test-transport-secret-32-characters";
const alignedScenes = () => [
  ...blueprint().chapters.map((chapter) => ({ id: "pre-" + chapter.key, type: "quiz", title: `先測：${chapter.key}`, content: { type: "quiz", questions: ["q1__d1", "q2__d2", "q3__d2", "q4__d3__m_trap", "q5__d3", "q6__d1"].map((id) => ({ id })) } })),
  ...blueprint().chapters.flatMap((chapter) => [
    { id: "l-" + chapter.key, type: "slide", title: chapter.key, content: { type: "slide", canvas: { elements: [] } } },
    { id: "r-" + chapter.key, type: "slide", title: `${chapter.key}〔補強〕`, content: { type: "slide", canvas: { elements: [] } } },
    { id: "q-" + chapter.key, type: "slide", title: `${chapter.key}〔精簡〕`, content: { type: "slide", canvas: { elements: [] } } },
    { id: "c-" + chapter.key, type: "quiz", title: `檢核：${chapter.key}`, content: { type: "quiz", questions: [{ id: "k1__d2" }, { id: "k2__d3" }] } },
  ]),
  { id: "end", type: "interactive", title: "課後：字卡與模考", content: { type: "interactive" } },
];
describe("bounded long-course collections", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: OpenMaicCoreEnv;
  let runCount: number;
  let changeRevisionOnPublish: boolean;
  let failStart: boolean;
  let loseStartResponse: boolean;
  let lastSubmission: unknown;
  let coreCalls: string[];
  let stageDocument: { stage: { id: string }; scenes: Record<string, unknown>[] } | null;
  let tasks: Record<string, { run_id: string; source: string }>;
  const sentMaterials: string[] = [];
  const startedParts = new Map<string, string>();
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const collection = () => api<{ id: string }>("POST", "/api/long-courses", { note_slug: "native", title: "A complete physics course" });
  const addPart = (id: string, key = "chapter-1", source = "# Chapter one\nFull source, derivation and examples.") => api<{ id: string; position: number; source_hash: string; reused?: boolean }>("POST", `/api/long-courses/${id}/parts`, { part_key: key, title: key, source_md: source, blueprint: blueprint() });
  beforeEach(() => {
    fixture = testDatabase(); runCount = 0; changeRevisionOnPublish = false; failStart = false; loseStartResponse = false; sentMaterials.length = 0; lastSubmission = undefined; startedParts.clear(); coreCalls = []; stageDocument = null; tasks = {};
    for (const who of [user, other]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,?,1)").run(who.email, who.role);
    }
    fixture.db.exec(`INSERT INTO documents(id,kind,slug,title,status,created_by,created_at,updated_at) VALUES ('note','note','native','Physics','published','owner',1,1);
      INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('r1','note','# Original note','import',1);
      UPDATE documents SET current_revision_id='r1' WHERE id='note';`);
    env = { DB: fixture.DB, OPENMAIC_CORE_URL: "https://core.example.test", OPENMAIC_MCP_SECRET: secret } as OpenMaicCoreEnv;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      const ticket = await verifyOpenMaicTicket(new Headers(init.headers).get("authorization")!.slice(7), secret);
      expect(ticket?.sub).toBe("study:owner");
      const path = new URL(url).pathname;
      coreCalls.push(`${init.method ?? "GET"} ${path}`);
      const planned = tasks[path.replace("/api/study-mcp/tasks/", "")];
      if (planned && init.method === "GET") return Response.json(planned);
      if (path.endsWith("/validate") && init.method === "POST") lastSubmission = JSON.parse(String(init.body));
      if (planned || path.endsWith("/validate") && tasks[path.replace("/api/study-mcp/tasks/", "").replace("/validate", "")]) return Response.json({ ok: true, validation_receipt: "c".repeat(64) });
      if (path.startsWith("/api/generation-runs/") && init.method === "GET") return Response.json({ success: true, run: { id: path.split("/").pop(), state: "generating", stageId: `stage-${path.split("/").pop()}` } });
      if (stageDocument && path === `/api/stages/${stageDocument.stage.id}`) {
        if (init.method === "PUT") { stageDocument = JSON.parse(String(init.body)); return Response.json({ success: true }); }
        return Response.json(stageDocument);
      }
      if (path === "/api/materials") { sentMaterials.push(String(init.body)); return Response.json({ materialId: "material-1" }); }
      if (path === "/api/generation-runs") {
        if (failStart) return Response.json({ error: "Core unavailable" }, { status: 503 });
        return Response.json({ run: { id: `run-${++runCount}` } });
      }
      if (path === "/api/study-mcp/start-part") {
        const { part_id, input } = JSON.parse(String(init.body));
        expect(typeof part_id).toBe("string"); expect(input).toMatchObject({ interactive: true, materialIds: ["material-1"] });
        if (failStart) return Response.json({ error: "Core unavailable" }, { status: 503 });
        const existing = startedParts.get(part_id);
        if (existing) return Response.json({ run: { id: existing }, idempotent: true });
        const id = `run-${++runCount}`; startedParts.set(part_id, id);
        if (loseStartResponse) throw new DOMException("Response lost after core committed the run", "TimeoutError");
        return Response.json({ run: { id }, idempotent: false }, { status: 202 });
      }
      if (path.startsWith("/api/generate-classroom/")) {
        if (changeRevisionOnPublish) fixture.db.exec("UPDATE documents SET current_revision_id=NULL WHERE id='note'");
        return Response.json({ status: "succeeded", result: { classroomId: path.replace("/api/generate-classroom/", "classroom-") } });
      }
      if (path.startsWith("/api/stages/")) return Response.json({ scenes: alignedScenes() });
      if (path === "/api/study-mcp/tasks/task-1/validate") {
        lastSubmission = JSON.parse(String(init.body));
        return Response.json({ ok: true, validation_receipt: "b".repeat(64), expected_version: 3 });
      }
      if (path === "/api/study-mcp/tasks/task-1" && init.method === "GET" && new URL(url).searchParams.get("peek")) return Response.json({ run_id: "run-1", source: "classroom:epoch-0", text: "{}", next_offset: null });
      if (path === "/api/study-mcp/tasks/task-1" && init.method === "GET") {
        expect(new URL(url).searchParams.get("offset")).toBe("20");
        expect(new URL(url).searchParams.get("limit")).toBe("100");
        return Response.json({ task_id: "task-1", offset: 20, context: "Complete chunk from official core", next_offset: 120, request_sha256: "a".repeat(64) });
      }
      if (path === "/api/study-mcp/tasks/task-1") { lastSubmission = JSON.parse(String(init.body)); return Response.json({ status: "answered" }); }
      return Response.json({});
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); fixture.db.close(); });

  it("retains complete million-character source across bounded parts and pages only metadata", async () => {
    const course = await collection();
    const chunk = "Exact source with equations and examples.\n".repeat(1000);
    expect(chunk.length).toBeLessThan(45_000);
    for (let index = 0; index < 25; index++) await addPart(course.id, `chapter-${index}`, chunk);
    const first = await api<{ source_chars: number; total_parts: number; next_offset: number; parts: { id: string; source_chars: number }[] }>("GET", `/api/long-courses/${course.id}?limit=10`);
    expect(first.total_parts).toBe(25); expect(first.source_chars).toBe(chunk.length * 25); expect(first.source_chars).toBeGreaterThan(1_000_000);
    expect(first.parts).toHaveLength(10); expect(first.next_offset).toBe(10);
    expect(JSON.stringify(first)).not.toContain("source_md");
    const second = await api<{ parts: { id: string }[] }>("GET", `/api/long-courses/${course.id}?limit=10&offset=10`);
    expect(second.parts).toHaveLength(10); expect(second.parts[0].id).not.toBe(first.parts[0].id);
    const recovered: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await api<{ source_md: string; next_offset: number | null }>("GET", `/api/long-courses/${course.id}/parts/${first.parts[0].id}?limit=10000&offset=${offset}`);
      recovered.push(page.source_md); offset = page.next_offset;
    }
    expect(recovered.join("")).toBe(chunk);
  });
  it("rejects overlarge input before core can silently truncate it", async () => {
    const course = await collection();
    await expect(addPart(course.id, "too-large", "a".repeat(45_001))).rejects.toMatchObject({ status: 400 });
    fixture.db.prepare("UPDATE revisions SET body_md=? WHERE id='r1'").run("b".repeat(45_001));
    await expect(startFromBlueprint(api, { note_slug: "native", blueprint: blueprint() })).rejects.toMatchObject({ status: 413 });
    expect(sentMaterials).toEqual([]); expect(runCount).toBe(0);
  });
  it("stores Unicode source counts and aggregates metadata without reading source text", async () => {
    const course = await collection(), source = "# Unicode source\n精準保留中文與補充字元 🧪📖";
    const part = await addPart(course.id, "unicode", source);
    const count = Array.from(source).length;
    expect(fixture.db.prepare("SELECT source_chars FROM long_course_parts WHERE id=?").get(part.id)).toMatchObject({ source_chars: count });
    const prepare = vi.spyOn(env.DB, "prepare");
    const metadata = await api<{ source_chars: number; parts: { source_chars: number }[] }>("GET", `/api/long-courses/${course.id}`);
    expect(metadata.source_chars).toBe(count); expect(metadata.parts[0].source_chars).toBe(count);
    const queries = prepare.mock.calls.map(([sql]) => sql);
    expect(queries.some(sql => sql.includes("SUM(source_chars)"))).toBe(true);
    expect(queries.some(sql => /length\(source_md\)/i.test(sql))).toBe(false);
    const plan = fixture.db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*),COUNT(published_at),SUM(source_chars) FROM long_course_parts WHERE course_id=?").all(course.id);
    expect(JSON.stringify(plan)).toContain("COVERING INDEX long_course_parts_counts");
    prepare.mockRestore();
  });
  it("pages sources by whole Unicode codepoints without splitting supplementary characters", async () => {
    const course = await collection(), source = "中🧪📖𠀀A\n終";
    const part = await addPart(course.id, "unicode-pages", source);
    const chunks: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = await api<{ source_md: string; total_chars: number; next_offset: number | null; offset_unit: string }>("GET", `/api/long-courses/${course.id}/parts/${part.id}?offset=${offset}&limit=1`);
      expect(chunk.offset_unit).toBe("unicode_codepoints");
      expect(chunk.total_chars).toBe(Array.from(source).length);
      expect(Array.from(chunk.source_md)).toHaveLength(1);
      expect(chunk.source_md.isWellFormed()).toBe(true);
      chunks.push(chunk.source_md); offset = chunk.next_offset;
    }
    expect(chunks).toEqual(Array.from(source)); expect(chunks.join("")).toBe(source);
    await expect(api("GET", `/api/long-courses/${course.id}/parts/${part.id}?offset=${Array.from(source).length + 1}`)).rejects.toMatchObject({ status: 400 });
  });
  it("backfills counts for existing parts without changing their source", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const migrations = readdirSync(new URL("../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).sort();
      for (const migration of migrations.filter(name => name < "0025")) db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
      const source = "Existing source with 中文 and 🧪 supplementary characters";
      db.exec("INSERT INTO users(id,email,created_at) VALUES ('owner','old@test.example',1); INSERT INTO documents(id,kind,slug,title,created_at,updated_at) VALUES ('note','note','old','Old note',1,1)");
      db.prepare("INSERT INTO long_courses(id,document_id,created_by,title,created_at) VALUES ('old','note','owner','Old',1)").run();
      db.prepare("INSERT INTO long_course_parts(id,course_id,part_key,position,title,source_md,source_hash,blueprint_json,created_at) VALUES ('old-part','old','first',1,'Old',?,'hash','{}',1)").run(source);
      db.exec(readFileSync(new URL("../migrations/0025_long_course_source_counts.sql", import.meta.url), "utf8"));
      expect(db.prepare("SELECT source_chars,source_md FROM long_course_parts WHERE id='old-part'").get()).toMatchObject({ source_chars: Array.from(source).length, source_md: source });
    } finally { db.close(); }
  });
  it("reuses identical append keys and refuses a changed key without duplicating source", async () => {
    const course = await collection();
    const first = await addPart(course.id);
    expect(await addPart(course.id)).toMatchObject({ id: first.id, position: 1, reused: true });
    await expect(addPart(course.id, "chapter-1", "Changed source")).rejects.toMatchObject({ status: 409 });
    expect((await addPart(course.id, "chapter-2")).position).toBe(2);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM long_course_parts").get()).toMatchObject({ n: 2 });
  });
  it("keeps draft sources owner-only and allows other readers to see only published parts", async () => {
    const course = await collection(), part = await addPart(course.id);
    await expect(api("GET", `/api/long-courses/${course.id}/parts/${part.id}`, undefined, other)).rejects.toMatchObject({ status: 403 });
    await expect(api("POST", `/api/long-courses/${course.id}/parts`, { part_key: "bad", title: "Bad", source_md: "Other source", blueprint: blueprint() }, other)).rejects.toMatchObject({ status: 403 });
    expect(await api("GET", `/api/long-courses/${course.id}`, undefined, other)).toMatchObject({ total_parts: 0, parts: [] });
    await expect(api("POST", "/api/openmaic/generations", { long_course_part_id: part.id }, other)).rejects.toMatchObject({ status: 404 });
    fixture.db.exec("UPDATE documents SET visibility='private' WHERE id='note'");
    await expect(api("GET", `/api/long-courses/${course.id}`, undefined, other)).rejects.toMatchObject({ status: 404 });
  });
  it("locks concurrent starts, recovers expired leases and resumes the same official generation", async () => {
    const course = await collection(), part = await addPart(course.id);
    fixture.db.prepare("UPDATE long_course_parts SET start_lease=? WHERE id=?").run(Date.now(), part.id);
    await expect(api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).rejects.toMatchObject({ status: 409 });
    expect(runCount).toBe(0);
    fixture.db.prepare("UPDATE long_course_parts SET start_lease=? WHERE id=?").run(Date.now() - 180_000, part.id);
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).toHaveProperty("generation_id", "run-1");
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).toMatchObject({ generation_id: "run-1", reused: true });
    expect(runCount).toBe(1); expect(sentMaterials).toHaveLength(1);
    expect(fixture.db.prepare("SELECT start_lease FROM long_course_parts WHERE id=?").get(part.id)).toMatchObject({ start_lease: null });
  });
  it("releases start leases after core rejection for an explicit retry", async () => {
    const course = await collection(), part = await addPart(course.id);
    failStart = true;
    await expect(api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).rejects.toMatchObject({ status: 502 });
    expect(fixture.db.prepare("SELECT start_lease,generation_id FROM long_course_parts WHERE id=?").get(part.id)).toMatchObject({ start_lease: null, generation_id: null });
    failStart = false;
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).toHaveProperty("generation_id", "run-1");
  });
  it("recovers the same official run when a successful start response is lost", async () => {
    const course = await collection(), part = await addPart(course.id);
    loseStartResponse = true;
    await expect(api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).rejects.toMatchObject({ status: 503 });
    loseStartResponse = false;
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).toHaveProperty("generation_id", "run-1");
    expect(runCount).toBe(1);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM openmaic_core_runs").get()).toMatchObject({ n: 1 });
  });
  it("publishes and launches multiple official classrooms without overwriting the note course", async () => {
    const course = await collection(), first = await addPart(course.id), second = await addPart(course.id, "chapter-2");
    fixture.db.exec("INSERT INTO note_courses(document_id,course_json,version,updated_by,updated_at) VALUES ('note','{\"original\":true}',7,'owner',1)");
    for (const [part, id] of [[first, "run-1"], [second, "run-2"]] as const) {
      await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
      expect(await api("POST", `/api/openmaic/generations/${id}/publish`, {})).toMatchObject({ part_id: part.id, classroom_id: `classroom-${id}` });
    }
    expect(fixture.db.prepare("SELECT course_json,version FROM note_courses WHERE document_id='note'").get()).toMatchObject({ course_json: '{"original":true}', version: 7 });
    expect(await api("GET", `/api/long-courses/${course.id}`, undefined, other)).toMatchObject({ total_parts: 2, published_parts: 2 });
    fixture.db.exec("DELETE FROM note_courses WHERE document_id='note'");
    expect(await api("GET", "/api/documents")).toMatchObject({ documents: [{ id: "note", has_course: 1 }] });
    expect(await api("GET", "/api/content")).toMatchObject({ items: [{ id: "note", has_course: true }] });
    const launch = await api<{ ticket: string }>("POST", `/api/long-courses/${course.id}/parts/${first.id}/launch`, {}, other);
    expect(await verifyOpenMaicTicket(launch.ticket, secret)).toMatchObject({ sub: "study:other", classroom_id: "classroom-run-1", scope: "classroom" });
  });
  it("recovers an existing local run whose part link was lost", async () => {
    const course = await collection(), part = await addPart(course.id);
    const started = await api<{ generation_id: string }>("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    fixture.db.prepare("UPDATE long_course_parts SET generation_id=NULL WHERE id=?").run(part.id);
    const recovered = await api<{ generation_id: string }>("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    expect(recovered.generation_id).toBe(started.generation_id);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM openmaic_core_runs").get()).toEqual({ n: 1 });
    expect(fixture.db.prepare("SELECT generation_id FROM long_course_parts WHERE id=?").get(part.id)).toEqual({ generation_id: started.generation_id });
  });
  it("publishes a part from its own stored source even when the note changes during generation", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    changeRevisionOnPublish = true;
    expect(await api("POST", "/api/openmaic/generations/run-1/publish", {})).toMatchObject({ part_id: part.id, classroom_id: "classroom-run-1" });
    expect(fixture.db.prepare("SELECT classroom_id FROM long_course_parts WHERE id=?").get(part.id)).toEqual({ classroom_id: "classroom-run-1" });
  });
  it("still refuses a note's own classroom when the note changes during generation", async () => {
    await startFromBlueprint(api, { note_slug: "native", blueprint: blueprint() });
    fixture.db.exec("UPDATE documents SET current_revision_id=NULL WHERE id='note'");
    await expect(api("POST", "/api/openmaic/generations/run-1/publish", {})).rejects.toMatchObject({ status: 409 });
  });
  it("edits an unstarted part, keeps the same key working, and refuses once generation has started", async () => {
    const course = await collection(), part = await addPart(course.id);
    expect(await api("PATCH", `/api/long-courses/${course.id}/parts/${part.id}`, { title: "Renamed", source_md: "# Better source" })).toMatchObject({ id: part.id, position: 1 });
    expect(fixture.db.prepare("SELECT title,source_md,source_chars FROM long_course_parts WHERE id=?").get(part.id)).toEqual({ title: "Renamed", source_md: "# Better source", source_chars: 15 });
    await expect(api("PATCH", `/api/long-courses/${course.id}/parts/${part.id}`, { blueprint: { schema: "wrong" } })).rejects.toMatchObject({ status: 422 });
    await expect(api("PATCH", `/api/long-courses/${course.id}/parts/${part.id}`, { title: "Stolen" }, other)).rejects.toMatchObject({ status: 403 });
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    await expect(api("PATCH", `/api/long-courses/${course.id}/parts/${part.id}`, { title: "Too late" })).rejects.toMatchObject({ status: 409 });
  });
  it("moves a part in both directions without gaps or collisions", async () => {
    const course = await collection(), keys = ["one", "two", "three", "four"];
    const parts = []; for (const key of keys) parts.push(await addPart(course.id, key));
    const order = () => (fixture.db.prepare("SELECT part_key FROM long_course_parts ORDER BY position").all() as { part_key: string }[]).map(row => row.part_key);
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${parts[3].id}/move`, { position: 1 })).toMatchObject({ position: 1, moved: true });
    expect(order()).toEqual(["four", "one", "two", "three"]);
    await api("POST", `/api/long-courses/${course.id}/parts/${parts[3].id}/move`, { position: 3 });
    expect(order()).toEqual(["one", "two", "four", "three"]);
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${parts[0].id}/move`, { position: 99 })).toMatchObject({ position: 4, moved: true });
    expect(order()).toEqual(["two", "four", "three", "one"]);
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${parts[0].id}/move`, { position: 4 })).toMatchObject({ moved: false });
    expect((fixture.db.prepare("SELECT position FROM long_course_parts ORDER BY position").all() as { position: number }[]).map(row => row.position)).toEqual([1, 2, 3, 4]);
    await expect(api("POST", `/api/long-courses/${course.id}/parts/${parts[0].id}/move`, { position: 0 })).rejects.toMatchObject({ status: 400 });
  });
  it("resets a stuck part: ends the run, starts a new attempt, and the old run can no longer publish over the note", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${part.id}/reset`, {})).toMatchObject({ reset: true });
    expect(coreCalls).toEqual(expect.arrayContaining(["GET /api/generation-runs/run-1", "DELETE /api/stages/stage-run-1", "DELETE /api/study-mcp/runs/run-1/tasks"]));
    expect(fixture.db.prepare("SELECT generation_id,generation_attempt FROM long_course_parts WHERE id=?").get(part.id)).toEqual({ generation_id: null, generation_attempt: 1 });
    await expect(api("POST", "/api/openmaic/generations/run-1/publish", {})).rejects.toMatchObject({ status: 404 });
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${part.id}/reset`, {})).toMatchObject({ reset: false });
    await api("PATCH", `/api/long-courses/${course.id}/parts/${part.id}`, { source_md: "# Corrected source" });
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).toHaveProperty("generation_id", "run-2");
    expect([...startedParts.keys()]).toEqual([part.id, `${part.id}:1`]);
    expect(sentMaterials.at(-1)).toBe("# Corrected source");
  });
  it("keeps the published classroom open while a part is regenerated, and swaps it on the next publish", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    await api("POST", "/api/openmaic/generations/run-1/publish", {});
    vi.mocked(fetch).mockClear(); coreCalls = [];
    const stubbed = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => new URL(String(url)).pathname === "/api/generation-runs/run-1" ? Response.json({ run: { state: "completed", stageId: "classroom-run-1" } }) : stubbed(url, init));
    await api("POST", `/api/long-courses/${course.id}/parts/${part.id}/reset`, {});
    expect(coreCalls.filter(call => call.startsWith("DELETE /api/stages"))).toEqual([]);
    expect(await api("GET", `/api/long-courses/${course.id}`, undefined, other)).toMatchObject({ published_parts: 1 });
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${part.id}/launch`, {}, other)).toMatchObject({ classroom_id: "classroom-run-1" });
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    await api("POST", "/api/openmaic/generations/run-2/publish", {});
    expect(await api("POST", `/api/long-courses/${course.id}/parts/${part.id}/launch`, {}, other)).toMatchObject({ classroom_id: "classroom-run-2" });
  });
  it("deletes a part and closes the gap, and deletes a whole course without touching the note", async () => {
    const course = await collection(), first = await addPart(course.id, "one"), second = await addPart(course.id, "two"), third = await addPart(course.id, "three");
    await api("POST", "/api/openmaic/generations", { long_course_part_id: first.id });
    await api("POST", "/api/openmaic/generations/run-1/publish", {});
    await expect(api("DELETE", `/api/long-courses/${course.id}/parts/${second.id}`, undefined, other)).rejects.toMatchObject({ status: 403 });
    expect(await api("DELETE", `/api/long-courses/${course.id}/parts/${first.id}`)).toMatchObject({ deleted: true });
    expect(coreCalls).toEqual(expect.arrayContaining(["DELETE /api/stages/stage-run-1", "DELETE /api/stages/classroom-run-1"]));
    expect(fixture.db.prepare("SELECT id,position FROM long_course_parts ORDER BY position").all()).toEqual([{ id: second.id, position: 1 }, { id: third.id, position: 2 }]);
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM openmaic_core_runs").get()).toEqual({ n: 0 });
    expect((await addPart(course.id, "four")).position).toBe(3);
    expect(await api("DELETE", `/api/long-courses/${course.id}`)).toMatchObject({ deleted: true });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM long_course_parts").get()).toEqual({ n: 0 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE id='note'").get()).toEqual({ n: 1 });
  });
  it("refuses a blueprint too long to start when the part is added, not later", async () => {
    const course = await collection(), long = "很長的章節摘要說明".repeat(33);
    const huge = { ...blueprint(), chapters: Array.from({ length: 12 }, (_, index) => ({ ...blueprint().chapters[0], key: `第${index}章`, prerequisites: [], summary: long, difficulty: 1, objectives: [{ id: `o-${index}`, text: long, command_term: "define", syllabus_ref: "1", bloom: "remember" }, { id: `p-${index}`, text: long, command_term: "define", syllabus_ref: "1", bloom: "remember" }, { id: `q-${index}`, text: long, command_term: "define", syllabus_ref: "1", bloom: "remember" }] })) };
    const failure = await api("POST", `/api/long-courses/${course.id}/parts`, { part_key: "huge", title: "Huge", source_md: "# Source", blueprint: huge }).catch(error => error);
    expect(failure.status).toBe(422);
    expect(failure.details.join()).toContain("生成需求");
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM long_course_parts").get()).toEqual({ n: 0 });
  });
  it("keeps the IB document list out of the requirement and out of every step", async () => {
    for (let index = 0; index < 200; index++) fixture.db.prepare("INSERT INTO books(id,title,kind,status,ib_document_type,ib_level,size_bytes,created_at,updated_at) VALUES (?,?,'syllabus','ready','syllabus','both',1,1,1)").run(`ib-${index}`, `IB syllabus ${index} with a long descriptive title for the budget`);
    const course = await collection(), part = await api<{ id: string }>("POST", `/api/long-courses/${course.id}/parts`, { part_key: "unit", title: "Unit", source_md: "# Source", blueprint: { ...blueprint(), source_exemptions: [{ kind: "ib_syllabus", reason: "這門課不使用 IB 文件作為依據" }] } });
    const sent: { requirement?: string }[] = [];
    const stubbed = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => { if (new URL(String(url)).pathname === "/api/study-mcp/start-part") sent.push(JSON.parse(String(init?.body)).input); return stubbed(url, init); });
    expect(await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id })).not.toHaveProperty("ib_references");
    expect(sent[0].requirement).toContain("list_ib_resources"); expect(sent[0].requirement).not.toContain("IB syllabus 7");
    expect(await api("GET", "/api/openmaic/generations/run-1?summary=true")).not.toHaveProperty("ib_references");
  });
  it("still blocks a group without AI access now that the IB list is gone", async () => {
    const course = await collection(), first = await addPart(course.id), second = await addPart(course.id, "chapter-2");
    await api("POST", "/api/openmaic/generations", { long_course_part_id: first.id });
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1); INSERT INTO access_group_members(group_id,email) VALUES ('students','owner@test.example'); INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','feature','ai',0)");
    await expect(api("GET", "/api/openmaic/generations/run-1")).rejects.toMatchObject({ status: 403 });
    await expect(api("POST", "/api/openmaic/generations", { long_course_part_id: second.id })).rejects.toMatchObject({ status: 403 });
    expect(fixture.db.prepare("SELECT start_lease FROM long_course_parts WHERE id=?").get(second.id)).toEqual({ start_lease: null });
  });
  it("rejects an outline that drifts from its blueprint before any scene is generated", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    tasks.outline = { run_id: "run-1", source: "scene-outlines-stream:epoch-0" };
    const verification = { request_sha256: "a".repeat(64), remaining_issues: [], checks: [] };
    const validate = (outlines: unknown[]) => api<{ ok: boolean; errors?: string[]; validation_receipt?: string }>("POST", "/api/openmaic/tasks/outline/validate", { expected_version: 1, output: { text: JSON.stringify({ languageDirective: "繁中", outlines }), verification } });
    const good: { type: string; title: string; quizConfig?: { questionCount: number } }[] = [...blueprint().chapters.map(c => ({ type: "quiz", title: `先測：${c.key}`, quizConfig: { questionCount: 6 } })), ...blueprint().chapters.flatMap(c => [{ type: "slide", title: c.key }, { type: "slide", title: `${c.key}｜例題` }, { type: "quiz", title: `檢核：${c.key}`, quizConfig: { questionCount: 4 } }, { type: "slide", title: `${c.key}〔補強〕` }, { type: "slide", title: `${c.key}〔精簡〕` }]), { type: "interactive", title: "課後：字卡與模考" }];
    const renamed = good.map(scene => scene.title === "檢核：頻率" ? { ...scene, title: "頻率的檢核" } : scene);
    const refused = await validate(renamed);
    expect(refused.ok).toBe(false); expect(refused.errors!.join()).toContain("缺少檢核場景「檢核：頻率」");
    expect(lastSubmission).toBeUndefined();
    const stranded = [...good]; stranded.splice(good.findIndex(scene => scene.title === "頻率"), 0, { type: "slide", title: "兩章之間的補充" });
    expect((await validate(stranded)).errors!.join()).toContain("兩章之間的補充");
    expect((await validate(Array.from({ length: 101 }, () => good[0]).concat(good))).errors!.join()).toContain("官方只保留前 100 個");
    expect((await validate(good.map(scene => scene.title === "週期｜例題" ? { ...scene, title: "練習題" } : scene))).errors!.join()).toContain("投影片「練習題」");
    expect(await validate(good)).toMatchObject({ ok: true, validation_receipt: "c".repeat(64) });
    expect(lastSubmission).toMatchObject({ expected_version: 1 });
    lastSubmission = undefined;
    await expect(api("POST", "/api/openmaic/tasks/outline", { expected_version: 1, output: { text: JSON.stringify({ outlines: renamed }), verification } })).rejects.toMatchObject({ status: 422 });
    expect(lastSubmission).toBeUndefined();
  });
  it("rejects a slide draft that asks a question and accepts one that teaches about the exam", async () => {
    tasks.slide = { run_id: "run-1", source: "scene-content:slide:epoch-0" };
    tasks.widget = { run_id: "run-1", source: "scene-content:interactive:epoch-0" };
    const validate = (task: string, content: string) => api<{ ok: boolean; errors?: string[] }>("POST", `/api/openmaic/tasks/${task}/validate`, { expected_version: 1, output: { text: JSON.stringify({ elements: [{ type: "text", content: `<p>${content}</p>` }] }) } });
    const asking = await validate("slide", "下列何者正確？請選出正確的一項。");
    expect(asking.ok).toBe(false); expect(asking.errors!.join()).toContain("要學生作答的提問");
    expect(await validate("slide", "計算題常見陷阱：單位要先換算")).toMatchObject({ ok: true });
    expect(await validate("widget", "下列何者正確？請選出正確的一項。")).toMatchObject({ ok: true });
    coreCalls = [];
    await api("POST", "/api/openmaic/tasks/widget/validate", { expected_version: 1, output: { text: "<div>not a slide or an outline</div>" } });
    expect(coreCalls).toEqual(["GET /api/study-mcp/tasks/widget", "POST /api/study-mcp/tasks/widget/validate"]);
  });
  it("checks quiz, module and narration drafts of a planned course before the turn is accepted", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    const task = (stage: string, user: string) => ({ run_id: "run-1", source: `${stage}:epoch-0`, next_offset: null, text: JSON.stringify({ prompt: [{ role: "system", content: "rules" }, { role: "user", content: [{ type: "text", text: user }] }] }) });
    const validate = (id: string, text: string) => api<{ ok: boolean; errors?: string[]; warnings?: string[] }>("POST", `/api/openmaic/tasks/${id}/validate`, { expected_version: 1, output: { text } });
    const question = (id: string) => ({ id, type: "single", question: "質量變 4 倍，週期變幾倍？", options: ["A", "B", "C"].map(value => ({ value, label: `選項 ${value}` })), answer: ["A"], analysis: "T 與 √m 成正比，所以變 2 倍。" });

    tasks.quiz = task("scene-content:quiz", "Title: 先測：週期\nDescription: d\nQuestion Count: 6");
    const untagged = await validate("quiz", JSON.stringify(["q1", "q2", "q3"].map(question)));
    expect(untagged.ok).toBe(false); expect(untagged.errors!.join()).toContain("沒有難度標記"); expect(untagged.errors!.join()).toContain("先測每章 5 到 6 題");
    expect(lastSubmission).toBeUndefined();
    expect(await validate("quiz", "```json\n" + JSON.stringify(["q1__d1", "q2__d2", "q3__d2", "q4__d3", "q5__d3"].map(question)) + "\n```")).toMatchObject({ ok: true });
    expect((await validate("quiz", "題目如下，但不是 JSON")).errors!.join()).toContain("草稿讀不出來");

    tasks.outline = { run_id: "run-1", source: "scene-outlines-stream:epoch-0" };
    expect((await validate("outline", "我先說明規劃，稍後再給大綱。")).errors!.join()).toContain("草稿讀不出來");
    const wrapped = await validate("outline", "以下是大綱：\n```json\n" + JSON.stringify({ outlines: [{ type: "slide", title: "只有一頁" }] }) + "\n```");
    expect(wrapped.ok).toBe(false); expect(wrapped.errors!.join()).toContain("缺少前測場景");

    tasks.widget = task("scene-content:interactive", "Title: 週期｜動手做\nWidget Type: simulation");
    const page = (body: string) => `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`;
    expect((await validate("widget", page('<input type="range"><button>開始</button>'))).errors!.join()).toContain("沒有使用 <sk-*> 元件庫");
    expect(await validate("widget", page('<sk-module heading="彈簧"><sk-lab><sk-item kind="spring" id="sp"></sk-item></sk-lab><sk-numeric id="q" question="週期？" answer="2"><sk-explain>解說</sk-explain></sk-numeric></sk-module>'))).toMatchObject({ ok: true });

    tasks.actions = task("scene-actions", "Title: 週期｜動手做\nWidget Type: simulation");
    expect((await validate("actions", JSON.stringify([{ type: "text", content: "自己試試看。" }]))).errors!.join()).toContain("沒有指出操作目標");
    const guided = await validate("actions", JSON.stringify([{ type: "action", name: "widget_highlight", params: { target: "#sp" } }, { type: "text", content: "把砝碼掛上彈簧。" + "接著觀察。".repeat(20) }]));
    expect(guided.ok).toBe(true); expect(guided.warnings!.join()).toContain("超過 80 字");
    tasks.narration = task("scene-actions", "Elements: []\nTitle: 週期");
    expect((await validate("narration", JSON.stringify([{ type: "text", content: "換你算：請計算質量 4 倍時的週期是多少？" }]))).errors!.join()).toContain("教師講述要學生作答");
  });
  it("makes an edited classroom be reviewed again before it can be published", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    stageDocument = { stage: { id: "classroom-run-1" }, scenes: alignedScenes() };
    fixture.db.exec(`UPDATE openmaic_core_runs SET completion_review_json='{"verdict":"pass"}' WHERE id='run-1'`);
    expect(await api("PATCH", "/api/openmaic/generations/run-1/scenes/l-週期", { title: "週期" })).toMatchObject({ updated: true, review_required: true });
    expect(fixture.db.prepare("SELECT completion_review_json FROM openmaic_core_runs WHERE id='run-1'").get()).toEqual({ completion_review_json: null });
    expect(await api("PATCH", "/api/openmaic/generations/run-1/scenes/l-週期", { title: "週期" })).not.toHaveProperty("review_required");
  });
  it("fixes a single scene of a finished classroom and reports what is still wrong", async () => {
    const course = await collection(), part = await addPart(course.id);
    await api("POST", "/api/openmaic/generations", { long_course_part_id: part.id });
    const scenes = alignedScenes().map(scene => scene.title === "週期" ? { ...scene, title: "週期（舊）" } : scene);
    stageDocument = { stage: { id: "classroom-run-1" }, scenes };
    expect(await api<{ scenes: { id: string; title: string }[] }>("GET", "/api/openmaic/generations/run-1/scenes")).toMatchObject({ scenes: expect.arrayContaining([{ id: "l-週期", title: "週期（舊）", type: "slide" }]) });
    await expect(api("POST", "/api/openmaic/generations/run-1/publish", {})).rejects.toMatchObject({ status: 422 });
    const fixed = await api<{ alignment: { ok: boolean }; slide_violations: unknown[] }>("PATCH", "/api/openmaic/generations/run-1/scenes/l-週期", { title: "週期" });
    expect(fixed).toMatchObject({ updated: true, slide_violations: [], alignment: { ok: true } });
    expect(stageDocument.scenes.find(scene => scene.id === "l-週期")).toMatchObject({ title: "週期" });
    expect(await api("POST", "/api/openmaic/generations/run-1/publish", {})).toMatchObject({ part_id: part.id });
    await expect(api("PATCH", "/api/openmaic/generations/run-1/scenes/nope", { title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(api("PATCH", "/api/openmaic/generations/run-1/scenes/l-週期", {})).rejects.toMatchObject({ status: 400 });
    await expect(api("PATCH", "/api/openmaic/generations/run-1/scenes/l-週期", { title: "x" }, other)).rejects.toMatchObject({ status: 404 });
  });
  it("runs collection tools over MCP and forwards exact task context and review evidence", async () => {
    for (const scopes of [["study:read"], ["study:read", "study:write"]]) {
      const server = buildServer({ env, ctx, user, scopes, origin: "https://study.test" });
      const client = new Client({ name: "long-course-test", version: "1" });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(st), client.connect(ct)]);
      const decode = (response: Awaited<ReturnType<typeof client.callTool>>) => JSON.parse((response.content as { text: string }[])[0].text);
      try {
        const names = (await client.listTools()).tools.map((tool) => tool.name);
        for (const name of ["create_long_course", "add_long_course_part", "update_long_course_part", "move_long_course_part", "reset_long_course_part", "delete_long_course_part", "delete_long_course", "update_openmaic_scene", "start_long_course_part", "validate_openmaic_core_step"]) { expect(names).toContain(name); expect(WRITE_TOOLS.has(name)).toBe(true); }
        for (const name of ["list_long_courses", "get_long_course", "get_long_course_part_source", "get_openmaic_core_task_context", "get_openmaic_scenes"]) { expect(names).toContain(name); expect(WRITE_TOOLS.has(name)).toBe(false); }
        const created = await client.callTool({ name: "create_long_course", arguments: { note_slug: "native", title: "MCP long course" } });
        if (!scopes.includes("study:write")) { expect(created.isError).toBe(true); continue; }
        expect(created.isError).not.toBe(true);
        const courseId = decode(created).id;
        const part = await client.callTool({ name: "add_long_course_part", arguments: { course_id: courseId, part_key: "unit-1", title: "First unit", source_md: "# Complete first-unit source", blueprint: blueprint() } });
        expect(part.isError).not.toBe(true);
        const metadata = decode(await client.callTool({ name: "get_long_course", arguments: { course_id: courseId, limit: 1 } }));
        expect(metadata).toMatchObject({ total_parts: 1, parts: [{ id: decode(part).id }] }); expect(JSON.stringify(metadata)).not.toContain("source_md");
        const context = decode(await client.callTool({ name: "get_openmaic_core_task_context", arguments: { task_id: "task-1", offset: 20, limit: 100 } }));
        expect(context).toMatchObject({ next_offset: 120, context: "Complete chunk from official core", request_sha256: "a".repeat(64) });
        const output = { text: "Reviewed official response", verification: { request_sha256: "a".repeat(64), remaining_issues: [], checks: ["source_accuracy", "schema", "teaching", "interaction", "accessibility"].map((category) => ({ category, evidence: `Explicit review of ${category} against this official task source.` })) } };
        const validated = decode(await client.callTool({ name: "validate_openmaic_core_step", arguments: { task_id: "task-1", expected_version: 3, output } }));
        expect(validated).toMatchObject({ ok: true, validation_receipt: "b".repeat(64), expected_version: 3 });
        expect(lastSubmission).toEqual({ expected_version: 3, output });
        expect((await client.callTool({ name: "submit_openmaic_core_step", arguments: { task_id: "task-1", expected_version: 3, output, validation_receipt: validated.validation_receipt } })).isError).not.toBe(true);
        expect(lastSubmission).toEqual({ expected_version: 3, output, validation_receipt: "b".repeat(64) });
        expect((await client.callTool({ name: "submit_openmaic_core_step", arguments: { task_id: "task-1", expected_version: 3, validation_receipt: validated.validation_receipt } })).isError).not.toBe(true);
        expect(lastSubmission).toEqual({ expected_version: 3, validation_receipt: "b".repeat(64) });
      } finally { await client.close(); await server.close(); }
    }
  });
});
