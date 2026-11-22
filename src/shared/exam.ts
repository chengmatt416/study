// 模擬試題：答案 JSON 規格、驗證、公開題目規格（不含答案）、伺服器端批改。
import { create, all, type MathJsInstance } from "mathjs";
import { normalizeChoiceLabels, parseChoicePrefix, parseMarkdown, stripFrontmatter, type Frontmatter } from "./markdown";
import { latexToPlain, looksLikeLatex } from "./latex-math";
import { visit } from "unist-util-visit";

export const ANSWERS_SCHEMA = "exam-answers/v1";

/** 填空 / 摘要題的預設單一空格標記（與 Open Doors 題型規格相容）。 */
export const GAP_TOKEN = "{gap}";

/** 統一正規化英文/文字作答：全半形、大小寫、彎引號、破折號、首尾標點與多餘空白。 */
export function normalizeCompletionAnswer(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'(]+/, "")
    .replace(/[.,;:!?"')]+$/, "")
    .trim();
}

const NUMBER_TOKEN_RE = /^[0-9][0-9.,:/%-]*$/;

/** 計算字數（IELTS 規則：若允許數字，純數字記號不計入字數限制）。 */
export function countCompletionWords(text: string, numbersAllowed: boolean): number {
  const normalized = normalizeCompletionAnswer(text);
  if (normalized.length === 0) return 0;
  return normalized
    .split(" ")
    .filter((token) => !(numbersAllowed && NUMBER_TOKEN_RE.test(token))).length;
}

const NUMBER_WORDS = ["ONE", "TWO", "THREE", "FOUR", "FIVE"] as const;

/** IELTS / 閱讀填空字數上限說明文字。 */
export function wordLimitInstruction(wordLimit: number, numbersAllowed: boolean): string {
  const count = NUMBER_WORDS[wordLimit - 1] ?? String(wordLimit);
  const base = wordLimit === 1 ? "ONE WORD" : `NO MORE THAN ${count} WORDS`;
  if (numbersAllowed) return `${base} AND/OR A NUMBER`;
  return wordLimit === 1 ? "ONE WORD ONLY" : base;
}

export interface Tolerance {
  abs?: number;
  rel?: number;
  /** IB 常見「答案取 3 位有效數字」：雙方四捨五入到 n 位有效數字後相等即正確 */
  sig_figs?: number;
}

interface Base {
  id: string;
  points?: number;
  /** 提交後顯示的解析（Markdown） */
  explanation?: string;
  /** 題目額外說明（如 Choose TWO letters） */
  instructions?: string;
  /** 關聯的閱讀文章 id（對應 Markdown 中的 ::::passage{#id}） */
  passage?: string;
  /** IB 指令詞（如 Calculate, Explain, State） */
  command_term?: string;
}

export type ScalarSpec =
  | { kind: "numeric"; answer: number | string; tolerance?: Tolerance; unit?: string }
  | { kind: "text"; accept: string[]; case_sensitive?: boolean; ignore_punct?: boolean; regex?: string; word_limit?: number; numbers_allowed?: boolean }
  | { kind: "expression"; answer: string; variables?: string[] };

export type BlankSpec = { id: string } & ScalarSpec;

export type CompletionLayout =
  | { kind: "text"; title?: string; lines: string[] }
  | { kind: "notes"; title?: string; lines: string[] }
  | { kind: "table"; title?: string; columns: string[]; rows: string[][] }
  | { kind: "flowchart"; title?: string; steps: string[] }
  | { kind: "diagram"; title?: string; description?: string; image?: string; labels: string[] };

export interface WordBankOption {
  key: string;
  text: string;
}

export type JudgementTfngAnswer = "TRUE" | "FALSE" | "NOT_GIVEN";
export type JudgementYnngAnswer = "YES" | "NO" | "NOT_GIVEN";

export type QuestionSpec =
  | (Base & { type: "single_choice"; answer: string; options?: string[]; option_texts?: Record<string, string> })
  | (Base & { type: "multi_choice"; answer: string[]; options?: string[]; option_texts?: Record<string, string>; select_count?: number; scoring?: "all_or_nothing" | "partial" | "per_option" })
  | (Base & { type: "true_false"; answer: boolean })
  | (Base & { type: "tfng"; answer: JudgementTfngAnswer })
  | (Base & { type: "ynng"; answer: JudgementYnngAnswer })
  | (Base & { type: "numeric"; answer: number | string; tolerance?: Tolerance; unit?: string })
  | (Base & { type: "text"; accept: string[]; case_sensitive?: boolean; ignore_punct?: boolean; regex?: string; word_limit?: number; numbers_allowed?: boolean; unit?: string })
  | (Base & { type: "expression"; answer: string; variables?: string[] })
  | (Base & { type: "fill_blank"; blanks: BlankSpec[]; scoring?: "per_blank" | "all_or_nothing" })
  | (Base & {
      type: "completion";
      layout?: CompletionLayout;
      word_limit?: number;
      numbers_allowed?: boolean;
      word_bank?: WordBankOption[];
      accept?: string[];
      case_sensitive?: boolean;
      ignore_punct?: boolean;
      blanks?: BlankSpec[];
      scoring?: "per_blank" | "all_or_nothing";
    })
  | (Base & {
      type: "evidence";
      accept_quotes: string[];
      block_id?: string;
      case_sensitive?: boolean;
      ignore_punct?: boolean;
      allow_absence?: boolean;
      absence_answer?: boolean;
    })
  | (Base & { type: "ordering"; items: string[]; scoring?: "all_or_nothing" | "partial" })
  | (Base & { type: "matching"; pairs: { left: string; right: string }[]; distractors?: string[]; allow_reuse?: boolean; variant?: "pairs" | "headings" | "information" | "features" | "endings" })
  | (Base & { type: "multipart"; parts: QuestionSpec[] })
  | (Base & { type: "open"; model_answer?: string; rubric?: string });

export type QuestionType = QuestionSpec["type"];

export interface AnswersFile {
  schema: typeof ANSWERS_SCHEMA;
  questions: QuestionSpec[];
}

// ---------- 公開規格（送到瀏覽器，絕不含答案） ----------
export interface PublicBlank {
  id: string;
  kind: ScalarSpec["kind"];
  unit?: string;
  wordLimit?: number;
  numbersAllowed?: boolean;
}

export interface PublicQuestion {
  id: string;
  type: QuestionType;
  points: number;
  instructions?: string;
  passage?: string;
  commandTerm?: string;
  options?: string[];
  optionTexts?: Record<string, string>;
  blanks?: PublicBlank[];
  unit?: string;
  wordLimit?: number;
  numbersAllowed?: boolean;
  layout?: CompletionLayout;
  wordBank?: WordBankOption[];
  items?: string[];
  lefts?: string[];
  rights?: string[];
  allowReuse?: boolean;
  matchingVariant?: "pairs" | "headings" | "information" | "features" | "endings";
  allowAbsence?: boolean;
  parts?: PublicQuestion[];
  maxSelections?: number;
}

export type EvidenceResponse =
  | { type: "SPAN"; passageId?: string; blockId: string; startOffset?: number; endOffset?: number; quote: string }
  | { type: "ABSENCE" };

export type Response =
  | string
  | string[]
  | boolean
  | EvidenceResponse
  | Record<string, string>
  | { [part: string]: Response }
  | null
  | undefined;

export interface QuestionResult {
  id: string;
  score: number;
  max: number;
  /** true/false；部分給分為 "partial"；open 題為 null（待自評） */
  correct: boolean | "partial" | null;
  expected?: unknown;
  explanation?: string;
  detail?: Record<string, boolean>;
  parts?: QuestionResult[];
  modelAnswer?: string;
  rubric?: string;
  /** 批改評語（ChatGPT 等 AI 透過 MCP 批改時寫入） */
  comment?: string;
}

export interface GradeResult {
  score: number;
  max: number;
  pendingSelfGrade: number;
  questions: QuestionResult[];
}

// ---------- 驗證 ----------
const TYPES: QuestionType[] = [
  "single_choice", "multi_choice", "true_false", "tfng", "ynng", "numeric", "text", "expression",
  "fill_blank", "completion", "evidence", "ordering", "matching", "multipart", "open",
];

function isStrArr(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateWordLimit(prefix: string, o: Record<string, unknown>, errors: string[]) {
  if (o.word_limit !== undefined && (typeof o.word_limit !== "number" || !Number.isInteger(o.word_limit) || o.word_limit < 1 || o.word_limit > 10)) {
    errors.push(`${prefix}: word_limit 必須是 1 到 10 的整數`);
  }
}

function validateCompletionLayout(prefix: string, raw: unknown, errors: string[]) {
  if (!raw || typeof raw !== "object") {
    errors.push(`${prefix}.layout: 必須是物件`);
    return;
  }
  const l = raw as Record<string, unknown>;
  if (l.kind === "text" || l.kind === "notes") {
    if (!isStrArr(l.lines) || l.lines.length === 0) errors.push(`${prefix}.layout.lines: 需要非空字串陣列`);
  } else if (l.kind === "table") {
    if (!isStrArr(l.columns) || l.columns.length === 0) errors.push(`${prefix}.layout.columns: 需要欄位陣列`);
    if (!Array.isArray(l.rows) || l.rows.length === 0 || !l.rows.every((r) => isStrArr(r) && r.length > 0)) {
      errors.push(`${prefix}.layout.rows: 需要非空二維字串陣列`);
    }
  } else if (l.kind === "flowchart") {
    if (!isStrArr(l.steps) || l.steps.length < 2) errors.push(`${prefix}.layout.steps: 需要至少 2 個步驟`);
  } else if (l.kind === "diagram") {
    if (typeof l.title !== "string" || !l.title.trim()) errors.push(`${prefix}.layout.title: diagram 需要 title`);
    if (!isStrArr(l.labels) || l.labels.length === 0) errors.push(`${prefix}.layout.labels: 需要標註陣列`);
  } else {
    errors.push(`${prefix}.layout.kind: 必須是 text / notes / table / flowchart / diagram`);
  }
}

function validateScalar(prefix: string, kind: string, q: Record<string, unknown>, errors: string[]) {
  if (kind === "numeric") {
    if (typeof q.answer !== "number" && typeof q.answer !== "string") errors.push(`${prefix}: numeric 需要 answer（數字或如 "11/49" 的字串）`);
    else if (parseNumber(String(q.answer)) === null) errors.push(`${prefix}: answer 無法解析為數值`);
  } else if (kind === "text") {
    if (!isStrArr(q.accept) || q.accept.length === 0) errors.push(`${prefix}: text 需要 accept（字串陣列）`);
    validateWordLimit(prefix, q, errors);
    if (q.regex !== undefined) {
      try {
        new RegExp(String(q.regex));
      } catch {
        errors.push(`${prefix}: regex 不合法`);
      }
    }
  } else if (kind === "expression") {
    if (typeof q.answer !== "string") errors.push(`${prefix}: expression 需要 answer 字串`);
    else {
      try {
        math().parse(q.answer);
      } catch {
        errors.push(`${prefix}: expression answer 無法解析`);
      }
    }
  } else errors.push(`${prefix}: 未知的 kind「${kind}」`);
}

function normalizeTfng(raw: unknown): JudgementTfngAnswer | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (t === "TRUE" || t === "T") return "TRUE";
  if (t === "FALSE" || t === "F") return "FALSE";
  if (t === "NOT_GIVEN" || t === "NG" || t === "NOTGIVEN") return "NOT_GIVEN";
  return null;
}

function normalizeYnng(raw: unknown): JudgementYnngAnswer | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (t === "YES" || t === "Y") return "YES";
  if (t === "NO" || t === "N") return "NO";
  if (t === "NOT_GIVEN" || t === "NG" || t === "NOTGIVEN") return "NOT_GIVEN";
  return null;
}

function validateQuestion(q: unknown, path: string, errors: string[], ids: Set<string>) {
  if (!q || typeof q !== "object") {
    errors.push(`${path}: 必須是物件`);
    return;
  }
  const o = q as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const p = `${path}(${id || "?"})`;
  if (!id) errors.push(`${path}: 缺少 id`);
  else if (ids.has(id)) errors.push(`${p}: id 重複`);
  else ids.add(id);
  if (!TYPES.includes(o.type as QuestionType)) {
    errors.push(`${p}: type 必須是 ${TYPES.join(" / ")}`);
    return;
  }
  if (o.points !== undefined && (typeof o.points !== "number" || o.points < 0)) errors.push(`${p}: points 必須是非負數`);
  switch (o.type) {
    case "single_choice":
      if (typeof o.answer !== "string") errors.push(`${p}: single_choice 的 answer 必須是選項標籤字串，如 "B"`);
      break;
    case "multi_choice":
      if (!isStrArr(o.answer) || o.answer.length === 0) errors.push(`${p}: multi_choice 的 answer 必須是標籤陣列，如 ["A","C"]`);
      if (o.select_count !== undefined && (typeof o.select_count !== "number" || !Number.isInteger(o.select_count) || o.select_count < 1)) {
        errors.push(`${p}: select_count 必須是正整數`);
      }
      break;
    case "true_false":
      if (typeof o.answer !== "boolean") errors.push(`${p}: true_false 的 answer 必須是 true/false`);
      break;
    case "tfng":
      if (!normalizeTfng(o.answer)) errors.push(`${p}: tfng 的 answer 必須是 "TRUE" / "FALSE" / "NOT_GIVEN"`);
      break;
    case "ynng":
      if (!normalizeYnng(o.answer)) errors.push(`${p}: ynng 的 answer 必須是 "YES" / "NO" / "NOT_GIVEN"`);
      break;
    case "numeric":
    case "text":
    case "expression":
      validateScalar(p, o.type, o, errors);
      break;
    case "fill_blank": {
      if (!Array.isArray(o.blanks) || o.blanks.length === 0) errors.push(`${p}: fill_blank 需要 blanks 陣列`);
      else {
        const bids = new Set<string>();
        o.blanks.forEach((b: Record<string, unknown>, i: number) => {
          const bp = `${p}.blanks[${i}]`;
          if (typeof b?.id !== "string") errors.push(`${bp}: 缺少 id`);
          else if (bids.has(b.id)) errors.push(`${bp}: blank id 重複`);
          else bids.add(b.id);
          validateScalar(bp, String(b?.kind ?? ""), b ?? {}, errors);
        });
      }
      break;
    }
    case "completion": {
      validateWordLimit(p, o, errors);
      if (o.layout !== undefined) validateCompletionLayout(p, o.layout, errors);
      if (o.word_bank !== undefined) {
        if (!Array.isArray(o.word_bank) || o.word_bank.length === 0 || !o.word_bank.every((w: Record<string, unknown>) => typeof w?.key === "string" && typeof w?.text === "string")) {
          errors.push(`${p}: word_bank 必須是 [{ key, text }] 非空陣列`);
        }
      }
      const hasAccept = isStrArr(o.accept) && o.accept.length > 0;
      const hasBlanks = Array.isArray(o.blanks) && o.blanks.length > 0;
      if (!hasAccept && !hasBlanks) {
        errors.push(`${p}: completion 需要 accept（字串陣列）或 blanks（空格陣列）`);
      }
      if (hasBlanks) {
        const bids = new Set<string>();
        (o.blanks as Record<string, unknown>[]).forEach((b, i) => {
          const bp = `${p}.blanks[${i}]`;
          if (typeof b?.id !== "string") errors.push(`${bp}: 缺少 id`);
          else if (bids.has(b.id)) errors.push(`${bp}: blank id 重複`);
          else bids.add(b.id);
          validateScalar(bp, String(b?.kind ?? ""), b ?? {}, errors);
        });
      }
      break;
    }
    case "evidence":
      if (o.absence_answer !== true && (!isStrArr(o.accept_quotes) || o.accept_quotes.length === 0)) {
        errors.push(`${p}: evidence 需要 accept_quotes（非空字串陣列）或設定 absence_answer: true`);
      }
      break;
    case "ordering":
      if (!isStrArr(o.items) || o.items.length < 2) errors.push(`${p}: ordering 需要 items（正確順序，至少 2 項）`);
      break;
    case "matching":
      if (!Array.isArray(o.pairs) || o.pairs.length === 0 || !o.pairs.every((x: Record<string, unknown>) => typeof x?.left === "string" && typeof x?.right === "string"))
        errors.push(`${p}: matching 需要 pairs: [{left,right}]`);
      break;
    case "multipart":
      if (!Array.isArray(o.parts) || o.parts.length === 0) errors.push(`${p}: multipart 需要 parts`);
      else {
        const pids = new Set<string>();
        o.parts.forEach((sub: unknown, i: number) => validateQuestion(sub, `${p}.parts[${i}]`, errors, pids));
      }
      break;
    case "open":
      break;
  }
}

export function validateAnswers(json: unknown): { ok: true; value: AnswersFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!json || typeof json !== "object") return { ok: false, errors: ["根節點必須是物件"] };
  const o = json as Record<string, unknown>;
  if (o.schema !== ANSWERS_SCHEMA) errors.push(`schema 必須是 "${ANSWERS_SCHEMA}"`);
  if (!Array.isArray(o.questions)) errors.push("questions 必須是陣列");
  else {
    const ids = new Set<string>();
    o.questions.forEach((q, i) => validateQuestion(q, `questions[${i}]`, errors, ids));
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: json as AnswersFile };
}

