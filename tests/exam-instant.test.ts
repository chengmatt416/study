import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, SessionUser } from "../src/worker/lib/types";
import type { LiveAiEnv } from "../src/worker/lib/live-ai/service";
import { encryptLiveAiKey } from "../src/worker/lib/live-ai/secrets";
import { enforceAccess } from "../src/worker/lib/access";
import exams from "../src/worker/routes/exams";
import { testDatabase } from "./helpers/d1";

const user: SessionUser = { id: "student", email: "student@example.test", role: "member", name: null, avatar_url: null };
const other: SessionUser = { ...user, id: "other", email: "other@example.test" };
const markdown = [
  ":::passage{#stem}", "Shared material", ":::", "",
  ":::question{#q1}", "What is 2 + 2?", ":::", "",
  "::::question{#q2}", "Apply Newton's second law.",
  ":::part{#a}", "State the magnitude.", ":::",
  ":::part{#b}", "Explain the relationship.", ":::", "::::", "",
  ":::question{#q3}", "Explain the law in your own words.", ":::",
].join("\n");
const open = { type: "open", points: 2, model_answer: "F = ma", rubric: "Award one point for each correct relationship" };
const keys = [
  { id: "q1", type: "numeric", points: 1, answer: 4 },
  { id: "q2", type: "multipart", parts: [{ id: "a", type: "numeric", points: 1, answer: 6 }, { id: "b", ...open }] },
  { id: "q3", ...open },
];

