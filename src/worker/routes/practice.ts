import { Hono, type Context } from "hono";
import { z } from "zod";
import { canAccess } from "../../shared/access";
import { practiceAnswerSchema, practiceImportSchema, PRACTICE_KINDS, practiceLevelSchema, practiceRefSchema, practiceSourceSchema, practiceVisibilitySchema, type PracticeKind, type PracticeLevel, type PracticeLibrary, type PracticePage, type PracticeSubject } from "../../shared/practice";
import { resolveCreateVisibility } from "../lib/access";
import { boundedJson, practiceExplanation } from "../lib/live-ai/service";
import { PRACTICE_SUBJECT_LEVEL_SQL, practiceExplanationMarkdown, practiceFeedback, practicePage, practiceScope, resolvePracticeEntry } from "../lib/practice";
import type { AppEnv } from "../lib/types";
import { bad } from "../lib/util";

const practice = new Hono<AppEnv>();
const kindSchema = z.enum(PRACTICE_KINDS);
const cursorKey = z.string().max(240).regex(/^(?:[01]:.+)?$/);
const subjectIds = z.array(practiceImportSchema.shape.subject_id).min(1).max(32);
const actionSchema = z.object({ ref: practiceRefSchema, answer: practiceAnswerSchema.optional() });

function readSource(c: Context<AppEnv>) {
  const source = practiceSourceSchema.default("all").safeParse(c.req.query("source"));
  if (!source.success) bad("複習內容來源不正確");
  return source.data;
}

practice.get("/library", async c => {
  const library = await c.env.DB.prepare(`
    SELECT COUNT(*) FILTER (WHERE visibility='private') AS private_count,
      COUNT(*) FILTER (WHERE visibility='shared') AS shared_count
    FROM practice_items WHERE user_id=?
  `).bind(c.get("user").id).first<PracticeLibrary>();
  return c.json(library ?? { private_count: 0, shared_count: 0 });
});

practice.put("/library/visibility", async c => {
  const body = z.object({ visibility: practiceVisibilitySchema }).safeParse(await boundedJson(c.req.raw, 1024));
  if (!body.success) bad("複習內容可見範圍不正確");
  const visibility = resolveCreateVisibility(c, body.data.visibility);
  const { meta } = await c.env.DB.prepare("UPDATE practice_items SET visibility=? WHERE user_id=? AND visibility<>?")
    .bind(visibility, c.get("user").id, visibility).run();
  return c.json({ visibility, changed: meta.changes });
});

practice.delete("/library", async c => {
  const { meta } = await c.env.DB.prepare("DELETE FROM practice_items WHERE user_id=?").bind(c.get("user").id).run();
  return c.json({ deleted: meta.changes });
});

practice.get("/subjects", async c => {
  const { results } = await c.env.DB.prepare(`
    SELECT s.id, s.name, s.color, s.practice_scale, p.kind, p.level, p.count
    FROM subjects s LEFT JOIN (
      SELECT subject_id, kind, level, COUNT(*) AS count
      FROM practice_items WHERE ${practiceScope(readSource(c))} GROUP BY subject_id, kind, level
    ) p ON p.subject_id=s.id AND ${PRACTICE_SUBJECT_LEVEL_SQL}
    ORDER BY s.sort, s.name
  `).bind(c.get("user").id).all<Pick<PracticeSubject, "id" | "name" | "color" | "practice_scale"> & {
    kind: PracticeKind | null; level: PracticeLevel | null; count: number | null;
  }>();
  const subjects = new Map<string, PracticeSubject>();
  for (const { id, name, color, practice_scale, kind, level, count } of results) {
    const subject = subjects.get(id) ?? { id, name, color, practice_scale, question: 0, flashcard: 0, concept: 0, levels: {} };
    if (kind && level && count) {
      subject[kind] += count;
      (subject.levels[level] ??= {})[kind] = count;
    }
    subjects.set(id, subject);
  }
  return c.json({ subjects: [...subjects.values()] });
});

practice.get("/items", async c => {
  const kind = kindSchema.safeParse(c.req.query("kind"));
  const subjects = subjectIds.safeParse(c.req.queries("subject"));
  const key = cursorKey.safeParse(c.req.query("after") ?? "");
  const level = practiceLevelSchema.optional().safeParse(c.req.query("level"));
  const offset = Number(c.req.query("offset") ?? 0);
  if (!kind.success || !subjects.success || !key.success || !level.success || !Number.isSafeInteger(offset) || offset < 0 || (offset && !key.data)) {
    bad("科目、練習類型或進度格式不正確");
  }
  return c.json<PracticePage>(await practicePage(c.env, c.get("user").id, readSource(c), kind.data, subjects.data, key.data, level.data));
});

async function resolveAction(c: Context<AppEnv>) {
  const parsed = actionSchema.safeParse(await boundedJson(c.req.raw, 16_384));
  if (!parsed.success) bad("練習題目或作答格式不正確");
  const { ref, answer } = parsed.data;
  const entry = await resolvePracticeEntry(c.env, c.get("user").id, ref);
  return { entry, answer };
}

practice.post("/reveal", async c => {
  const { entry, answer } = await resolveAction(c);
  if (entry.spec && answer === undefined) bad("請先選擇或填寫答案", 422);
  return c.json(practiceFeedback(entry, answer));
});

practice.post("/explain", async c => {
  if (!canAccess(c.get("accessRules"), "ai")) bad("你的群組未開放 AI 功能", 403);
  const { entry, answer } = await resolveAction(c);
  const feedback = practiceFeedback(entry, answer);
  const { item } = entry;
  const markdown = await practiceExplanation(c.env, c.get("user"), {
    kind: item.kind,
    prompt: item.prompt_md,
    passage: item.passage_md,
    instructions: item.instructions,
    unit: item.unit,
    options: item.options,
    learner_answer: answer,
    reference: feedback.reference_md,
    explanation: feedback.explanation_md,
    result: feedback.correct,
  }, c.req.raw.signal);
  return c.json({ markdown: practiceExplanationMarkdown(markdown) });
});

export default practice;
