import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { QueryClient } from "@tanstack/react-query";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../src/shared/markdown";
import { PRACTICE_KINDS, type PracticeImportItem, type PracticeItem, type PracticeKind, type PracticePage, type PracticeSubject } from "../src/shared/practice";
import { bufferPracticeFeed, createPracticeFeed } from "../src/web/features/practice/feed";
import { practiceLanes } from "../src/web/features/practice/plan";
import { encryptLiveAiKey } from "../src/worker/lib/live-ai/secrets";
import type { LiveAiEnv } from "../src/worker/lib/live-ai/service";
import { enforceAccess } from "../src/worker/lib/access";
import type { AppEnv } from "../src/worker/lib/types";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import practice from "../src/worker/routes/practice";
import { testDatabase } from "./helpers/d1";

const learner = { id: "learner", role: "member" as const, email: "learner@test.example", name: "Learner", avatar_url: null };
const other = { ...learner, id: "other", email: "other@test.example" };
const origin = "https://study.test";
const ctx = { waitUntil: () => undefined } as ExecutionContext;

const imported: { subject_id: string; items: PracticeImportItem[] } = {
  subject_id: "math",
  items: [
    { kind: "question", prompt_md: "What is $2^2$?", options: ["$4$", "$6$"], correct_option: 1, explanation_md: "Multiply two by two." },
    { kind: "flashcard", prompt_md: "Derivative of $x^2$", answer_md: "$2x$" },
    { kind: "concept", prompt_md: "Explain the chain rule.", answer_md: "$f'(g(x))g'(x)$" },
  ],
};

function ref(item: PracticeItem) {
  const { kind, entry, source_key, version } = item;
  return { kind, entry, source_key, version };
}

