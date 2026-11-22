import { Hono } from "hono";
import { practiceImportSchema, practiceItemLevel, type PracticeScale } from "../../shared/practice";
import { resolveCreateVisibility } from "../lib/access";
import type { AppEnv } from "../lib/types";
import { bad, readJson, sha256Hex } from "../lib/util";

// Only mounted by the OAuth-bound MCP app.
const practiceMcp = new Hono<AppEnv>();
practiceMcp.post("/items", async c => {
  const parsed = practiceImportSchema.safeParse(await readJson<unknown>(c.req.raw));
  if (!parsed.success) bad("複習內容格式不正確", 422);
  const { subject_id, items } = parsed.data;
  const visibility = resolveCreateVisibility(c, parsed.data.visibility ?? "private");
  const subject = await c.env.DB.prepare("SELECT practice_scale FROM subjects WHERE id=?").bind(subject_id).first<{ practice_scale: PracticeScale }>();
  if (!subject) bad("找不到此科目", 404);
  if (subject.practice_scale === "ib") {
    if (items.some(item => !item.ib_grade || item.difficulty)) bad("IB 科目的每項內容都必須填寫 IB 目標分數（1–7）", 422);
  } else if (items.some(item => item.ib_grade)) {
    bad("一般科目的內容請使用一般難度", 422);
  }
  if (items.some(item => {
    if (item.kind !== "question" || !("options" in item)) return false;
    const correct = "correct_options" in item ? item.correct_options : [item.correct_option];
    return new Set(item.options).size !== item.options.length || new Set(correct).size !== correct.length
      || correct.some(index => index > item.options.length);
  })) {
    bad("正確答案須指向現有選項，每個選項須不同", 422);
  }
  const userId = c.get("user").id;
  const statements = await Promise.all(items.map(async item => {
    const json = JSON.stringify(item);
    const id = await sha256Hex(JSON.stringify([userId, subject_id, item]));
    return c.env.DB.prepare(`INSERT INTO practice_items(id,user_id,subject_id,kind,item_json,level,visibility) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id, userId, subject_id, item.kind, json, practiceItemLevel(item), visibility);
  }));
  const results = await c.env.DB.batch(statements);
  return c.json({ subject_id, added: results.reduce((total, result) => total + result.results.length, 0), submitted: items.length }, 201);
});

export default practiceMcp;