describe("Instant exam attempts", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: LiveAiEnv;
  let app: Hono<AppEnv>;
  const request = (method: string, path: string, body?: unknown, who = user) =>
    app.request("/api/exams" + path, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), "x-test-user": who.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
  const attempt = async (instant = true) => {
    const res = await request("POST", "/lab/attempts" + (instant ? "?mode=instant" : ""));
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; mode: string };
  };
  const modelResponse = (marks: { id: string; score: number; comment: string }[]) => Response.json({
    choices: [{ message: { content: JSON.stringify({ marks }) } }],
    usage: { prompt_tokens: 100, completion_tokens: 40 },
  });

  beforeEach(async () => {
    fixture = testDatabase();
    env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: "exam-test-secret-".repeat(4), LIVE_AI_ENCRYPTION_KEY: "ab".repeat(32) } as unknown as LiveAiEnv;
    for (const who of [user, other]) {
      fixture.db.prepare("INSERT INTO users(id,email,created_at) VALUES (?,?,1)").run(who.id, who.email);
      fixture.db.prepare("INSERT INTO allowlist(email,role,created_at) VALUES (?,?,1)").run(who.email, who.role);
    }
    fixture.db.exec("INSERT INTO documents(id,slug,title,kind,status,created_by,created_at,updated_at) VALUES ('lab','lab','Lab exam','exam','published','student',1,1)");
    fixture.db.prepare("INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES ('rev','lab',?,'import',1)").run(markdown);
    fixture.db.prepare("INSERT INTO answer_revisions(id,document_id,answers_json,status,author_id,created_at) VALUES ('ans','lab',?,'approved','student',1)")
      .run(JSON.stringify({ schema: "exam-answers/v1", questions: keys }));
    fixture.db.exec("UPDATE documents SET current_revision_id='rev',answers_revision_id='ans' WHERE id='lab'");
    const key = await encryptLiveAiKey(env, "test-model-key");
    fixture.db.prepare("UPDATE live_ai_config SET enabled=1, model='test/model', requests_per_minute=20, encrypted_key=?").run(key);
    app = new Hono<AppEnv>().basePath("/api");
    app.use("*", async (c, next) => {
      c.set("user", c.req.header("x-test-user") === other.id ? other : user);
      await next();
    });
    app.use("*", enforceAccess);
    app.route("/exams", exams);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fixture.db.close();
  });

  it("separates attempt modes, saves the resume question, and reveals no answer through a regular or foreign attempt", async () => {
    const timed = await attempt(false);
    const instant = await attempt();
    expect(timed).toMatchObject({ mode: "exam" });
    expect(instant).toMatchObject({ mode: "instant" });
    expect(instant.id).not.toBe(timed.id);
    const attemptUrl = `/attempts/${timed.id}`;
    expect((await request("POST", attemptUrl + "/check/q1", { response: "4" })).status).toBe(409);
    expect((await request("PUT", attemptUrl, { responses: { q2: { a: "6" } }, current_question_id: "q2" })).status).toBe(200);
    expect(await (await request("POST", "/lab/attempts")).json()).toMatchObject({
      id: timed.id, current_question_id: "q2", responses: { q2: { a: "6" } },
    });
    expect((await request("POST", `/attempts/${instant.id}/check/q1`, { response: "4" }, other)).status).toBe(404);
    const paper = await (await request("GET", `/lab/paper?attempt=${instant.id}`)).json() as { questions: object[] };
    expect(paper.questions[0]).not.toHaveProperty("answer");
    expect(paper.questions[2]).not.toHaveProperty("model_answer");
  });

  it("scores objective questions locally, freezes checked responses, and keeps requested AI review advisory", async () => {
    const provider = vi.fn(async () => modelResponse([{ id: "q1", score: 0, comment: "AI 的獨立建議" }]));
    vi.stubGlobal("fetch", provider);
    const { id } = await attempt();
    const url = `/attempts/${id}`;
    expect(await (await request("POST", url + "/check/q1", { response: "4" })).json()).toMatchObject({
      response: "4", feedback: { result: { correct: true, score: 1 }, reviewable: true, aiGraded: [] },
    });
    expect(provider).not.toHaveBeenCalled();
    expect((await request("PUT", url, { responses: { q1: "999" }, current_question_id: "q1" })).status).toBe(200);
    expect(await (await request("POST", url + "/check/q1", { response: "999" })).json()).toMatchObject({ response: "4" });
    expect(await (await request("POST", url + "/check/q1", { review: true })).json()).toMatchObject({
      response: "4", feedback: { result: { score: 1 }, review: [{ id: "q1", score: 0, comment: "AI 的獨立建議" }] },
    });
    expect(await (await request("POST", "/lab/attempts?mode=instant")).json()).toMatchObject({
      current_question_id: "q1", responses: { q1: "4" }, feedback: { q1: { review: [{ id: "q1", score: 0 }] } },
    });
    expect((await request("POST", url + "/check/q1", { review: true })).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await (await request("POST", url + "/submit", { responses: { q1: "0", q2: { a: "6" } } })).json()).toMatchObject({
      result: { score: 1, pendingSelfGrade: 0 }, responses: { q1: "4" },
    });
    expect(await (await request("GET", url)).json()).toMatchObject({ result: { score: 1 }, responses: { q1: "4" } });
    expect((await request("POST", url + "/self-grade", { scores: { q3: 2 } })).status).toBe(409);
  });

  it("grades text in one provider request per question and rejects handwriting before contacting the provider", async () => {
    const provider = vi.fn(async (_input: unknown, _init: RequestInit) => modelResponse([
      { id: "q2.b", score: 1.5, comment: "公式正確，可補上單位。" },
    ]));
    provider.mockResolvedValueOnce(modelResponse([{ id: "q3", score: 2, comment: "完整。" }]));
    vi.stubGlobal("fetch", provider);
    const { id } = await attempt();
    const url = `/attempts/${id}`;
    const ink = { mode: "ink", ink: "ink1|grid|500\n#\np,#111111,5:20,20,5 60,50,5" };
    const image = "data:image/png;base64,iVBORw0KGgo=";
    expect((await request("POST", url + "/check/q3", { response: ink, images: { q3: image } })).status).toBe(422);
    expect(provider).not.toHaveBeenCalled();
    expect(await (await request("POST", url + "/check/q3", { response: "Force equals mass times acceleration" })).json()).toMatchObject({
      feedback: { result: { score: 2, correct: true }, aiGraded: ["q3"], reviewable: false },
    });
    expect(await (await request("POST", url + "/check/q2", { response: { a: "6", b: "F = ma" } })).json()).toMatchObject({
      feedback: { result: { score: 2.5, correct: "partial", parts: [{ id: "a", score: 1 }, { id: "b", score: 1.5 }] }, aiGraded: ["q2.b"], reviewable: true },
    });
    const sent = JSON.parse(provider.mock.calls[1][1].body as string);
    expect(sent.model).toBe("test/model");
    expect(sent.messages[1].content).toEqual(expect.any(String));
    const content = JSON.parse(sent.messages[1].content);
    expect(content.passage).toContain("Shared material");
    expect(content.answers).toEqual([expect.objectContaining({ id: "q2.b", student_answer: "F = ma" })]);
    expect(await (await request("POST", url + "/submit", {})).json()).toMatchObject({
      result: { score: 4.5, max: 6, pendingSelfGrade: 0 },
    });
  });

  it("deduplicates an in-flight check and releases failed grades for a retry", async () => {
    let unblock!: (value: Response) => void;
    let called!: () => void;
    const started = new Promise<void>(resolve => { called = resolve; });
    const provider = vi.fn()
      .mockImplementationOnce(() => {
        called();
        return new Promise<Response>(resolve => { unblock = resolve; });
      })
      .mockResolvedValueOnce(modelResponse([{ id: "q3", score: 1, comment: "有部分說明。" }]));
    vi.stubGlobal("fetch", provider);
    const { id } = await attempt();
    const url = `/attempts/${id}`;
    const check = () => request("POST", url + "/check/q3", { response: "F = ma" });
    const pending = check();
    await started;
    expect((await check()).status).toBe(409);
    expect((await request("POST", url + "/submit", {})).status).toBe(409);
    unblock(modelResponse([{ id: "q3", score: 99, comment: "無效分數" }]));
    expect((await pending).status).toBe(502);
    expect((await check()).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});