describe("mixed practice", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: LiveAiEnv;
  const app = new Hono<AppEnv>().basePath("/api");
  app.use("*", async (c, next) => {
    c.set("user", c.req.header("x-test-user") === other.id ? other : learner);
    await next();
  });
  app.use("*", enforceAccess);
  app.route("/practice", practice);
  app.get("/assets/:id", c => c.text("image"));
  const api = async <T>(method: string, path: string, body?: unknown, user = learner): Promise<T> => {
    const response = await app.request(origin + "/api/practice" + path, {
      method, headers: { "x-test-user": user.id, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    if (!response.ok) throw new Error(await response.text(), { cause: response.status });
    return response.json() as Promise<T>;
  };
  const page = (kind: PracticeKind, user = learner, query = "") =>
    api<PracticePage>("GET", `/items?kind=${kind}&subject=math${query}`, undefined, user);

  beforeEach(() => {
    fixture = testDatabase();
    env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: "mixed-practice-test-secret".repeat(2), LIVE_AI_ENCRYPTION_KEY: "ab".repeat(32) } as unknown as LiveAiEnv;
    fixture.db.exec(`
      INSERT INTO users(id,email,created_at) VALUES ('learner','learner@test.example',1),('other','other@test.example',1);
      INSERT INTO allowlist(email,role,created_at) VALUES ('learner@test.example','member',1),('other@test.example','member',1);
      INSERT INTO subjects(id,slug,name) VALUES ('math','practice-math','Math'),('bio','practice-bio','Biology');
      INSERT INTO subjects(id,slug,name,practice_scale) VALUES ('sub-chem','ib-fixture-chem','Fixture Chemistry','ib');
    `);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fixture.db.close();
  });

  async function withMcp(scopes: string[], run: (client: Client) => Promise<void>, user = learner) {
    const server = buildServer({ env, ctx, user, scopes, origin });
    const client = new Client({ name: "mixed-practice-tests", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try { await run(client); } finally { await client.close(); await server.close(); }
  }

  async function add(items: PracticeImportItem[], subject_id = "math", user = learner, visibility?: "private" | "shared") {
    await withMcp(["study:read", "study:write"], async client => {
      const result = await client.callTool({ name: "add_practice_items", arguments: { subject_id, items, ...(visibility ? { visibility } : {}) } });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    }, user);
  }

  it("imports all three private item kinds through OAuth-scoped MCP and deduplicates retries", async () => {
    expect(WRITE_TOOLS.has("add_practice_items")).toBe(true);
    await withMcp(["study:read"], async client => {
      const result = await client.callTool({ name: "add_practice_items", arguments: imported });
      expect(result.isError).toBe(true);
    });
    await withMcp(["study:read", "study:write"], async client => {
      const subjects = await client.callTool({ name: "list_practice_subjects" });
      expect(JSON.stringify(subjects.content)).toContain("math");
      for (const added of [3, 0]) {
        const result = await client.callTool({ name: "add_practice_items", arguments: imported });
        expect(result.isError).not.toBe(true);
        const first = result.content[0];
        if (first.type !== "text") throw new Error("Expected text from MCP");
        expect(JSON.parse(first.text)).toMatchObject({ added, submitted: 3, url: origin + "/practice?subject=math" });
      }
    });
    const { items: [question] } = await page("question");
    const { items: [card] } = await page("flashcard");
    expect((await page("concept")).items).toHaveLength(1);
    expect(await page("flashcard", other)).toEqual({ items: [], next: null });
    expect(question).not.toHaveProperty("correct_option");
    expect(card).not.toHaveProperty("answer_md");
    await expect(api("POST", "/reveal", { ref: ref(card) }, other)).rejects.toMatchObject({ cause: 404 });
    expect(await api("POST", "/reveal", { ref: ref(card) })).toMatchObject({ correct: null, reference_md: "$2x$" });
    expect(await api("POST", "/reveal", { ref: ref(question), answer: "A" })).toMatchObject({ correct: true, correct_options: ["A"] });
    await expect(api("POST", "/reveal", { ref: ref(question) })).rejects.toMatchObject({ cause: 422 });
  });

  it("pages through dedicated MCP items for the selected subjects", async () => {
    await add(Array.from({ length: 5 }, (_, i) => ({
      kind: "question", prompt_md: `What is $${i}+2$?`, options: [String(i + 2), String(i + 3)], correct_option: 1,
    })));
    await add([{ kind: "question", prompt_md: "What is a eukaryote?", options: ["A cell with a nucleus", "A virus"], correct_option: 1 }], "bio");
    const first = await page("question");
    expect(first.items).toHaveLength(4);
    const key = first.next?.key ?? "";
    expect(key).toBe(first.items.at(-1)?.source_key);
    const second = await page("question", learner, `&after=${encodeURIComponent(key)}`);
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    const all = [...first.items, ...second.items];
    expect(all.every(item => item.subject_id === "math" && item.source_key.startsWith("0:"))).toBe(true);
    expect(new Set(all.map(item => item.source_key)).size).toBe(5);
    expect(JSON.stringify(all)).not.toContain("correct_option");
    await expect(api("POST", "/reveal", { ref: { ...ref(all[0]), version: "earlier" }, answer: "A" })).rejects.toMatchObject({ cause: 409 });
  });

  it("counts only the current learner's dedicated items by subject and type", async () => {
    await add(imported.items);
    await add([{ kind: "concept", prompt_md: "How does diffusion work?", answer_md: "Particles spread down their concentration gradient." }], "bio");
    const result = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects");
    expect(result.subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "math", question: 1, flashcard: 1, concept: 1 }),
      expect.objectContaining({ id: "bio", question: 0, flashcard: 0, concept: 1 }),
    ]));
    const unrelated = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects", undefined, other);
    expect(unrelated.subjects.find(subject => subject.id === "math")).toMatchObject({ question: 0, flashcard: 0, concept: 0 });
  });

  it("shares the owner's entire library, supports an own-only feed, and revokes access on return to private", async () => {
    await add(imported.items);
    expect(await api("GET", "/library")).toEqual({ private_count: 3, shared_count: 0 });
    expect(await api("GET", "/library", undefined, other)).toEqual({ private_count: 0, shared_count: 0 });
    expect(await api("PUT", "/library/visibility", { visibility: "shared" })).toEqual({ visibility: "shared", changed: 3 });
    expect(await api("PUT", "/library/visibility", { visibility: "shared" })).toEqual({ visibility: "shared", changed: 0 });
    expect(await api("GET", "/library")).toEqual({ private_count: 0, shared_count: 3 });
    const { items: [item] } = await page("question", other, "&level=medium");
    expect(item).toMatchObject({ shared_by_member: true, prompt_md: imported.items[0].prompt_md });
    expect(item).not.toHaveProperty("user_id");
    expect(item).not.toHaveProperty("correct_option");
    expect((await page("question", other, "&source=own")).items).toEqual([]);
    const { subjects } = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects", undefined, other);
    expect(subjects.find(subject => subject.id === "math")).toMatchObject({ question: 1, flashcard: 1, concept: 1 });
    const own = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects?source=own", undefined, other);
    expect(own.subjects.find(subject => subject.id === "math")).toMatchObject({ question: 0, flashcard: 0, concept: 0 });
    expect(await api("POST", "/reveal", { ref: ref(item), answer: "A" }, other)).toMatchObject({ correct: true });
    expect(await api("PUT", "/library/visibility", { visibility: "private" }, other)).toMatchObject({ changed: 0 });
    expect(await api("PUT", "/library/visibility", { visibility: "private" })).toMatchObject({ changed: 3 });
    await expect(api("POST", "/reveal", { ref: ref(item), answer: "A" }, other)).rejects.toMatchObject({ cause: 404 });
    await expect(api("POST", "/explain", { ref: ref(item) }, other)).rejects.toMatchObject({ cause: 404 });
  });

  it("clears every item created by the caller while preserving the content shared by another member", async () => {
    await add(imported.items, "math", learner, "shared");
    await add([{ kind: "concept", prompt_md: "New biology topic", answer_md: "Cells" }], "bio");
    await add([{ kind: "flashcard", prompt_md: "A peer's card", answer_md: "Peer's answer" }], "math", other, "shared");
    const { items: [question] } = await page("question", other);
    expect(await api("DELETE", "/library?user_id=other")).toEqual({ deleted: 4 });
    expect(await api("GET", "/library")).toEqual({ private_count: 0, shared_count: 0 });
    expect(await api("DELETE", "/library")).toEqual({ deleted: 0 });
    expect(await api("GET", "/library", undefined, other)).toEqual({ private_count: 0, shared_count: 1 });
    expect((await page("flashcard")).items).toMatchObject([{ prompt_md: "A peer's card", shared_by_member: true }]);
    expect((await page("question", other)).items).toEqual([]);
    await expect(api("POST", "/reveal", { ref: ref(question), answer: "A" }, other)).rejects.toMatchObject({ cause: 404 });
  });

  it("uses the same access rule for browser sharing and MCP publishing, while the owner can withdraw content", async () => {
    await add(imported.items, "math", learner, "shared");
    fixture.db.exec(`
      INSERT INTO access_groups(id,name,created_at) VALUES ('private','Private author',1);
      INSERT INTO access_group_members(group_id,email) VALUES ('private','learner@test.example');
      INSERT INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('private','feature','shared_write',0);
    `);
    expect(await api("PUT", "/library/visibility", { visibility: "private" })).toMatchObject({ changed: 3 });
    await expect(api("PUT", "/library/visibility", { visibility: "shared" })).rejects.toMatchObject({ cause: 403 });
    await withMcp(["study:read", "study:write"], async client => {
      const result = await client.callTool({ name: "add_practice_items", arguments: { ...imported, visibility: "shared" } });
      expect(result.isError).toBe(true);
    });
    expect(await api("GET", "/library")).toEqual({ private_count: 3, shared_count: 0 });
  });

  it("shares author-owned practice images without publishing another member's images", async () => {
    fixture.db.exec(`
      INSERT INTO assets(id,r2_key,mime,size_bytes,uploaded_by,created_at) VALUES
        ('own-image','a','image/png',1,'learner',1),('other-image','b','image/png',1,'other',1);
    `);
    await add([{
      kind: "concept",
      prompt_md: "![My picture](/api/assets/own-image)",
      answer_md: "![Someone else's picture](/api/assets/other-image)",
    }]);
    const asset = (id: string, user: typeof learner) => app.request(origin + "/api/assets/" + id, {
      headers: { "x-test-user": user.id },
    }, env, ctx);
    expect((await asset("own-image", other)).status).toBe(403);
    await api("PUT", "/library/visibility", { visibility: "shared" });
    expect((await asset("own-image", other)).status).toBe(200);
    expect((await asset("other-image", learner)).status).toBe(403);
    await api("DELETE", "/library");
    expect((await asset("own-image", other)).status).toBe(403);
  });

  it("uses each subject's scale for every item kind and keeps mixed selections independent", async () => {
    await add([
      { kind: "question", prompt_md: "General", options: ["A", "B"], correct_option: 1 },
      { kind: "flashcard", prompt_md: "Term", answer_md: "Meaning", difficulty: "easy" },
      { kind: "concept", prompt_md: "Theory", answer_md: "Meaning", difficulty: "hard" },
    ]);
    await add([
      { kind: "question", prompt_md: "IB top grade", options: ["A", "B"], correct_option: 1, ib_grade: 7 },
      { kind: "question", prompt_md: "IB middle grade", options: ["A", "B"], correct_option: 1, ib_grade: 4 },
      { kind: "flashcard", prompt_md: "IB term", answer_md: "Meaning", ib_grade: 7 },
      { kind: "concept", prompt_md: "IB theory", answer_md: "Meaning", ib_grade: 7 },
    ], "sub-chem");
    const mixedPage = (kind: PracticeKind, level: string, user = learner) =>
      page(kind, user, `&subject=sub-chem&level=${level}`);
    expect((await page("question", learner, "&level=medium")).items.map(item => item.prompt_md)).toEqual(["General"]);
    expect((await mixedPage("question", "medium")).items.map(item => item.subject_id)).toEqual(["math"]);
    expect((await mixedPage("question", "ib-7")).items.map(item => item.prompt_md)).toEqual(["IB top grade"]);
    expect((await mixedPage("question", "ib-7", other)).items).toEqual([]);
    expect((await page("flashcard", learner, "&level=easy")).items.map(item => item.prompt_md)).toEqual(["Term"]);
    expect((await page("concept", learner, "&level=hard")).items.map(item => item.prompt_md)).toEqual(["Theory"]);
    expect((await mixedPage("flashcard", "ib-7")).items.map(item => item.prompt_md)).toEqual(["IB term"]);
    expect((await mixedPage("concept", "ib-7")).items.map(item => item.prompt_md)).toEqual(["IB theory"]);
    await expect(page("question", learner, "&level=ib-8")).rejects.toMatchObject({ cause: 400 });

    const { subjects } = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects");
    const general = subjects.find(subject => subject.id === "math")!;
    const ib = subjects.find(subject => subject.id === "sub-chem")!;
    expect(general.practice_scale).toBe("general");
    expect(general.levels).toEqual({ medium: { question: 1 }, easy: { flashcard: 1 }, hard: { concept: 1 } });
    expect(ib.practice_scale).toBe("ib");
    expect(ib.levels).toEqual({ "ib-4": { question: 1 }, "ib-7": { question: 1, flashcard: 1, concept: 1 } });
    const lanes = practiceLanes([general, ib], [...PRACTICE_KINDS], { general: "medium", ib: "ib-7" });
    const next = createPracticeFeed(async ({ kind, level, subjectIds }, cursor) => (
      api<PracticePage>("GET", `/items?kind=${kind}&subject=${subjectIds.join("&subject=")}&level=${level}&after=${cursor.key}`)), lanes);
    const signal = new AbortController().signal;
    for (const prompt of ["IB top grade", "IB term", "IB theory", "General"]) {
      expect(await next(signal)).toMatchObject({ prompt_md: prompt });
    }
  });

  it("rejects imports on the wrong scale without partially writing the batch", async () => {
    const [, card, concept] = imported.items;
    await withMcp(["study:read", "study:write"], async client => {
      const response = await client.callTool({ name: "list_practice_subjects", arguments: {} });
      const catalog = response.content[0];
      if (catalog.type !== "text") throw new Error("Expected text from MCP");
      expect(JSON.parse(catalog.text).subjects).toContainEqual(expect.objectContaining({ id: "sub-chem", practice_scale: "ib" }));
      for (const args of [
        { subject_id: "math", items: [{ ...card, ib_grade: 5 }] },
        { subject_id: "sub-chem", items: [{ ...card, ib_grade: 5 }, concept] },
        { subject_id: "sub-chem", items: [{ ...concept, ib_grade: 5, difficulty: "easy" }] },
      ]) {
        const result = await client.callTool({ name: "add_practice_items", arguments: args });
        expect(result.isError).toBe(true);
      }
    });
    expect(await api("GET", "/library")).toEqual({ private_count: 0, shared_count: 0 });
  });

  it("retains legacy content with a different scale without counting it in practice", async () => {
    const legacyQuestion = fixture.db.prepare("INSERT INTO practice_items(id,user_id,subject_id,kind,item_json,level) VALUES (?,'learner',?,'question',?,?)");
    legacyQuestion.run("legacy-general-in-ib", "sub-chem", JSON.stringify(imported.items[0]), "medium");
    legacyQuestion.run("legacy-ib-in-general", "math", JSON.stringify({ ...imported.items[0], ib_grade: 5 }), "ib-5");
    const { subjects } = await api<{ subjects: PracticeSubject[] }>("GET", "/subjects");
    for (const id of ["sub-chem", "math"]) {
      expect(subjects.find(subject => subject.id === id)).toMatchObject({ question: 0, levels: {} });
    }
    expect((await page("question", learner, "&subject=sub-chem")).items).toEqual([]);
    expect(await api("GET", "/library")).toEqual({ private_count: 2, shared_count: 0 });
  });

  it("keeps the feed independent of mock exams, notes and decks", async () => {
    fixture.db.exec(`
      INSERT INTO documents(id,slug,title,kind,status,subject_id,created_by,created_at,updated_at,current_revision_id,answers_revision_id) VALUES
        ('exam','exam','Exam','exam','published','math','learner',1,1,'exam-rev','exam-ans'),
        ('note','note','Note','note','published','math','learner',1,1,'note-rev',NULL);
      INSERT INTO revisions(id,document_id,body_md,source,created_at) VALUES
        ('exam-rev','exam',':::question{#q1}' || char(10) || 'What is 1+1?' || char(10) || ':::','import',1),
        ('note-rev','note','Note content','import',1);
      INSERT INTO answer_revisions(id,document_id,answers_json,status,created_at) VALUES
        ('exam-ans','exam','{"schema":"exam-answers/v1","questions":[{"id":"q1","type":"numeric","answer":2}]}','approved',1);
      INSERT INTO decks(id,subject_id,title,created_by,created_at,updated_at) VALUES ('deck','math','Math terms','learner',1,1);
      INSERT INTO cards(id,deck_id,ord,front,back,created_at,updated_at) VALUES ('card','deck',1,'Derivative','Rate of change',1,1);
    `);
    for (const kind of ["question", "flashcard", "concept"] as const) {
      expect(await page(kind)).toEqual({ items: [], next: null });
    }
    await expect(api("POST", "/reveal", { ref: { kind: "flashcard", entry: "1", source_key: "1:card", version: "1" } }))
      .rejects.toMatchObject({ cause: 404 });
  });

  it("accepts independently designed multi-choice, numeric and short-answer questions", async () => {
    await add([
      { kind: "question", prompt_md: "Prime numbers", answer_format: "multiple", options: ["2", "3", "4"], correct_options: [1, 2] },
      { kind: "question", prompt_md: "Length", answer_format: "numeric", numeric_answer: -0.25, unit: "m", absolute_tolerance: 0.01 },
      { kind: "question", prompt_md: "Gas", answer_format: "text", accepted_answers: ["carbon dioxide", "CO2"] },
    ]);
    const { items } = await page("question");
    const [multi, numeric, text] = ["Prime numbers", "Length", "Gas"].map(prompt => items.find(item => item.prompt_md === prompt)!);
    expect(multi).toMatchObject({ multiple: true, selection_limit: 2 });
    expect(await api("POST", "/reveal", { ref: ref(multi), answer: ["B", "A"] })).toMatchObject({ correct: true, correct_options: ["A", "B"] });
    await expect(api("POST", "/reveal", { ref: ref(multi), answer: ["A", "A"] })).rejects.toMatchObject({ cause: 422 });
    expect(numeric).not.toHaveProperty("numeric_answer");
    expect(await api("POST", "/reveal", { ref: ref(numeric), answer: "-1/4" })).toMatchObject({ correct: true, reference_md: "-0.25 m" });
    expect(text).not.toHaveProperty("accepted_answers");
    expect(await api("POST", "/reveal", { ref: ref(text), answer: "CO2" })).toMatchObject({ correct: true, reference_md: "carbon dioxide" });
  });

  it("sends only the current item for AI explanation, renders both math delimiters, and shares the quota", async () => {
    await add(imported.items);
    const [item] = (await page("question")).items;
    const key = await encryptLiveAiKey(env, "fake-test-key");
    fixture.db.prepare("UPDATE live_ai_config SET enabled=1, model='test/model', requests_per_minute=1, encrypted_key=?").run(key);
    const content = String.raw`用 \(x^2\) 表示。

\[
\begin{aligned}x^2 &= 4 \\ x&=2\end{aligned}
\]
`;
    const provider = vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      expect(payload.tools).toBeUndefined();
      const context = JSON.parse(payload.messages[1].content);
      expect(context).toMatchObject({ learner_answer: "B", reference: "$4$", result: false, prompt: "What is $2^2$?" });
      return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 45 } });
    });
    vi.stubGlobal("fetch", provider);
    const action = { ref: ref(item), answer: "B" };
    const result = await api<{ markdown: string }>("POST", "/explain", action);
    expect(renderMarkdown(result.markdown)).toContain('class="katex-display"');
    expect(renderMarkdown(result.markdown)).toContain('class="katex"');
    await expect(api("POST", "/explain", action)).rejects.toMatchObject({ cause: 429 });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

