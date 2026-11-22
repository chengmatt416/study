// STUDY's own rules applied to one model turn before it is accepted, so a wrong outline, a slide with a question, a quiz
// the router cannot read or a module nobody can operate costs one more turn instead of a whole course part.
import { checkOutlineAgainstBlueprint, type CourseBlueprint, type SceneSummary } from './course-blueprint';
import { difficultyOf, parseTitle } from './course-map';
import { questionReasons, slideTexts } from './slide-questions';

export interface DraftProblems { errors: string[]; warnings: string[] }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const tryJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

/** The first complete JSON object or array inside prose, by bracket matching outside strings. */
function firstStructure(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) { if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') inString = true;
    else if (char === '[' || char === '{') depth++;
    else if ((char === ']' || char === '}') && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/**
 * Reads a draft the way the official parsers find it: exact JSON, after a closing reasoning tag, in a fenced block anywhere,
 * or as the first JSON structure inside prose. A draft the official parser would accept must never skip these checks
 * because it was wrapped differently. Null when no JSON can be read (the official parser may still repair it; callers decide).
 */
export function parseDraft(text: string): unknown {
  const trimmed = text.trim();
  const exact = tryJson(trimmed);
  if (exact !== undefined) return exact;
  const closing = [...trimmed.matchAll(/<\/(?:think|thinking|reasoning)>\s*/gi)].at(-1);
  const body = closing?.index === undefined ? trimmed : trimmed.slice(closing.index + closing[0].length).trim();
  for (const match of body.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const inner = match[1].trim();
    if (!/^[[{]/.test(inner)) continue;
    const parsed = tryJson(inner);
    if (parsed !== undefined) return parsed;
  }
  const structure = firstStructure(body);
  const parsed = structure === null ? undefined : tryJson(structure);
  return parsed === undefined ? null : parsed;
}

export function outlineScenes(draft: unknown): SceneSummary[] | null {
  const list = Array.isArray(draft) ? draft : object(draft)?.outlines;
  if (!Array.isArray(list) || !list.length) return null;
  const scenes = list.map(object);
  return scenes.every(scene => scene && typeof scene.title === 'string' && typeof scene.type === 'string') ? scenes as SceneSummary[] : null;
}

export const slideElements = (draft: unknown): unknown[] | null => { const elements = object(draft)?.elements; return Array.isArray(elements) ? elements : null; };

/** An outline must match its blueprint and every planned page must be reachable. */
/** Structure only. Whether a planned slide is really an exercise is judged by the content judge (worker). */
export function outlineDraftProblems(blueprint: CourseBlueprint, scenes: SceneSummary[]): DraftProblems {
  return checkOutlineAgainstBlueprint(blueprint, scenes);
}

/** The text a learner would read on a drafted slide, for the content judge. */
export const slideDraftText = (elements: unknown[]): string => slideTexts({ content: { canvas: { elements: elements as never } } }).join('\n');

// ---- which scene a model turn is for ----
export type TurnKind = 'slide' | 'module' | 'quiz' | 'other';
export interface TurnScene { title: string; kind: TurnKind }

/** The user message of the official request (AI SDK prompt: a string, or text parts). */
export function requestUserText(request: unknown): string {
  const prompt = object(request)?.prompt;
  if (!Array.isArray(prompt)) return '';
  return prompt.flatMap<string>(message => {
    const item = object(message);
    if (item?.role !== 'user') return [];
    if (typeof item.content === 'string') return [item.content];
    return Array.isArray(item.content) ? item.content.flatMap(part => typeof object(part)?.text === 'string' ? [object(part)!.text as string] : []) : [];
  }).join('\n');
}

/** The official scene prompts open with "Title: …"; an actions prompt also names what it narrates (a widget, or slide elements). */
export function turnScene(userText: string): TurnScene | null {
  const title = /^Title:[ \t]*(.+)$/m.exec(userText)?.[1].trim();
  if (!title) return null;
  const kind: TurnKind = /^Widget Type:/m.test(userText) ? 'module' : /^Elements:/m.test(userText) ? 'slide' : /^Question Count:/m.test(userText) ? 'quiz' : 'other';
  return { title, kind };
}

// ---- quiz drafts (先測／檢核 and in-lesson quizzes) ----
const SELF_MADE_UNSURE = /^(?:我不會|我不知道|不知道|不確定|i\s*don'?t\s*know|not\s*sure)\s*[。.!！]?$/i;
const letters = (value: unknown): string[] | null => Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : typeof value === 'string' ? [value] : null;

/**
 * A drafted quiz against the rules the router and the learner depend on. Format slips the official parser repairs
 * (string options, a bare answer letter) are left to it; what is checked here is what would otherwise reach a learner:
 * a question without a usable answer or explanation, and a 先測／檢核 the router cannot read.
 */
export function quizDraftProblems(title: string, draft: unknown): DraftProblems {
  const errors: string[] = [], warnings: string[] = [];
  const role = parseTitle(title).role;
  const name = role === 'pretest' ? '先測' : role === 'checkpoint' ? '檢核' : '測驗';
  if (!Array.isArray(draft) || !draft.length) return { errors: [`「${title}」沒有題目：輸出題目的 JSON 陣列`], warnings };
  const seen = new Set<string>(); const levels = { 1: 0, 2: 0, 3: 0 };
  draft.forEach((raw, index) => {
    const question = object(raw); const at = `第 ${index + 1} 題`;
    if (!question) return void errors.push(`${at}不是物件`);
    const id = typeof question.id === 'string' ? question.id.trim() : '';
    const where = id ? `${at}（${id}）` : at;
    if (!id) errors.push(`${at}沒有 id`);
    else if (seen.has(id)) errors.push(`${where}的 id 重複：同一個測驗的題目 id 不可重複`);
    seen.add(id);
    if (typeof question.question !== 'string' || !question.question.trim()) errors.push(`${where}沒有題幹`);
    else if ([...question.question.trim()].length > 160) warnings.push(`${where}題幹超過 160 字：手機上要捲動才讀得完，長推導放進 analysis`);
    if (typeof question.analysis !== 'string' || [...question.analysis.trim()].length < 10) errors.push(`${where}沒有解析（analysis）：寫出為什麼正確，以及每個錯誤選項錯在哪`);
    if (id.includes('__m_') && !/__m_[a-z0-9][a-z0-9.-]{0,63}$/.test(id)) errors.push(`${where}的迷思標記不合規則：__m_ 後面只用英文小寫、數字與連字號，並放在 id 最後`);
    const level = id ? difficultyOf(id) : null;
    if (level) levels[level]++;
    else if (id && role !== 'content') errors.push(`${where}沒有難度標記：${name}的題目 id 在 __m_ 之前加 __d1（基礎）、__d2（核心）或 __d3（難題），例如 q4__d3__m_forgot-sign`);
    if (question.type === 'short_answer' || question.type === 'text') {
      if (role !== 'content') warnings.push(`${where}是簡答題：${name}靠自動批改判斷程度，簡答題要等人工或 AI 覆核，建議改成單選或複選`);
      return;
    }
    const options = Array.isArray(question.options) ? question.options : [];
    if (options.length < 2) return void errors.push(`${where}的選項少於 2 個`);
    const labels = options.map(option => typeof option === 'string' ? option : String(object(option)?.label ?? '')).map(label => label.trim());
    if (labels.some(label => SELF_MADE_UNSURE.test(label))) errors.push(`${where}自己加了「我不會」選項：系統會自動加上，請刪除`);
    if (new Set(labels).size !== labels.length) errors.push(`${where}有重複的選項`);
    if (labels.some(label => [...label].length > 60)) warnings.push(`${where}有超過 60 字的選項：手機上難以比較，縮短或把推導放進 analysis`);
    const answer = letters(question.answer);
    if (!answer?.length) return void errors.push(`${where}沒有正解（answer）`);
    const values = options.map(option => object(option)?.value);
    if (values.every(value => typeof value === 'string')) {
      const missing = answer.filter(item => !values.includes(item));
      if (missing.length) errors.push(`${where}的正解 ${missing.join('、')} 不是任何選項的 value`);
    }
    if (question.type === 'single' && answer.length !== 1) errors.push(`${where}是單選題，answer 只能有一個`);
    if (question.type === 'multiple' && answer.length < 2) errors.push(`${where}是複選題，answer 至少兩個；只有一個正解就改成 single`);
  });
  const count = draft.length;
  if (role === 'pretest') {
    if (count < 5 || count > 6) errors.push(`「${title}」有 ${count} 題：先測每章 5 到 6 題（基礎 1 到 2、核心 2、難題 2）`);
    if (!levels[1]) errors.push(`「${title}」沒有基礎題（__d1）：系統無法分辨學生是不是缺先備知識`);
    if (levels[2] < 2) errors.push(`「${title}」核心題（__d2）要 2 題，現在 ${levels[2]} 題`);
    if (levels[3] < 2) errors.push(`「${title}」難題（__d3）要 2 題，現在 ${levels[3]} 題：沒有難題，全對也無法證明熟練，學生會被誤判成可以跳過正課`);
  } else if (role === 'checkpoint') {
    if (count < 3 || count > 5) errors.push(`「${title}」有 ${count} 題：檢核每章 3 到 5 題`);
    if (!levels[3]) errors.push(`「${title}」沒有遷移難題（__d3）：檢核至少一題`);
  }
  return { errors, warnings };
}

// ---- interactive module drafts ----
const CONTROL = /<(sk-[a-z-]+|input|button|select|textarea|canvas)\b[^>]*>/gi;
/** Kit elements that only lay out, explain or report: a page made of these alone gives the learner nothing to operate. */
const PASSIVE = /^<sk-(?:module|split|stack|controls|tabs?|steps?|hints?|explain|observe|wrong|col|reveal|callout|progress|readout|figure|plot|text|option|pair|bucket|card|term|blank|item|tr|point|flash|hit|miss)\b/i;
const ANSWERABLE = /<sk-(?:choice|numeric|order|match|sort|label|pick|fill|balance|tune|graph|table|mark|reflect)\b/i;
export const moduleControls = (html: string): string[] => [...html.matchAll(CONTROL)].map(match => match[0].slice(0, 120));
/** True when the page has something a learner operates: a lab, a question, a control or a record table. */
export const hasOperableControl = (controls: readonly string[]): boolean => controls.some(control => !PASSIVE.test(control));
const closingScene = (title: string) => /^課後\s*[：:]/.test(title.trim());

/** A drafted interactive page: built from the kit, operable, and able to use a phone's real width. */
export function moduleDraftProblems(title: string, text: string): DraftProblems {
  const errors: string[] = [], warnings: string[] = [];
  if (closingScene(title) || !/<html[\s>]|<!doctype/i.test(text)) return { errors, warnings };
  const html = text.replace(/<!--[\s\S]*?-->/g, '');
  const markup = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  if (!/<sk-[a-z]/.test(markup)) return { errors: [`互動模組「${title}」沒有使用 <sk-*> 元件庫：先讀 get_module_kit，用 sk-module、sk-lab、sk-choice 等元件組裝，不要自己寫控制項與樣式（沒有元件庫，課堂讀不到學生的作答與迷思）`], warnings };
  if (!hasOperableControl(moduleControls(markup))) errors.push(`互動模組「${title}」沒有讓學生操作的元件，只是說明頁：加入器材（sk-lab）、題型（sk-choice、sk-numeric、sk-order…）或紀錄表，純說明請放回投影片`);
  if (!/<meta\b[^>]*\bname\s*=\s*['"]viewport['"]/i.test(html)) errors.push(`互動模組「${title}」缺少 <meta name="viewport" content="width=device-width,initial-scale=1">：沒有它，手機會把模組縮成很小的固定畫布`);
  if (!ANSWERABLE.test(markup)) warnings.push(`互動模組「${title}」沒有即時檢核：至少放一個 sk-choice 或 sk-numeric 並附 sk-explain`);
  // After two misses the kit offers the answer with the question's explanation; a question without one leaves the learner with a bare answer.
  const unexplained = [...markup.matchAll(/<sk-(choice|numeric|order|match|sort|label|pick|fill|balance|tune|graph|table|mark)\b[\s\S]*?<\/sk-\1\s*>/gi)].filter(match => !/<sk-explain\b/i.test(match[0])).length;
  if (unexplained) warnings.push(`互動模組「${title}」有 ${unexplained} 題沒有 <sk-explain>：學生答錯兩次會按「看解答」，沒有解析就只看到答案，學不到為什麼`);
  for (const choice of markup.matchAll(/<sk-choice\b[\s\S]*?<\/sk-choice\s*>/gi)) {
    const wrong = [...choice[0].matchAll(/<sk-option\b[^>]*>/gi)].map(match => match[0]).filter(tag => !/\scorrect(?:[\s=>]|$)/i.test(tag));
    if (wrong.some(tag => !/\smisconception\s*=/i.test(tag))) { warnings.push(`互動模組「${title}」有錯誤選項沒有標 misconception：每個錯誤選項寫 misconception="迷思id" 與 feedback，課堂路由才知道學生錯在哪`); break; }
  }
  return { errors, warnings };
}

// ---- narration (actions) drafts ----
export const POINTING_ACTIONS = ['spotlight', 'laser', 'widget_highlight', 'highlight', 'widget_operate', 'operate'] as const;
const MAX_SPEECH_CHARS = 80;
/** Speech lines and action names of an actions draft (an empty array is a scene nobody narrates), or null when the draft is not an actions array. */
export function narrationOf(draft: unknown): { speech: string[]; actions: string[] } | null {
  if (!Array.isArray(draft)) return null;
  const items = draft.map(object);
  if (!items.every(item => item && (item.type === 'text' || item.type === 'action'))) return null;
  return {
    speech: items.flatMap(item => item!.type === 'text' && typeof item!.content === 'string' && item!.content.trim() ? [item!.content.trim()] : []),
    actions: items.flatMap(item => item!.type === 'action' ? [String(item!.name ?? item!.tool_name ?? '')] : []),
  };
}

/** The narration of a scene: a module must be walked through by the dialogue, and every line must fit a phone. */
export function narrationDraftProblems(scene: TurnScene, narration: { speech: string[]; actions: string[] }): DraftProblems {
  const errors: string[] = [], warnings: string[] = [];
  if (scene.kind === 'module' && !closingScene(scene.title)) {
    if (!narration.speech.length) errors.push(`互動模組「${scene.title}」沒有對話導覽：用 speech 一步步帶學生操作，不可讓學生自行摸索`);
    else if (!narration.actions.some(name => (POINTING_ACTIONS as readonly string[]).includes(name))) errors.push(`互動模組「${scene.title}」的對話沒有指出操作目標：輪到學生動手的句子之前，先放 widget_highlight（target 用 CSS selector）指出要操作的器材或控制項`);
  }
  if (scene.kind === 'slide') {
    if (!narration.speech.length) errors.push(`投影片「${scene.title}」沒有教師講述：每張投影片要有 speech 逐步講解`);
    // The teacher must not hand the slide to the learner either; the publish check reads the same lines.
    const asks = questionReasons(narration.speech);
    if (asks.length) errors.push(`投影片「${scene.title}」的教師講述要學生作答（${asks.join('、')}）：講述改成陳述句或直接講出答案，題目放到先測、檢核或互動模組`);
  }
  const long = narration.speech.filter(line => [...line].length > MAX_SPEECH_CHARS).length;
  if (long) warnings.push(`「${scene.title}」有 ${long} 句講述超過 ${MAX_SPEECH_CHARS} 字：手機上學生逐句點擊閱讀，一句只講一個小步驟，請拆短`);
  return { errors, warnings };
}