// ---------- 試題 Markdown 結構 ----------
export interface ExamStructure {
  frontmatter: Frontmatter;
  questionIds: string[];
  /** 每題（含 part）的 blank id */
  blanks: Record<string, string[]>;
  choices: Record<string, string[]>;
  parts: Record<string, string[]>;
  /** solution 區塊在原始碼中的位置（含 frontmatter 偏移） */
  solutionRanges: [number, number][];
  /** 文章（::::passage）id 清單 */
  passages?: string[];
  /** 題目指定的 passage 屬性 */
  questionPassages?: Record<string, string>;
}

interface Dir {
  type: string;
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: Dir[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export function analyzeExamMarkdown(md: string): ExamStructure {
  const { data, body } = stripFrontmatter(md);
  const offset = md.length - body.length;
  const tree = parseMarkdown(body);
  const res: ExamStructure = { frontmatter: data, questionIds: [], blanks: {}, choices: {}, parts: {}, solutionRanges: [], passages: [], questionPassages: {} };
  let n = 0;
  let pNo = 0;
  visit(tree, (node) => {
    const d = node as unknown as Dir;
    if (d.type === "containerDirective" && d.name === "solution" && d.position) {
      res.solutionRanges.push([d.position.start.offset! + offset, d.position.end.offset! + offset]);
      return "skip";
    }
    if (d.type === "containerDirective" && d.name === "passage") {
      pNo++;
      const pid = d.attributes?.id ?? `p${pNo}`;
      res.passages!.push(pid);
    }
    if (d.type === "containerDirective" && d.name === "question") {
      n++;
      const qid = d.attributes?.id ?? `q${n}`;
      res.questionIds.push(qid);
      if (d.attributes?.passage) res.questionPassages![qid] = d.attributes.passage;
      const collect = (root: Dir, key: string) => {
        visit(root as never, (inner) => {
          const x = inner as unknown as Dir;
          // 題目內的解析也要記錄，作答前才能完整移除（避免答案外洩）
          if (x.type === "containerDirective" && x.name === "solution" && x.position) {
            res.solutionRanges.push([x.position.start.offset! + offset, x.position.end.offset! + offset]);
            return "skip";
          }
          if (x !== root && x.type === "containerDirective" && x.name === "part") {
            const pid = x.attributes?.id ?? "";
            (res.parts[qid] ??= []).push(pid);
            collect(x, `${qid}.${pid}`);
            return "skip";
          }
          if ((x.type === "textDirective" || x.type === "leafDirective") && x.name === "blank") {
            (res.blanks[key] ??= []).push(x.attributes?.id ?? "");
          }
          if (x.type === "containerDirective" && x.name === "choices") {
            const raws: string[] = [];
            visit(x as never, "listItem", (li: { children: { children?: { type: string; value?: string }[] }[] }) => {
              const t = li.children?.[0]?.children?.[0];
              const parsed = t?.type === "text" && t.value ? parseChoicePrefix(t.value) : null;
              if (parsed) raws.push(parsed.raw);
            });
            res.choices[key] = normalizeChoiceLabels(raws);
          }
        });
      };
      collect(d, qid);
      return "skip";
    }
  });
  return res;
}

/** 取出每一題的原始 Markdown（題號 → 區塊原文）。 */
export function extractQuestionMarkdown(md: string): Record<string, string> {
  const { body } = stripFrontmatter(md);
  const tree = parseMarkdown(body);
  const out: Record<string, string> = {};
  let n = 0;
  visit(tree, (node) => {
    const d = node as unknown as Dir;
    if (d.type === "containerDirective" && d.name === "question" && d.position) {
      n++;
      out[d.attributes?.id ?? `q${n}`] = body.slice(d.position.start.offset!, d.position.end.offset!);
      return "skip";
    }
  });
  return out;
}

/** 移除所有 :::solution 區塊（作答前送給瀏覽器的版本）。 */
export function stripSolutions(md: string): string {
  const { solutionRanges } = analyzeExamMarkdown(md);
  let out = md;
  for (const [s, e] of [...solutionRanges].sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + out.slice(e);
  return out;
}

/** 檢查題目 md 與答案 JSON 是否一致。 */
export function crossCheck(md: string, answers: AnswersFile): string[] {
  const s = analyzeExamMarkdown(md);
  const errors: string[] = [];
  const jsonIds = answers.questions.map((q) => q.id);
  for (const id of s.questionIds) if (!jsonIds.includes(id)) errors.push(`題目 ${id} 在答案 JSON 中找不到`);
  for (const id of jsonIds) if (!s.questionIds.includes(id)) errors.push(`答案 JSON 的 ${id} 在題目 md 中找不到（需要 :::question{#${id}}）`);
  const checkQ = (q: QuestionSpec, key: string) => {
    if (q.type === "fill_blank" || (q.type === "completion" && q.blanks?.length)) {
      const mdBlanks = s.blanks[key] ?? [];
      for (const b of q.blanks ?? []) if (mdBlanks.length && !mdBlanks.includes(b.id)) errors.push(`${key}: 空格 ${b.id} 在題目中找不到（:blank{#${b.id}}）`);
    }
    if ((q.type === "single_choice" || q.type === "multi_choice") && !q.options) {
      const labels = s.choices[key];
      if (!labels?.length) errors.push(`${key}: 選擇題需要 ::::choices 清單或在 JSON 中提供 options`);
      else {
        const ans = q.type === "single_choice" ? [q.answer] : q.answer;
        for (const a of ans) if (!labels.some((l) => l.toLowerCase() === a.toLowerCase())) errors.push(`${key}: 答案 ${a} 不在選項 ${labels.join("/")} 中`);
      }
    }
    if (q.type === "multipart") for (const p of q.parts) checkQ(p, `${key}.${p.id}`);
  };
  for (const q of answers.questions) checkQ(q, q.id);
  return errors;
}

// ---------- 公開規格 ----------
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function questionPoints(q: QuestionSpec): number {
  if (q.type === "multipart") return q.points ?? q.parts.reduce((s, p) => s + questionPoints(p), 0);
  return q.points ?? 1;
}

function toPublicBlank(b: BlankSpec): PublicBlank {
  return {
    id: b.id,
    kind: b.kind,
    ...(b.kind === "numeric" && b.unit ? { unit: b.unit } : {}),
    ...(b.kind === "text" && b.word_limit !== undefined ? { wordLimit: b.word_limit } : {}),
    ...(b.kind === "text" && b.numbers_allowed !== undefined ? { numbersAllowed: b.numbers_allowed } : {}),
  };
}

export function toPublic(q: QuestionSpec, seed: string, choicesFromMd?: Record<string, string[]>, key = q.id): PublicQuestion {
  const base: PublicQuestion = {
    id: q.id,
    type: q.type,
    points: questionPoints(q),
    ...(q.instructions ? { instructions: q.instructions } : {}),
    ...(q.passage ? { passage: q.passage } : {}),
    ...(q.command_term ? { commandTerm: q.command_term } : {}),
  };
  switch (q.type) {
    case "single_choice":
      return { ...base, options: q.options ?? choicesFromMd?.[key], ...(q.option_texts ? { optionTexts: q.option_texts } : {}) };
    case "multi_choice":
      return {
        ...base,
        options: q.options ?? choicesFromMd?.[key],
        ...(q.option_texts ? { optionTexts: q.option_texts } : {}),
        ...(q.select_count !== undefined ? { maxSelections: q.select_count } : {}),
      };
    case "numeric":
      return { ...base, unit: q.unit };
    case "text":
      return {
        ...base,
        ...(q.unit ? { unit: q.unit } : {}),
        ...(q.word_limit !== undefined ? { wordLimit: q.word_limit } : {}),
        ...(q.numbers_allowed !== undefined ? { numbersAllowed: q.numbers_allowed } : {}),
      };
    case "fill_blank":
      return { ...base, blanks: q.blanks.map(toPublicBlank) };
    case "completion":
      return {
        ...base,
        ...(q.layout ? { layout: q.layout } : {}),
        ...(q.word_limit !== undefined ? { wordLimit: q.word_limit } : {}),
        ...(q.numbers_allowed !== undefined ? { numbersAllowed: q.numbers_allowed } : {}),
        ...(q.word_bank ? { wordBank: q.word_bank } : {}),
        ...(q.blanks ? { blanks: q.blanks.map(toPublicBlank) } : {}),
      };
    case "evidence":
      return { ...base, ...(q.allow_absence !== undefined ? { allowAbsence: q.allow_absence } : {}) };
    case "ordering":
      return { ...base, items: seededShuffle(q.items, seed + q.id) };
    case "matching":
      return {
        ...base,
        lefts: q.pairs.map((p) => p.left),
        rights: seededShuffle([...new Set([...q.pairs.map((p) => p.right), ...(q.distractors ?? [])])], seed + q.id),
        ...(q.allow_reuse !== undefined ? { allowReuse: q.allow_reuse } : {}),
        ...(q.variant ? { matchingVariant: q.variant } : {}),
      };
    case "multipart":
      return { ...base, parts: q.parts.map((p) => toPublic(p, seed, choicesFromMd, `${key}.${p.id}`)) };
    default:
      return base;
  }
}

// ---------- 數值 / 代數 ----------
let _math: MathJsInstance | null = null;
function math(): MathJsInstance {
  if (!_math) _math = create(all, { number: "number" });
  return _math;
}

const SAFE_NUMERIC = /^[\d\s.+\-*/^()eE]+$/;

/** 解析學生輸入的數值：支援 11/49、0.224、2.24e-1、2.24×10^-1、√2、π、千分位逗號。 */
export function parseNumber(raw: string, unit?: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (unit && s.toLowerCase().endsWith(unit.toLowerCase())) s = s.slice(0, -unit.length).trim();
  s = s
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    .replace(/√\s*\(?([\d.]+)\)?/g, "sqrt($1)");
  const safe = (x: string) => SAFE_NUMERIC.test(x.replace(/pi|sqrt|nthRoot|,/g, ""));
  if (unit && !safe(s)) {
    // 公式輸入的單位寫法可能不同（如 m\,s^{-1}）：有指定單位時只取開頭的數值部分
    const m = s.match(/^(?:[\d\s.+\-*/^(),]|pi|sqrt|nthRoot|[eE](?=[\d+\-]))+/);
    if (m && /^[\s]*[A-Za-zµΩ°%]/.test(s.slice(m[0].length))) s = m[0].trim();
  }
  if (s.length > 60 || !safe(s)) return null;
  try {
    const v = math().evaluate(s);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function roundSig(x: number, n: number): number {
  if (x === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const p = n - d;
  const m = 10 ** p;
  return Math.round(x * m) / m;
}

export function numericMatches(input: number, expected: number, tol?: Tolerance): boolean {
  if (tol?.abs !== undefined && Math.abs(input - expected) <= tol.abs + 1e-12) return true;
  if (tol?.rel !== undefined && Math.abs(input - expected) <= Math.abs(expected) * tol.rel + 1e-12) return true;
  if (tol?.sig_figs !== undefined) {
    const n = tol.sig_figs;
    if (roundSig(input, n) === roundSig(expected, n)) return true;
  }
  if (!tol || (tol.abs === undefined && tol.rel === undefined && tol.sig_figs === undefined))
    return Math.abs(input - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-9);
  return false;
}

function normalizeText(s: string, caseSensitive?: boolean, ignorePunct?: boolean): string {
  let t = s.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!caseSensitive) t = t.toLowerCase();
  if (ignorePunct) t = t.replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  return t;
}

/** 代數式等價：在隨機點代值比較（多點皆相等即視為等價）。 */
export function expressionEquivalent(input: string, expected: string, variables?: string[]): boolean {
  const m = math();
  const clean = (s: string) =>
    s.replace(/[×·]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi").replace(/√/g, "sqrt");
  if (input.length > 200) return false;
  try {
    const a = m.parse(clean(input));
    const b = m.parse(clean(expected));
    const symbols = new Set<string>(variables ?? []);
    for (const node of [a, b])
      node.traverse((n: { type: string; name?: string }, _p: unknown, parent: { type?: string; fn?: unknown } | null) => {
        if (n.type === "SymbolNode" && !(parent?.type === "FunctionNode" && (parent as { fn?: unknown }).fn === n) && n.name && !["pi", "e", "i"].includes(n.name))
          symbols.add(n.name);
      });
    const fa = a.compile();
    const fb = b.compile();
    let compared = 0;
    for (let t = 0; t < 24 && compared < 8; t++) {
      const scope: Record<string, number> = {};
      for (const v of symbols) scope[v] = Math.round((Math.random() * 6 - 3) * 1000) / 1000 + 0.137 * (t + 1);
      let va: unknown, vb: unknown;
      try {
        va = fa.evaluate(scope);
        vb = fb.evaluate(scope);
      } catch {
        continue;
      }
      if (typeof va !== "number" || typeof vb !== "number" || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
      compared++;
      if (Math.abs(va - vb) > 1e-7 * Math.max(1, Math.abs(va), Math.abs(vb))) return false;
    }
    return compared >= 3;
  } catch {
    return false;
  }
}

function gradeTextValue(
  raw: unknown,
  opts: { accept: string[]; case_sensitive?: boolean; ignore_punct?: boolean; regex?: string; word_limit?: number; numbers_allowed?: boolean },
): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  if (opts.word_limit !== undefined && countCompletionWords(raw, !!opts.numbers_allowed) > opts.word_limit) return false;
  if (opts.regex) {
    try {
      if (new RegExp(opts.regex, opts.case_sensitive ? "u" : "iu").test(raw.trim())) return true;
    } catch {
      /* 已在驗證時檢查 */
    }
  }
  const useCompletionNorm = !opts.case_sensitive && opts.ignore_punct !== false;
  const r = useCompletionNorm ? normalizeCompletionAnswer(raw) : normalizeText(raw, opts.case_sensitive, opts.ignore_punct);
  return opts.accept.some((a) => (useCompletionNorm ? normalizeCompletionAnswer(a) : normalizeText(a, opts.case_sensitive, opts.ignore_punct)) === r);
}

function gradeScalar(spec: ScalarSpec, raw: unknown): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  // 公式輸入框送出的是 LaTeX：數值/代數題先轉成一般算式
  const resp = spec.kind !== "text" && looksLikeLatex(raw) ? latexToPlain(raw) : raw;
  if (spec.kind === "numeric") {
    const input = parseNumber(resp, spec.unit);
    const expected = typeof spec.answer === "number" ? spec.answer : parseNumber(spec.answer);
    return input !== null && expected !== null && numericMatches(input, expected, spec.tolerance);
  }
  if (spec.kind === "text") {
    if (spec.word_limit !== undefined && countCompletionWords(resp, !!spec.numbers_allowed) > spec.word_limit) return false;
    if (spec.regex) {
      try {
        if (new RegExp(spec.regex, spec.case_sensitive ? "u" : "iu").test(resp.trim())) return true;
      } catch {
        /* 已在驗證時檢查 */
      }
    }
    const r = normalizeText(resp, spec.case_sensitive, spec.ignore_punct);
    return spec.accept.some((a) => normalizeText(a, spec.case_sensitive, spec.ignore_punct) === r);
  }
  return expressionEquivalent(resp, spec.answer, spec.variables);
}

function expectedOf(q: QuestionSpec): unknown {
  switch (q.type) {
    case "single_choice":
    case "multi_choice":
    case "true_false":
    case "tfng":
    case "ynng":
    case "numeric":
    case "expression":
      return q.answer;
    case "text":
      return q.accept[0];
    case "fill_blank":
      return Object.fromEntries(q.blanks.map((b) => [b.id, b.kind === "text" ? b.accept[0] : b.answer]));
    case "completion":
      if (q.blanks?.length) return Object.fromEntries(q.blanks.map((b) => [b.id, b.kind === "text" ? b.accept[0] : b.answer]));
      return q.accept?.[0];
    case "evidence":
      return q.absence_answer ? "ABSENCE" : q.accept_quotes[0];
    case "ordering":
      return q.items;
    case "matching":
      return Object.fromEntries(q.pairs.map((p) => [p.left, p.right]));
    default:
      return undefined;
  }
}

export function gradeQuestion(q: QuestionSpec, resp: Response): QuestionResult {
  const max = questionPoints(q);
  const r: QuestionResult = { id: q.id, score: 0, max, correct: false, expected: expectedOf(q), explanation: q.explanation };
  const full = () => {
    r.score = max;
    r.correct = true;
    return r;
  };
  switch (q.type) {
    case "single_choice":
      return typeof resp === "string" && resp.toUpperCase() === q.answer.toUpperCase() ? full() : r;
    case "true_false":
      return resp === q.answer ? full() : r;
    case "tfng":
      return normalizeTfng(resp) === normalizeTfng(q.answer) ? full() : r;
    case "ynng":
      return normalizeYnng(resp) === normalizeYnng(q.answer) ? full() : r;
    case "multi_choice": {
      const chosen = new Set((Array.isArray(resp) ? resp : []).map((x) => String(x).toUpperCase()));
      const ans = new Set(q.answer.map((x) => x.toUpperCase()));
      const exact = chosen.size === ans.size && [...ans].every((a) => chosen.has(a));
      if (exact) return full();
      const mode = q.scoring ?? "all_or_nothing";
      if (mode === "all_or_nothing" || chosen.size === 0) return r;
      const options = q.options ?? [...new Set([...ans, ...chosen])];
      if (mode === "partial") {
        // 每選對一個加分、選錯一個扣分，最低 0
        const hit = [...chosen].filter((c) => ans.has(c)).length;
        const wrong = [...chosen].filter((c) => !ans.has(c)).length;
        r.score = Math.max(0, ((hit - wrong) / ans.size) * max);
      } else {
        // per_option：每個選項判斷正確與否
        const right = options.filter((o) => ans.has(o.toUpperCase()) === chosen.has(o.toUpperCase())).length;
        r.score = (right / options.length) * max;
      }
      r.score = Math.round(r.score * 100) / 100;
      r.correct = r.score > 0 ? "partial" : false;
      return r;
    }
    case "numeric":
      return gradeScalar({ kind: "numeric", answer: q.answer, tolerance: q.tolerance, unit: q.unit }, resp) ? full() : r;
    case "text":
      return gradeScalar({ kind: "text", accept: q.accept, case_sensitive: q.case_sensitive, ignore_punct: q.ignore_punct, regex: q.regex, word_limit: q.word_limit, numbers_allowed: q.numbers_allowed }, resp) ? full() : r;
    case "expression":
      return gradeScalar({ kind: "expression", answer: q.answer, variables: q.variables }, resp) ? full() : r;
    case "fill_blank": {
      const map = (resp && typeof resp === "object" && !Array.isArray(resp) ? resp : {}) as Record<string, unknown>;
      const detail: Record<string, boolean> = {};
      for (const b of q.blanks) detail[b.id] = gradeScalar(b, map[b.id]);
      r.detail = detail;
      const ok = Object.values(detail).filter(Boolean).length;
      if (ok === q.blanks.length) return full();
      if ((q.scoring ?? "per_blank") === "per_blank" && ok > 0) {
        r.score = Math.round((ok / q.blanks.length) * max * 100) / 100;
        r.correct = "partial";
      }
      return r;
    }
    case "completion": {
      if (q.blanks?.length) {
        const map = (resp && typeof resp === "object" && !Array.isArray(resp) ? resp : {}) as Record<string, unknown>;
        const detail: Record<string, boolean> = {};
        for (const b of q.blanks) {
          const spec: ScalarSpec =
            b.kind === "text"
              ? { ...b, word_limit: b.word_limit ?? q.word_limit, numbers_allowed: b.numbers_allowed ?? q.numbers_allowed, case_sensitive: b.case_sensitive ?? q.case_sensitive, ignore_punct: b.ignore_punct ?? q.ignore_punct }
              : b;
          detail[b.id] = spec.kind === "text" ? gradeTextValue(map[b.id], spec) : gradeScalar(spec, map[b.id]);
        }
        r.detail = detail;
        const ok = Object.values(detail).filter(Boolean).length;
        if (ok === q.blanks.length) return full();
        if ((q.scoring ?? "per_blank") === "per_blank" && ok > 0) {
          r.score = Math.round((ok / q.blanks.length) * max * 100) / 100;
          r.correct = "partial";
        }
        return r;
      }
      const accept = q.accept ?? [];
      if (q.word_bank && typeof resp === "string") {
        const matchedBank = q.word_bank.find((w) => w.key.toLowerCase() === resp.trim().toLowerCase());
        const keyMatched = accept.some((a) => a.trim().toLowerCase() === resp.trim().toLowerCase());
        if (keyMatched) return full();
        if (matchedBank && gradeTextValue(matchedBank.text, { accept, case_sensitive: q.case_sensitive, ignore_punct: q.ignore_punct })) return full();
      }
      return gradeTextValue(resp, {
        accept,
        case_sensitive: q.case_sensitive,
        ignore_punct: q.ignore_punct,
        word_limit: q.word_limit,
        numbers_allowed: q.numbers_allowed,
      })
        ? full()
        : r;
    }
    case "evidence": {
      if (resp && typeof resp === "object" && !Array.isArray(resp) && "type" in resp && resp.type === "ABSENCE") {
        return q.absence_answer ? full() : r;
      }
      if (q.absence_answer) return r;
      const obj = resp && typeof resp === "object" && !Array.isArray(resp) ? (resp as { blockId?: unknown; blockLetter?: unknown; quote?: unknown }) : null;
      const quote = typeof resp === "string" ? resp : typeof obj?.quote === "string" ? obj.quote : "";
      if (!quote.trim()) return r;
      if (q.block_id && obj) {
        const bid = typeof obj.blockId === "string" ? obj.blockId.toLowerCase() : "";
        const letter = typeof obj.blockLetter === "string" ? obj.blockLetter.toLowerCase() : "";
        const wanted = q.block_id.toLowerCase();
        if (bid !== wanted && letter !== wanted && !bid.endsWith(`-${wanted}`)) return r;
      }
      return gradeTextValue(quote, { accept: q.accept_quotes, case_sensitive: q.case_sensitive, ignore_punct: q.ignore_punct }) ? full() : r;
    }
    case "ordering": {
      const order = Array.isArray(resp) ? resp.map(String) : [];
      if (order.length === q.items.length && order.every((x, i) => x === q.items[i])) return full();
      if (q.scoring === "partial" && order.length) {
        const right = q.items.filter((x, i) => order[i] === x).length;
        r.score = Math.round((right / q.items.length) * max * 100) / 100;
        r.correct = right ? "partial" : false;
      }
      return r;
    }
    case "matching": {
      const map = (resp && typeof resp === "object" && !Array.isArray(resp) ? resp : {}) as Record<string, string>;
      const detail: Record<string, boolean> = {};
      for (const p of q.pairs) detail[p.left] = map[p.left] === p.right;
      r.detail = detail;
      const ok = Object.values(detail).filter(Boolean).length;
      if (ok === q.pairs.length) return full();
      r.score = Math.round((ok / q.pairs.length) * max * 100) / 100;
      r.correct = ok ? "partial" : false;
      return r;
    }
    case "multipart": {
      const map = (resp && typeof resp === "object" && !Array.isArray(resp) ? resp : {}) as Record<string, Response>;
      r.parts = q.parts.map((p) => gradeQuestion(p, map[p.id]));
      r.score = Math.round(r.parts.reduce((s, p) => s + p.score, 0) * 100) / 100;
      const anyOpen = r.parts.some((p) => p.correct === null);
      r.correct = r.score === max ? true : anyOpen && r.parts.every((p) => p.correct === true || p.correct === null) ? null : r.score > 0 ? "partial" : false;
      return r;
    }
    case "open":
      return { ...r, correct: null, modelAnswer: q.model_answer, rubric: q.rubric };
  }
}

export function gradeExam(answers: AnswersFile, responses: Record<string, Response>, selfScores: Record<string, number> = {}, comments: Record<string, string> = {}): GradeResult {
  const questions = answers.questions.map((q) => gradeQuestion(q, responses[q.id]));
  let pending = 0;
  const applySelf = (res: QuestionResult, key: string) => {
    if (comments[key]) res.comment = comments[key];
    if (res.parts) {
      res.parts.forEach((p) => applySelf(p, `${key}.${p.id}`));
      res.score = Math.round(res.parts.reduce((s, p) => s + p.score, 0) * 100) / 100;
      return;
    }
    if (res.correct === null) {
      if (selfScores[key] !== undefined) res.score = Math.max(0, Math.min(res.max, selfScores[key]));
      else pending++;
    }
  };
  questions.forEach((q) => applySelf(q, q.id));
  return {
    score: Math.round(questions.reduce((s, q) => s + q.score, 0) * 100) / 100,
    max: questions.reduce((s, q) => s + q.max, 0),
    pendingSelfGrade: pending,
    questions,
  };
}

/** 從題目 md 產生答案 JSON 樣板（後台「產生樣板」按鈕）。 */
export function answersTemplate(md: string): AnswersFile {
  const s = analyzeExamMarkdown(md);
  return {
    schema: ANSWERS_SCHEMA,
    questions: s.questionIds.map((id): QuestionSpec => {
      if (s.parts[id]?.length)
        return { id, type: "multipart", parts: s.parts[id].map((pid) => ({ id: pid, type: "numeric", answer: 0, points: 1 })) };
      if (s.blanks[id]?.length)
        return { id, type: "fill_blank", points: s.blanks[id].length, blanks: s.blanks[id].map((b) => ({ id: b, kind: "numeric", answer: 0 })) };
      if (s.choices[id]?.length) return { id, type: "single_choice", answer: s.choices[id][0], points: 1 };
      return { id, type: "numeric", answer: 0, points: 1 };
    }),
  };
}
