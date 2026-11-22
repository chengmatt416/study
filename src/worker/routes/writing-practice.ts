import { Hono, type Context } from "hono";
import type { z } from "zod";
import {
  WRITING_STATUSES, resolveWritingFeedback, writingDraftSchema, writingFeedbackSchema, writingPromptSchema,
  type WritingFeedback, type WritingPractice, type WritingPrompt, type WritingStatus, type WritingSummary,
} from "../../shared/writing-practice";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson, uid } from "../lib/util";

type WritingContext = Context<AppEnv>;

interface WritingRow {
  id: string;
  title: string;
  language: WritingPractice["language"];
  prompt: string;
  markscheme_json: string;
  draft: string | null;
  feedback_json: string | null;
  final_draft: string | null;
  created_at: number;
}

const writing = new Hono<AppEnv>();
export const writingMcp = new Hono<AppEnv>();
const statusSql = "CASE WHEN final_draft IS NOT NULL THEN 'complete' WHEN feedback_json IS NOT NULL THEN 'revision' WHEN draft IS NOT NULL THEN 'awaiting_feedback' ELSE 'draft' END";
const getStatus = (row: WritingRow): WritingStatus => row.final_draft !== null ? "complete" : row.feedback_json !== null ? "revision" : row.draft !== null ? "awaiting_feedback" : "draft";
const markscheme = (row: WritingRow) => JSON.parse(row.markscheme_json) as WritingPrompt["markscheme"];

async function parse<S extends z.ZodType>(c: WritingContext, schema: S) {
  const result = schema.safeParse(await readJson(c.req.raw));
  if (!result.success) bad("寫作練習資料有誤", 400, { errors: result.error.issues.map((issue) => `${issue.path.join(".") || "body"}：${issue.message}`) });
  return result.data;
}

async function getRow(c: WritingContext, id: string) {
  const row = await c.env.DB.prepare("SELECT * FROM writing_practices WHERE id = ? AND user_id = ?")
    .bind(id, c.get("user").id).first<WritingRow>();
  if (!row) bad("找不到此寫作練習", 404);
  return row;
}

function learnerView(row: WritingRow): WritingPractice {
  return {
    id: row.id, title: row.title, language: row.language, prompt: row.prompt, created_at: row.created_at,
    status: getStatus(row), draft: row.draft, final_draft: row.final_draft,
    markscheme: row.feedback_json ? markscheme(row) : null,
    feedback: row.feedback_json ? JSON.parse(row.feedback_json) as WritingFeedback : null,
  };
}

writing.get("/", async (c) => {
  const filter = c.req.query("status");
  const state = WRITING_STATUSES.find((status) => status === filter) ?? null;
  if (filter && !state) bad("未知的寫作練習狀態");
  const { results } = await c.env.DB.prepare(`
    SELECT id, title, language, created_at, ${statusSql} AS status FROM writing_practices
    WHERE user_id = ? AND (? IS NULL OR (${statusSql}) = ?)
    ORDER BY created_at DESC, id DESC
  `).bind(c.get("user").id, state, state).all<WritingSummary>();
  return c.json({ practices: results });
});

writing.get("/:id", async (c) => c.json(learnerView(await getRow(c, c.req.param("id")))));

writing.post("/:id/draft", async (c) => {
  const id = c.req.param("id");
  const { text } = await parse(c, writingDraftSchema);
  const row = await c.env.DB.prepare("UPDATE writing_practices SET draft = ? WHERE id = ? AND user_id = ? AND draft IS NULL RETURNING *")
    .bind(text, id, c.get("user").id).first<WritingRow>() ?? await getRow(c, id);
  if (row.draft !== text) bad("此初稿已經送出，請重新載入以查看最新進度", 409);
  return c.json(learnerView(row));
});

writing.post("/:id/final", async (c) => {
  const id = c.req.param("id");
  const { text } = await parse(c, writingDraftSchema);
  const row = await c.env.DB.prepare("UPDATE writing_practices SET final_draft = ? WHERE id = ? AND user_id = ? AND feedback_json IS NOT NULL AND final_draft IS NULL RETURNING *")
    .bind(text, id, c.get("user").id).first<WritingRow>() ?? await getRow(c, id);
  if (row.final_draft !== text) bad(row.final_draft ? "此定稿已經送出，請重新載入以查看最新進度" : "請先完成初稿批改", 409);
  return c.json(learnerView(row));
});

// These endpoints are mounted only on the internal MCP router.
writingMcp.post("/", async (c) => {
  const prompt = await parse(c, writingPromptSchema);
  const id = uid();
  await c.env.DB.prepare("INSERT INTO writing_practices (id, user_id, title, language, prompt, markscheme_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, c.get("user").id, prompt.title, prompt.language, prompt.prompt, JSON.stringify(prompt.markscheme), now()).run();
  return c.json({ id, title: prompt.title, status: "draft" }, 201);
});

writingMcp.get("/:id", async (c) => {
  const row = await getRow(c, c.req.param("id"));
  if (row.draft === null) bad("學生尚未送出初稿", 409);
  return c.json({
    id: row.id, title: row.title, language: row.language, prompt: row.prompt, draft: row.draft,
    status: getStatus(row),
    markscheme: markscheme(row).map((criterion, i) => ({ criterion: i + 1, ...criterion })),
  });
});

writingMcp.post("/:id/feedback", async (c) => {
  const row = await getRow(c, c.req.param("id"));
  if (row.draft === null) bad("學生尚未送出初稿", 409);
  const input = await parse(c, writingFeedbackSchema);
  const result = resolveWritingFeedback(row.draft, markscheme(row), input);
  if ("errors" in result) bad("批改未通過檢查", 422, { errors: result.errors });
  const feedback = JSON.stringify(result.feedback);
  const updated = await c.env.DB.prepare("UPDATE writing_practices SET feedback_json = ? WHERE id = ? AND user_id = ? AND feedback_json IS NULL RETURNING *")
    .bind(feedback, row.id, c.get("user").id).first<WritingRow>() ?? await getRow(c, row.id);
  if (updated.feedback_json !== feedback) bad("此初稿已經批改", 409);
  return c.json({ id: row.id, status: getStatus(updated), total: result.feedback.total, max: result.feedback.max });
});

export default writing;