it("rotates sparse practice lanes, continues into the next cycle, and retries an empty feed", async () => {
  const item = (kind: PracticeKind, entry: string) => ({ kind, entry }) as PracticeItem;
  let empty = true;
  const feed = createPracticeFeed(async (kind, cursor) => {
    if (empty || kind === "concept") return { items: [], next: null };
    if (kind === "flashcard") return { items: [item(kind, "f1")], next: null };
    if (!cursor.key) return { items: [], next: { key: "first", offset: 0 } };
    return { items: [item(kind, "q1"), item(kind, "q2")], next: null };
  }, PRACTICE_KINDS);
  const signal = new AbortController().signal;
  expect(await feed(signal)).toBeNull();
  empty = false;
  const order = [];
  for (let i = 0; i < 6; i++) order.push((await feed(signal))?.entry);
  expect(order.slice(0, 3).sort()).toEqual(["f1", "q1", "q2"]);
  expect(order.slice(3, 6).sort()).toEqual(["f1", "q1", "q2"]);
});

it("buffers selected kinds ahead of the current item without consuming cached page data", async () => {
  const items = ["first", "second", "third", "fourth"].map(entry => ({ kind: "question", entry }) as PracticeItem);
  const page: PracticePage = { items, next: null };
  const fetch = vi.fn(async () => page);
  const cache = new QueryClient();
  const ready: string[] = [];
  const controller = new AbortController();
  const fetchPage = () => cache.fetchQuery({ queryKey: ["page"], queryFn: fetch, staleTime: 90_000 });
  const feed = bufferPracticeFeed(createPracticeFeed(fetchPage, ["question"]), controller.signal, item => ready.push(item.entry));
  expect(await feed.take()).toBe(items[0]);
  await vi.waitFor(() => expect(ready).toEqual(["first", "second", "third", "fourth"]));
  expect(feed.takeReady()).toBe(items[1]);
  await vi.waitFor(() => expect(ready.at(-1)).toBe("first"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(page.items).toHaveLength(4);
  controller.abort();
});
