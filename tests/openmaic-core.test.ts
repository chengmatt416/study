import { passClassroomReview, selfReviewFor, startFromBlueprint } from "./helpers/blueprint-draft";
import { blueprint } from "./helpers/blueprint";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { testDatabase } from "./helpers/d1";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { signOpenMaicTicket, verifyOpenMaicTicket } from "../src/shared/openmaic-transport";
import { coreConfiguration, coreRequest, type OpenMaicCoreEnv } from "../src/worker/lib/openmaic-core";
const user = { id: "learner", email: "learner@test.example", name: "Learner", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other" };
const background: Promise<unknown>[] = [];
const ctx = { waitUntil: (promise: Promise<unknown>) => { background.push(promise); } } as ExecutionContext;
const secret = "unit-test-transport-secret-32-characters-only";

/** Every scene the blueprint asks for: a lesson, a pretest with hard questions, a checkpoint and the two variants per chapter, then the closing scene. */
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

describe("完整官方 core 的 STUDY MCP 接線", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: OpenMaicCoreEnv;
  const sent: { path: string; method: string; body: unknown; owner: string }[] = [];
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  beforeEach(() => {
    fixture = testDatabase(); sent.length = 0; background.length = 0;
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('learner','learner@test.example',1),('other','other@test.example',1)");
    fixture.db.exec("INSERT INTO documents(id,kind,slug,title,status,created_by,created_at,updated_at) VALUES ('note','note','native','原生課堂','published','learner',1,1)");
    fixture.db.exec("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('r1','note','# Source: 根據公式推理','import',1)");
    fixture.db.exec("UPDATE documents SET current_revision_id='r1' WHERE id='note'");
    env = { DB: fixture.DB, OPENMAIC_CORE_URL: "https://core.example.test", OPENMAIC_MCP_SECRET: secret } as OpenMaicCoreEnv;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
      const ticket = await verifyOpenMaicTicket(new Headers(init.headers).get("authorization")!.slice(7), secret);
      if (!ticket) return Response.json({ error: "unauthorized" }, { status: 401 });
      const path = new URL(url).pathname;
      sent.push({ path, method: init.method!, body: typeof init.body === "string" ? init.body.startsWith("{") ? JSON.parse(init.body) : init.body : null, owner: ticket.sub });
      if (path === "/api/stages/classroom-1") return Response.json({ scenes: alignedScenes() });
      if (path === "/api/materials") return Response.json({ materialId: "material-1" });
      if (path === "/api/generation-runs") return Response.json({ run: { id: "run-native" } });
      if (path === "/api/generate-classroom/run-native") return Response.json({ status: "succeeded", result: { classroomId: "classroom-1" } });
      if (path === "/api/study-mcp/tasks") return Response.json({ tasks: [{ id: "task-1", version: 1, source: "scene-content:interactive", request: { prompt: [{ role: "system", content: "Official OpenMAIC prompt" }], tools: [] } }] });
      if (path === "/api/study-mcp/tasks/task-1") return Response.json({ id: "task-1", version: 2, status: "answered" });
      return Response.json({ engine: "OpenMAIC", transport: "study-mcp/v1" });
    }));
  });
  afterEach(async () => { await Promise.allSettled(background); vi.unstubAllGlobals(); fixture.db.close(); });

  const withStage = (scenes: unknown[]) => {
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => new URL(url).pathname === "/api/stages/classroom-1" ? Response.json({ scenes }) : base(url, init)));
  };
  const slide = (id: string, title: string, ...texts: string[]) => ({ id, type: "slide", title, content: { type: "slide", canvas: { elements: texts.map((content, i) => ({ id: id + i, type: "text", content: `<p>${content}</p>` })) } } });

  it("投影片裡放了題目就不能發布，並指出哪一張與原因；先測、檢核與互動模組可以有題目", async () => {
    await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    withStage([slide("s1", "週期", "週期是重複一次所需的時間。"), slide("s2", "練習題", "下列何者正確？", "(A) 週期等於頻率", "(B) 週期是頻率的倒數", "(C) 兩者無關"), { id: "q", type: "quiz", title: "先測：週期", content: { type: "quiz" } }]);
    const check = await api<{ ok: boolean; violations: { scene_id: string; reasons: string[] }[]; message: string }>("GET", "/api/openmaic/generations/run-native/slide-check");
    expect(check.ok).toBe(false);
    expect(check.violations.map((v) => v.scene_id)).toEqual(["s2"]);
    expect(check.message).toContain("先測");
    await expect(api("POST", "/api/openmaic/generations/run-native/publish", {})).rejects.toMatchObject({ status: 422 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM note_courses").get()).toEqual({ n: 0 });
  });

  it("投影片只講解時，檢查通過並照常發布", async () => {
    await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    withStage([...alignedScenes(), { id: "i", type: "interactive", title: "週期互動", content: { type: "interactive", html: "<sk-numeric answer=\"2\"></sk-numeric>" }, actions: [{ type: "widget_highlight" }, { type: "speech", text: "輸入你量到的週期" }] }]);
    expect(await api("GET", "/api/openmaic/generations/run-native/slide-check")).toMatchObject({ ok: true, violations: [] });
    expect(await api("GET", "/api/openmaic/generations/run-native/module-check")).toMatchObject({ ok: true });
    // A classroom from a reviewed blueprint is published only after the chatbot's chapter-by-chapter review.
    await expect(api("POST", "/api/openmaic/generations/run-native/publish", {})).rejects.toMatchObject({ status: 422 });
    await passClassroomReview(api, "run-native", blueprint());
    expect(await api("POST", "/api/openmaic/generations/run-native/publish", {})).toHaveProperty("classroom_id", "classroom-1");
  });

  it("互動模組只用於互動、由對話導覽，課間檢核用測驗，不符合就不能發布", async () => {
    await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    const explained = { id: "m1", type: "interactive", title: "週期｜說明", content: { type: "interactive", html: "<sk-module><p>週期是重複一次所需的時間。</p></sk-module>" }, actions: [{ type: "speech", text: "我們來看週期" }] };
    const unguided = { id: "m2", type: "interactive", title: "週期｜操作", content: { type: "interactive", html: "<sk-numeric></sk-numeric>" }, actions: [] };
    withStage([...alignedScenes().map((scene) => scene.title === "檢核：頻率" ? { ...scene, type: "slide" } : scene), explained, unguided]);
    const check = await api<{ ok: boolean; problems: { scene_id: string; problem: string; blocking: boolean }[] }>("GET", "/api/openmaic/generations/run-native/module-check");
    expect(check.ok).toBe(false);
    expect(check.problems.filter((p) => p.blocking).map((p) => p.scene_id).sort()).toEqual(["c-頻率", "m1", "m2"]);
    const review = await api("POST", "/api/openmaic/generations/run-native/completion-review", { review: {} }).catch((error) => error);
    expect(review.status).toBe(422);
    await expect(api("POST", "/api/openmaic/generations/run-native/publish", {})).rejects.toMatchObject({ status: 422 });
  });

  it("告訴 chatbot 題目位置的規則：生成需求、官方指南與檢查工具", async () => {
    const start = await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    expect(start).toHaveProperty("generation_id", "run-native");
    expect(JSON.stringify(sent[1].body)).toContain("絕對不可以把要學生作答的題目放進投影片");
    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "slide-rule", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      expect((await client.listTools()).tools.some((tool) => tool.name === "check_openmaic_slides")).toBe(true);
      const guide = await client.callTool({ name: "get_openmaic_guide", arguments: {} });
      expect(JSON.stringify(guide.content)).toContain("絕對不可以把要學生作答的題目放進投影片");
      const checked = await client.callTool({ name: "check_openmaic_slides", arguments: { generation_id: "run-native" } });
      expect(checked.isError).not.toBe(true);
    } finally { await client.close(); await server.close(); }
  });

  it("已設定 Worker service binding 時，僅經私有 binding 呼叫完整核心", async () => {
    const binding = vi.fn(async (request: Request) => {
      const ticket = await verifyOpenMaicTicket(request.headers.get('authorization')!.slice(7), secret);
      expect(ticket?.sub).toBe('study:learner');
      expect(request.url).toBe('https://core.example.test/api/study-mcp/status');
      expect(request.headers.get('host')).toBe('core.example.test');
      expect(request.headers.get('x-forwarded-host')).toBe('core.example.test');
      expect(request.headers.get('x-forwarded-proto')).toBe('https');
      return Response.json({ engine: 'OpenMAIC', runtime: 'cloudflare-workers' });
    });
    env.OPENMAIC_CORE = { fetch: binding } as unknown as Fetcher;
    await expect(coreRequest(env, 'learner', 'GET', '/api/study-mcp/status')).resolves.toMatchObject({ runtime: 'cloudflare-workers' });
    expect(binding).toHaveBeenCalledOnce(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("使用官方原始任務，完成後只儲存原生課堂指標，沒有相容場景轉換", async () => {
    const start = await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    expect(start).toHaveProperty("generation_id", "run-native");
    expect(sent[0]).toMatchObject({ path: "/api/materials", owner: "study:learner", body: expect.stringContaining("Source") });
    expect(sent[1].body).toMatchObject({ interactive: true, materialIds: ["material-1"] });
    const step = await api("GET", "/api/openmaic/generations/run-native");
    expect(JSON.stringify(step)).toContain("Official OpenMAIC prompt");
    await api("POST", "/api/openmaic/tasks/task-1", { expected_version: 1, output: { text: "官方模型回合的原始回應" } });
    expect(sent.at(-1)?.body).toEqual({ expected_version: 1, output: { text: "官方模型回合的原始回應" } });
    await passClassroomReview(api, "run-native", blueprint());
    await api("POST", "/api/openmaic/generations/run-native/publish", {});
    const saved = await api<{ course: { format: string; classroom_id: string } }>("GET", "/api/documents/native/course");
    expect(saved.course).toMatchObject({ format: "openmaic-core", classroom_id: "classroom-1" });
    const launch = await api<{ action: string; ticket: string }>("POST", "/api/openmaic/launch", { note_slug: "native" });
    expect(launch.action).toBe("/api/study-mcp/session");
    expect(await verifyOpenMaicTicket(launch.ticket, secret)).toMatchObject({ sub: "study:learner", scope: "classroom", classroom_id: "classroom-1" });
    expect(launch).toMatchObject({ classroom_id: "classroom-1" });
    // Warming wakes the classroom service with one read of the stored lesson, and only for someone who may open it.
    const before = sent.length;
    await expect(api("POST", "/api/openmaic/warm", { note_slug: "native" })).resolves.toEqual({ ok: true });
    await Promise.all(background);
    expect(sent.slice(before)).toEqual([expect.objectContaining({ path: "/api/stages/classroom-1", owner: "study:learner" })]);
    await expect(api("POST", "/api/openmaic/warm", { note_slug: "missing-note" })).rejects.toMatchObject({ status: 404 });
    await expect(api("GET", "/api/openmaic/generations/run-native", undefined, other)).rejects.toMatchObject({ status: 404 });
  });

  it("讀取生成狀態與模型任務時不重疊啟動完整核心", async () => {
    await startFromBlueprint(api, { note_slug: 'native', topic: '週期', blueprint: blueprint() });
    const upstream = globalThis.fetch;
    let active = 0, peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: URL, init: RequestInit) => {
      active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        return await upstream(input, init);
      } finally { active--; }
    }));
    const step = await api<{ tasks: unknown[] }>('GET', '/api/openmaic/generations/run-native');
    expect(step.tasks).toHaveLength(1);
    expect(peak).toBe(1);
  });

  it("筆記修訂與版本變更仍阻擋覆蓋，缺少官方服務時絕不退回自製播放器", async () => {
    await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    fixture.db.exec("UPDATE documents SET current_revision_id=NULL WHERE id='note'");
    await expect(api("POST", "/api/openmaic/generations/run-native/publish", {})).rejects.toMatchObject({ status: 409 });
    delete env.OPENMAIC_CORE_URL;
    await expect(startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() })).rejects.toMatchObject({ status: 503 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM course_generations").get()).toMatchObject({ n: 0 });
  });

  it("發布等待官方回應期間來源改變，也以原子檢查阻擋舊課程", async () => {
    await startFromBlueprint(api, { note_slug: "native", topic: "週期", blueprint: blueprint() });
    await passClassroomReview(api, "run-native", blueprint());
    const upstream = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init: RequestInit) => {
      if (new URL(input).pathname === "/api/generate-classroom/run-native") fixture.db.exec("UPDATE documents SET current_revision_id=NULL WHERE id='note'");
      return upstream(input, init);
    }));
    await expect(api("POST", "/api/openmaic/generations/run-native/publish", {})).rejects.toMatchObject({ status: 409 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM note_courses").get()).toMatchObject({ n: 0 });
  });

  it("拒絕直接匯入任意原生 classroom 指標", async () => {
    await expect(api("PUT", "/api/documents/native/course", { expected_version: 0, course: { schema: "study-openmaic/v1", format: "openmaic-core", title: "未經生成驗證", classroom_id: "another-private-classroom", core_version: "1.3.0" } })).rejects.toMatchObject({ status: 422 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM note_courses").get()).toMatchObject({ n: 0 });
  });

  it("原生 MCP 工具經協定轉交官方模型回合並保留寫入授權", async () => {
    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "native-core-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      const tools = await client.listTools();
      for (const name of ["start_openmaic_classroom", "submit_openmaic_core_step", "publish_openmaic_classroom"]) { expect(tools.tools.some((tool) => tool.name === name)).toBe(true); expect(WRITE_TOOLS.has(name)).toBe(true); }
      const unapproved = await client.callTool({ name: "start_openmaic_classroom", arguments: { note_slug: "native", topic: "週期", blueprint_draft_id: "missing" } });
      expect(unapproved.isError).toBe(true);
      const submitted = await client.callTool({ name: "submit_course_blueprint", arguments: { note_slug: "native", topic: "週期", blueprint: blueprint(), self_review: selfReviewFor(blueprint()), mode: "yolo" } });
      expect(submitted.isError).not.toBe(true);
      const draftId = JSON.parse((submitted.content as { text: string }[])[0].text).draft_id as string;
      const started = await client.callTool({ name: "start_openmaic_classroom", arguments: { note_slug: "native", topic: "週期", blueprint_draft_id: draftId } });
      expect(started.isError).not.toBe(true);
      const task = await client.callTool({ name: "get_openmaic_core_step", arguments: { generation_id: "run-native" } });
      expect(JSON.stringify(task.content)).toContain("Official OpenMAIC prompt");
      expect((await client.callTool({ name: "submit_openmaic_core_step", arguments: { task_id: "task-1", expected_version: 1, output: { text: "Core answer" } } })).isError).not.toBe(true);
    } finally { await client.close(); await server.close(); }
  });
});

