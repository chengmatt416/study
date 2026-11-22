import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWritingFeedback, type WritingFeedbackInput, type WritingPractice, type WritingPrompt, type WritingSummary } from "../src/shared/writing-practice";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { testDatabase } from "./helpers/d1";

const owner = { id: "owner", email: "owner@test.example", name: "Owner", avatar_url: null, role: "member" as const };
const other = { ...owner, id: "other", email: "other@test.example" };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
const origin = "https://study.test";
const question: WritingPrompt = {
  title: "A better school library",
  language: "en",
  prompt: "Write to your school board proposing one change to the library.",
  markscheme: [
    { name: "Task", max: 6, description: "Award up to 6 points for a clear proposal with a reason and an example." },
    { name: "Language", max: 4, description: "Award up to 4 points for accurate grammar and appropriate wording." },
  ],
};
const draft = "It is good.\nIt is good because the books helps.";
const feedback: WritingFeedbackInput = {
  summary: "Explain how the change helps students.",
  scores: [{ criterion: 2, points: 2, comment: "Check subject–verb agreement." }, { criterion: 1, points: 5, comment: "The proposal is clear." }],
  corrections: [
    { quote: "books helps", kind: "grammar", replacement: "books help", explanation: "Use a plural verb with books." },
    { quote: "good", occurrence: 2, kind: "vocabulary", replacement: "valuable", explanation: "Choose a more precise word." },
  ],
};

describe("Writing Practice", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T>(method: string, path: string, payload?: unknown, user = owner) => callApi<T>(env, ctx, user, method, path, payload);

  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('owner','owner@test.example',1),('other','other@test.example',1)");
    env = { DB: fixture.DB } as Env;
  });
  afterEach(() => fixture.db.close());

  async function withMcp(scopes: string[], run: (client: Client) => Promise<void>) {
    const server = buildServer({ env, ctx, user: owner, scopes, origin });
    const client = new Client({ name: "writing-tests", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try { await run(client); } finally { await client.close(); await server.close(); }
  }

  async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    if (content.type !== "text") throw new Error("Expected a text tool result");
    return JSON.parse(content.text) as T;
  }

  it("creates a prompt with a private markscheme, grades a submitted draft and saves the final draft", async () => {
    await withMcp(["study:read", "study:write"], async (client) => {
      const { id, url } = await call<{ id: string; url: string }>(client, "create_writing_practice", { ...question });
      expect(url).toBe(`${origin}/writing/${id}`);
      const path = `/api/writing/${id}`;
      expect(await api("GET", path)).toMatchObject({ status: "draft", markscheme: null, feedback: null });
      await expect(api("GET", `/api/writing/mcp/${id}`)).rejects.toMatchObject({ status: 409 });
      await expect(api("GET", path, undefined, other)).rejects.toMatchObject({ status: 404 });
      await expect(api("POST", `${path}/draft`, { text: draft }, other)).rejects.toMatchObject({ status: 404 });
      await expect(api("POST", `${path}/final`, { text: "Too soon" })).rejects.toMatchObject({ status: 409 });
      await expect(api("POST", `${path}/draft`, { text: "  \n" })).rejects.toMatchObject({ status: 400 });

      expect(await api("POST", `${path}/draft`, { text: draft })).toMatchObject({ status: "awaiting_feedback", draft, markscheme: null });
      await expect(api("POST", `${path}/draft`, { text: "Replace it" })).rejects.toMatchObject({ status: 409 });
      const pending = await call<{ practices: WritingSummary[] }>(client, "list_writing_practices", { status: "awaiting_feedback" });
      expect(pending.practices.map((practice) => practice.id)).toEqual([id]);
      expect(await api("GET", "/api/writing", undefined, other)).toEqual({ practices: [] });
      expect(await call(client, "get_writing_draft", { practice_id: id })).toMatchObject({
        draft, markscheme: [{ criterion: 1, ...question.markscheme[0] }, { criterion: 2, ...question.markscheme[1] }],
      });
      await expect(api("POST", `/api/writing/mcp/${id}/feedback`, feedback, other)).rejects.toMatchObject({ status: 404 });
      await expect(api("POST", `/api/writing/mcp/${id}/feedback`, {
        ...feedback, corrections: [{ ...feedback.corrections[1], occurrence: undefined }],
      })).rejects.toMatchObject({ status: 422 });
      expect(await api("GET", path)).toMatchObject({ status: "awaiting_feedback", feedback: null });
      expect(await call(client, "submit_writing_feedback", { practice_id: id, ...feedback })).toMatchObject({ status: "revision", total: 7, max: 10, url });

      const result = await api<WritingPractice>("GET", path);
      expect(result.feedback?.corrections.map(({ start, end, kind }) => [draft.slice(start, end), start, kind])).toEqual([
        ["good", draft.lastIndexOf("good"), "vocabulary"], ["books helps", draft.indexOf("books helps"), "grammar"],
      ]);
      const final = { text: "The library is valuable because the books help us learn." };
      expect(await api("POST", `${path}/final`, final)).toMatchObject({ status: "complete", final_draft: final.text, draft });
      expect(await api("POST", `${path}/final`, final)).toMatchObject({ status: "complete" });
      expect(await api("POST", `${path}/draft`, { text: draft })).toMatchObject({ status: "complete" });
      expect(await call(client, "submit_writing_feedback", { practice_id: id, ...feedback })).toMatchObject({ status: "complete" });
      await expect(api("POST", `/api/writing/mcp/${id}/feedback`, { ...feedback, summary: "Changed feedback" })).rejects.toMatchObject({ status: 409 });
    });
  });

  it("does not let a read-only chatbot write", async () => {
    await withMcp(["study:read"], async (client) => {
      for (const [name, args] of [
        ["create_writing_practice", question],
        ["submit_writing_feedback", { practice_id: crypto.randomUUID(), ...feedback }],
      ] as const) {
        expect(WRITE_TOOLS.has(name)).toBe(true);
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }
    });
  });

  it("rejects ambiguous, absent or overlapping quotations and out-of-range or duplicate scores", () => {
    const grammar = feedback.corrections[0];
    const word = feedback.corrections[1];
    const invalid = resolveWritingFeedback(draft, question.markscheme, {
      ...feedback,
      scores: [{ criterion: 1, points: 7, comment: "Too high." }, { criterion: 1, points: 3, comment: "Repeated." }],
      corrections: [
        { ...word, occurrence: undefined },
        { ...word, occurrence: 3 },
        { ...grammar, quote: "books have" },
        grammar,
        { ...grammar, quote: "helps" },
      ],
    });
    expect(invalid).toMatchObject({ errors: [
      expect.stringContaining("恰好一次"), expect.stringContaining("超出"), expect.stringContaining("第 1 則"),
      expect.stringContaining("第 2 則"), expect.stringContaining("第 3 則"), expect.stringContaining("重疊"),
    ] });
  });
});
