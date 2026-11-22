import { visit } from "unist-util-visit";
import { gradeQuestion, type QuestionSpec } from "../../shared/exam";
import { parseMarkdown } from "../../shared/markdown";
import type { PracticeAnswer, PracticeFeedback, PracticeImportItem, PracticeItem, PracticeKind, PracticeLevel, PracticePage, PracticeRef, PracticeSource } from "../../shared/practice";
import { bad } from "./util";

type PracticeRow = { id: string; user_id: string; subject_id: string; item_json: string };
type PracticeEntry = { item: PracticeItem; spec?: QuestionSpec; reference?: string };

const PAGE_SIZE = 4;

function practiceEntry(row: PracticeRow, viewerId: string): PracticeEntry {
  const content = JSON.parse(row.item_json) as PracticeImportItem;
  const item: PracticeItem = {
    kind: content.kind, source_key: "0:" + row.id, entry: "1", version: "1",
    subject_id: row.subject_id, prompt_md: content.prompt_md,
    ...(row.user_id !== viewerId ? { shared_by_member: true } : {}),
  };
  if (content.kind !== "question") return { item, reference: content.answer_md };

  item.passage_md = content.passage_md;
  item.instructions = content.instructions_md;
  const base = { id: item.entry, explanation: content.explanation_md };
  if ("options" in content) {
    item.options = content.options.map((md, i) => ({ id: String.fromCharCode(65 + i), md }));
    const optionIds = item.options.map(option => option.id);
    if ("correct_options" in content) {
      const answer = content.correct_options.map(index => optionIds[index - 1]);
      item.multiple = true;
      item.selection_limit = answer.length;
      return { item, spec: { ...base, type: "multi_choice", answer, options: optionIds } };
    }
    return { item, spec: { ...base, type: "single_choice", answer: optionIds[content.correct_option - 1] } };
  }
  if (content.answer_format === "numeric") {
    item.unit = content.unit;
    return {
      item,
      spec: {
        ...base, type: "numeric", answer: content.numeric_answer, unit: content.unit,
        tolerance: { abs: content.absolute_tolerance },
      },
    };
  }
  return { item, spec: { ...base, type: "text", accept: content.accepted_answers } };
}

export function practiceScope(source: PracticeSource) {
  return source === "own" ? "user_id=?" : "(user_id=? OR visibility='shared')";
}

export const PRACTICE_SUBJECT_LEVEL_SQL = "(s.practice_scale='ib') = (p.level GLOB 'ib-*')";

export async function practicePage(env: Env, userId: string, source: PracticeSource, kind: PracticeKind, subjects: string[], key: string, level?: PracticeLevel): Promise<PracticePage> {
  const after = key.startsWith("0:") ? key.slice(2) : "";
  const { results } = await env.DB.prepare(
    `SELECT p.id,p.user_id,p.subject_id,p.item_json FROM practice_items p JOIN subjects s ON s.id=p.subject_id
      WHERE ${practiceScope(source)} AND p.kind=? AND ${PRACTICE_SUBJECT_LEVEL_SQL}
      ${level ? "AND p.level=?" : ""} AND p.subject_id IN (SELECT value FROM json_each(?)) AND p.id>? ORDER BY p.id LIMIT ?`,
  ).bind(userId, kind, ...(level ? [level] : []), JSON.stringify(subjects), after, PAGE_SIZE + 1).all<PracticeRow>();
  const items = results.slice(0, PAGE_SIZE).map(row => practiceEntry(row, userId).item);
  return { items, next: results.length > PAGE_SIZE ? { key: items[PAGE_SIZE - 1].source_key, offset: 0 } : null };
}

export async function resolvePracticeEntry(env: Env, userId: string, ref: PracticeRef): Promise<PracticeEntry> {
  if (!ref.source_key.startsWith("0:") || ref.entry !== "1") bad("找不到此練習內容", 404);
  const row = await env.DB.prepare(`SELECT id,user_id,subject_id,item_json FROM practice_items WHERE id=? AND ${practiceScope("all")} AND kind=?`)
    .bind(ref.source_key.slice(2), userId, ref.kind).first<PracticeRow>();
  if (!row) bad("找不到此練習內容", 404);
  if (ref.version !== "1") bad("練習內容已更新，請重新載入", 409);
  return practiceEntry(row, userId);
}

export function practiceFeedback(entry: PracticeEntry, answer?: PracticeAnswer): PracticeFeedback {
  const { item, spec, reference } = entry;
  if (!spec) return { correct: null, reference_md: reference };
  if (answer !== undefined) {
    const selected = Array.isArray(answer) ? answer : [answer];
    if (Array.isArray(answer) !== !!item.multiple || !selected.length || new Set(selected).size !== selected.length || selected.some(value =>
      !value.trim() || (item.options && !item.options.some(option => option.id === value)))) bad("請先選擇或填寫答案", 422);
    if (item.selection_limit && selected.length > item.selection_limit) bad("選擇的答案超過題目上限", 422);
  }
  const graded = gradeQuestion(spec, answer);
  const correct = answer === undefined ? null : graded.correct;
  if (item.options) {
    const expected = Array.isArray(graded.expected) ? graded.expected : [graded.expected];
    const options = item.options.filter(option => expected.includes(option.id));
    return {
      correct, correct_options: options.map(option => option.id),
      reference_md: options.map(option => option.md).join("\n\n"),
      explanation_md: graded.explanation,
    };
  }
  const value = String(graded.expected ?? "");
  return {
    correct,
    reference_md: item.unit ? value + " " + item.unit : value,
    explanation_md: graded.explanation,
  };
}

/** Models sometimes use TeX delimiters even when prompted for Markdown math. */
export function practiceExplanationMarkdown(markdown: string) {
  if (!/\\[[(]/.test(markdown)) return markdown;
  const protectedRanges: [number, number][] = [];
  visit(parseMarkdown(markdown), node => {
    if (node.type !== "code" && node.type !== "inlineCode" && node.type !== "math" && node.type !== "inlineMath") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) protectedRanges.push([start, end]);
  });
  function convert(text: string) {
    return text.replace(/(?<!\\)\\\[([\s\S]+?)(?<!\\)\\\]|(?<!\\)\\\(([^\n]+?)(?<!\\)\\\)/g,
      (_match, display: string | undefined, inline: string | undefined) =>
        display === undefined ? `$${inline!.trim()}$` : `\n\n$$\n${display.trim()}\n$$\n\n`);
  }
  let result = "";
  let position = 0;
  for (const [start, end] of protectedRanges) {
    result += convert(markdown.slice(position, start)) + markdown.slice(start, end);
    position = end;
  }
  return result + convert(markdown.slice(position));
}