describe("原生課堂簽章", () => {
  it("拒絕修改、過期、錯誤受眾及跨服務 secret", async () => {
    const payload = { sub: "study:learner", aud: "study-openmaic" as const, scope: "api" as const, exp: Date.now() + 60_000 };
    const ticket = await signOpenMaicTicket(payload, secret);
    expect(await verifyOpenMaicTicket(ticket, secret)).toMatchObject(payload);
    expect(await verifyOpenMaicTicket(ticket, secret + "wrong")).toBeNull();
    expect(await verifyOpenMaicTicket(ticket, secret, Date.now() + 120_000)).toBeNull();
    expect(await verifyOpenMaicTicket(ticket.replace(/.$/, "!"), secret)).toBeNull();
  });
});


describe("官方核心連線錯誤", () => {
  const env = { OPENMAIC_CORE_URL: "https://core.example.test", OPENMAIC_MCP_SECRET: secret } as OpenMaicCoreEnv;
  afterEach(() => vi.unstubAllGlobals());
  it("將讀取逾時與服務離線分開，寫入逾時不自動重送", async () => {
    const fetch = vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); });
    vi.stubGlobal('fetch', fetch);
    await expect(coreRequest(env, 'learner', 'GET', '/api/study-mcp/tasks')).rejects.toMatchObject({ status: 503 });
    fetch.mockClear();
    await expect(coreRequest(env, 'learner', 'POST', '/api/generation-runs', {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("使用 Workers 支援的 redirect 模式，並拒絕將簽章轉送至重新導向目的地", async () => {
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      if (init.redirect === "error") throw new TypeError("Workers does not implement redirect: error");
      return Response.json({ engine: "OpenMAIC" });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(coreRequest(env, "learner", "GET", "/api/study-mcp/status")).resolves.toMatchObject({ engine: "OpenMAIC" });
    fetch.mockImplementation(async () => new Response(null, { status: 307, headers: { location: "https://untrusted.example/api/study-mcp/status" } }));
    fetch.mockClear();
    await expect(coreRequest(env, "learner", "GET", "/api/study-mcp/status")).rejects.toMatchObject({ status: 502 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });
  it("將未就緒的 HTML 與非物件 JSON 回應轉成可重試的服務錯誤", async () => {
    for (const response of [new Response("Internal Server Error", { status: 500 }), Response.json(null), Response.json([])]) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      await expect(coreRequest(env, "learner", "GET", "/api/study-mcp/status")).rejects.toMatchObject({ status: 502 });
    }
  });
  it("保留官方生成作業數量限制並清楚拒絕無效設定", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Active run limit reached" }, { status: 429 })));
    await expect(coreRequest(env, "learner", "POST", "/api/generation-runs", {})).rejects.toMatchObject({ status: 429 });
    expect(() => coreConfiguration({ ...env, OPENMAIC_CORE_URL: "invalid url" })).toThrow(expect.objectContaining({ status: 503 }));
  });
});
