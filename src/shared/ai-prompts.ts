// AI 範例 Prompt：讓 ChatGPT / Claude / Gemini 產生「本平台格式」的重點整理、模擬試題（含答案 JSON）、字卡。
// 也負責解析 AI 的回覆（取出 Markdown 與 JSON 區塊）。

export interface PromptOptions {
  subject: string;
  topic: string;
  /** 使用者貼上的教材 / 筆記（選填；有提供時要求 AI 只根據此內容） */
  source?: string;
  level?: string;
  language?: "zh" | "en" | "bilingual";
}

export interface ExamPromptOptions extends PromptOptions {
  count: number;
  minutes: number;
  difficulty: "basic" | "standard" | "challenging";
  types: (
    | "single_choice"
    | "multi_choice"
    | "true_false"
    | "tfng"
    | "ynng"
    | "numeric"
    | "fill_blank"
    | "completion"
    | "expression"
    | "text"
    | "ordering"
    | "matching"
    | "evidence"
    | "multipart"
    | "open"
  )[];
  calculators: string[];
}

export interface CardsPromptOptions extends PromptOptions {
  count: number;
  style: "vocabulary" | "term-definition" | "qa" | "formula";
}

const LANG: Record<NonNullable<PromptOptions["language"]>, string> = {
  zh: "使用繁體中文（台灣用語）撰寫，專有名詞第一次出現時附上英文。",
  en: "Write in English.",
  bilingual: "以繁體中文為主，IB 專有名詞與題目關鍵字保留英文（中英對照）。",
};

/**
 * A paper is in English unless the user asked for another language: the stems, choices, solutions and mark-scheme notes.
 * Notes and flashcards keep the Chinese-first default.
 */
export const EXAM_LANGUAGE_GUIDE = "若使用者沒有指定考卷語言，試卷（題幹、選項、解析與評分規準）一律使用英文；使用者明確指定時依其指定。";
const EXAM_LANG: Record<NonNullable<PromptOptions["language"]>, string> = {
  zh: LANG.zh,
  en: "Write the whole paper in English: stems, choices, solutions and mark-scheme notes.",
  bilingual: LANG.bilingual,
};

const SOURCE_BLOCK = (o: PromptOptions) =>
  o.source?.trim()
    ? `\n## 參考資料（只能根據以下內容，不要捏造資料以外的事實；資料不足處請標註「需查證」）\n<<<SOURCE\n${o.source.trim()}\nSOURCE>>>\n`
    : "";

const OUTPUT_RULES = `## 輸出規則（非常重要）
- 只輸出指定的區塊，區塊之外不要有任何說明文字。
- 區塊以單獨一行的分隔標記開始與結束（不要用 \`\`\` 包住整個區塊）。
- 數學一律使用 LaTeX：行內 $...$，獨立公式 $$...$$（獨立公式的 $$ 各自單獨一行）。不要用 \\( \\) 或 \\[ \\]。
- 化學式與反應式使用 mhchem：$\\ce{H2SO4}$、$\\ce{2H2 + O2 -> 2H2O}$、$\\ce{Fe^3+}$。
- 不要使用 HTML 標籤。`;

export function buildNotePrompt(o: PromptOptions): string {
  return `你是經驗豐富的 ${o.level ?? "IB DP / MYP"} ${o.subject} 老師。請為主題「${o.topic}」撰寫一份考前「重點整理」，格式必須完全符合以下 Markdown 規格（會直接匯入學習平台）。
${LANG[o.language ?? "zh"]}
${SOURCE_BLOCK(o)}
## 內容要求
1. 依觀念分段，每段包含：核心重點、常見陷阱、考點方向，必要時附一題「難題範例」與完整解析。
2. 公式完整寫出並說明各符號意義；計算題的解析要列出步驟。
3. 用表格整理容易混淆的概念（例如比較、分類）。
4. 結尾附「快速自我檢查」清單（5–8 點）。

## 格式規格
- 第一行為一級標題：# 標題
- 章節用 ## 與 ###。
- 重點提示框（三個冒號開頭與結尾，方括號內為框的標題）：
:::key[核心重點]
內容（可含清單、公式）
:::
- 其他可用的提示框：:::warning[易錯陷阱]、:::example[難題範例]、:::exam[考點方向]、:::note[補充]、:::tip[小技巧]
- 可折疊的解析：
:::solution
解析內容
:::
- 提示框內不要再放提示框；若需要巢狀，外層要用 4 個冒號（::::），內層 3 個。
- 表格使用 GitHub Markdown 表格語法。

${OUTPUT_RULES}

## 輸出格式
===MARKDOWN===
（完整的重點整理 Markdown）
===END MARKDOWN===`;
}

const TYPE_DESC: Record<ExamPromptOptions["types"][number], string> = {
  single_choice: "單選題（4 個選項，亦可用羅馬數字 (i)(ii) 做標題配對或含 {gap} 的詞庫摘要）",
  multi_choice: "複選題（可設定 select_count 限制選取數）",
  true_false: "是非題（正確/錯誤）",
  tfng: "閱讀判斷題 True / False / Not Given",
  ynng: "作者觀點判斷題 Yes / No / Not Given",
  numeric: "數值計算題（答案為一個數值）",
  fill_blank: "填空題（題幹內 1–3 個 :blank{#id} 空格）",
  completion: "結構填空題（支援表格 table、流程圖 flowchart、圖表標註 diagram、筆記 notes、字數限制 word_limit 與詞庫 word_bank）",
  expression: "代數式題（答案為化簡後的式子，系統會判斷等價）",
  text: "簡答題（答案為短詞，例如名詞、化學名稱，支援 word_limit）",
  ordering: "排序題（排列正確步驟或順序）",
  matching: "配對題（支援一對一或 allow_reuse 多對一配對）",
  evidence: "原文舉證題（由學生在閱讀文章中選取能證明答案的原文句子）",
  multipart: "大題含 (a)(b)(c) 小題（共用題幹固定於左側材料欄）",
  open: "申論/證明題（支援打字與 Apple Pencil 手寫作答，提供參考答案與評分規準）",
};

export function buildExamPrompt(o: ExamPromptOptions): string {
  const difficulty = { basic: "基礎（課本例題程度）", standard: "標準（校內段考程度）", challenging: "進階（IB 考試 Paper 2 程度，含綜合應用）" }[o.difficulty];
  return `你是經驗豐富的 ${o.level ?? "IB DP / MYP"} ${o.subject} 命題老師。請針對「${o.topic}」出一份模擬試卷，共 ${o.count} 題，難度：${difficulty}，作答時間 ${o.minutes} 分鐘。
題型請混合使用：${o.types.map((t) => TYPE_DESC[t]).join("、")}。
${EXAM_LANG[o.language ?? "en"]}
${SOURCE_BLOCK(o)}
你需要輸出兩個部分：①題目 Markdown（不含答案）②答案 JSON。兩者的題號 id 必須完全一致。

## ① 題目 Markdown 規格
開頭是 frontmatter：
---
title: 試卷名稱
time_limit_min: ${o.minutes}
calculators: [${o.calculators.join(", ")}]
---

每一題用「4 個冒號」包住，id 依序為 q1、q2、q3…：
::::question{#q1}
題幹（可含 LaTeX）
::::

選擇題的選項放在題目內、用「3 個冒號」的 choices 區塊，每個選項以 (A) (B) (C) (D) 開頭：
::::question{#q1}
題幹
:::choices
- (A) 選項一
- (B) 選項二
- (C) 選項三
- (D) 選項四
:::
::::

填空題在題幹中用 :blank{#a}、:blank{#b} 標示空格（id 為小寫英文字母）：
::::question{#q2}
若 $x^2-5x+6=0$，則較小的根為 :blank{#a}，較大的根為 :blank{#b}。
::::

含小題的大題，小題用「3 個冒號」的 part 區塊，id 為 a、b、c：
::::question{#q3}
共同題幹
:::part{#a}
(a) 小題內容
:::
:::part{#b}
(b) 小題內容 :blank{#x}
:::
::::

閱讀理解／資料題可在題目前用「4 個冒號」的 passage 區塊放置閱讀文章（系統會於作答畫面左側分欄顯示，並自動標註 A、B、C 段落）：
::::passage{#p1 title="Passage Title"}
Paragraph A text...

Paragraph B text...
::::
關聯該文章的題目可用 \`::::question{#q4 passage="p1"}\` 連結（同區段內的題目亦會自動關聯最近的文章或 :::stimulus 資料）。

每題的詳細解析放在該題之後（題目區塊外面），用 solution 並指定題號：
:::solution{for=q1}
解析步驟
:::

可用 ## 標題分 Section（例如 Section A 選擇題、Section B 計算題）。題目中不得出現答案。

## ② 答案 JSON 規格
{
  "schema": "exam-answers/v1",
  "questions": [ ...每題一個物件，順序與題目相同... ]
}
每個題目物件都有 "id"、"type"、"points"（配分），可加 "explanation"（簡短解析，Markdown，可含 LaTeX；JSON 內反斜線要寫成 \\\\）、"instructions"（作答提示）、"passage"（關聯文章 id）。各題型欄位：
- 單選：{ "id": "q1", "type": "single_choice", "answer": "B", "points": 2 }（:::choices 亦支援 (i)(ii)(iii) 羅馬數字或摘要題幹含 {gap}）
- 複選：{ "id": "q2", "type": "multi_choice", "answer": ["A", "C"], "select_count": 2, "scoring": "partial", "points": 3 }
- 是非：{ "id": "q3", "type": "true_false", "answer": true, "points": 1 }
- T/F/NG：{ "id": "q4", "type": "tfng", "answer": "NOT_GIVEN", "passage": "p1", "points": 1 }（answer 為 "TRUE" / "FALSE" / "NOT_GIVEN"）
- Y/N/NG：{ "id": "q5", "type": "ynng", "answer": "YES", "passage": "p1", "points": 1 }（answer 為 "YES" / "NO" / "NOT_GIVEN"）
- 數值：{ "id": "q6", "type": "numeric", "answer": "11/49", "tolerance": { "sig_figs": 3 }, "unit": "cm", "points": 2 }
  （answer 可為數字或分數字串；tolerance 可用 {"abs": 0.01}、{"rel": 0.01} 或 {"sig_figs": 3}；unit 選填）
- 代數式：{ "id": "q7", "type": "expression", "answer": "2x+3", "points": 2 }（用 * ^ sqrt() 等可被計算的寫法）
- 簡答：{ "id": "q8", "type": "text", "accept": ["sodium chloride", "NaCl"], "ignore_punct": true, "word_limit": 3, "numbers_allowed": true, "points": 1 }
- 填空：{ "id": "q9", "type": "fill_blank", "points": 2, "blanks": [ { "id": "a", "kind": "numeric", "answer": 2 }, { "id": "b", "kind": "text", "accept": ["oxidation"] } ] }
  （每個空格的 kind 為 numeric / text / expression，欄位同上；空格 id 必須與題目中的 :blank{#…} 相同）
- 結構填空：{ "id": "q10", "type": "completion", "word_limit": 2, "numbers_allowed": true, "layout": { "kind": "flowchart", "title": "Process", "steps": ["Step 1", "Step 2: {gap}"] }, "accept": ["evaporation"], "points": 1 }
  （layout.kind 可為 "text" / "notes"（lines 陣列）、"table"（columns + rows）、"flowchart"（steps 陣列）、"diagram"（title + labels 陣列，選填 description/image）；空格用 {gap}，或搭配 blanks 陣列與 {gap:a} / :blank{#a} 做多格填寫；亦可加 word_bank: [{ "key": "A", "text": "…" }] 做詞庫填空）
- 原文舉證：{ "id": "q11", "type": "evidence", "passage": "p1", "accept_quotes": ["exact quote from passage"], "block_id": "B", "allow_absence": false, "points": 1 }
- 排序：{ "id": "q12", "type": "ordering", "items": ["Step 1", "Step 2", "Step 3"], "scoring": "partial", "points": 2 }
- 配對：{ "id": "q13", "type": "matching", "pairs": [{ "left": "Item 1", "right": "Match A" }], "distractors": ["Extra B"], "allow_reuse": false, "points": 2 }
- 大題：{ "id": "q14", "type": "multipart", "parts": [ { "id": "a", "type": "numeric", "answer": 5, "points": 2 }, { "id": "b", "type": "fill_blank", "blanks": [ { "id": "x", "kind": "expression", "answer": "x^2-1" } ], "points": 2 } ] }
- 申論：{ "id": "q15", "type": "open", "points": 4, "model_answer": "參考答案（Markdown）", "rubric": "評分規準：…各得幾分" }

## 自我檢查（輸出前請確認）
- 題目 Markdown 的每個 ::::question{#…} 在 JSON 中都有一個相同 id 的物件，反之亦然。
- 選擇題答案的字母一定存在於該題的選項中。
- 數值答案已重新計算驗證過。
- JSON 為合法 JSON（雙引號、無註解、無結尾逗號）。

${OUTPUT_RULES}

## 輸出格式（兩個區塊，依此順序）
===MARKDOWN===
（題目 Markdown）
===END MARKDOWN===
===JSON===
（答案 JSON）
===END JSON===`;
}

export function buildCardsPrompt(o: CardsPromptOptions): string {
  const style = {
    "term-definition": "正面為專有名詞（英文），背面為中文名稱 + 一句定義",
    vocabulary: "英→中詞彙卡：先評估本章重要詞彙，每個詞一張，正面只放英文詞彙，背面第一行中文名稱、之後一句中文定義；不要做中→英反向卡（複習時可對調正反面）",
    qa: "正面為一個觀念問題，背面為精簡答案（1–3 句）",
    formula: "正面為公式名稱或情境，背面為公式（LaTeX）與各符號意義",
  }[o.style];
  return `你是 ${o.level ?? "IB DP / MYP"} ${o.subject} 老師。請針對「${o.topic}」製作 ${o.count} 張學習字卡。風格：${style}。
${LANG[o.language ?? "zh"]}
${SOURCE_BLOCK(o)}
## 格式規格
每張卡片用以下格式，卡片之間用單獨一行的 --- 分隔；正面與背面之間用單獨一行的 === 分隔：
正面內容
===
背面內容
---
下一張正面
===
下一張背面

正反面都可以使用 Markdown（**粗體**、清單）與 LaTeX（$...$）。

${OUTPUT_RULES}

## 輸出格式
===CARDS===
（所有卡片）
===END CARDS===`;
}

export interface AiOutput {
  markdown: string | null;
  json: unknown | null;
  jsonError: string | null;
  cards: string | null;
}

function between(text: string, start: string, end: string): string | null {
  const re = new RegExp(`^\\s*${start}\\s*$([\\s\\S]*?)^\\s*${end}\\s*$`, "m");
  const m = text.match(re);
  return m ? m[1].replace(/^\n+|\n+$/g, "") : null;
}

/** 某些 AI 會把整段再包進 ``` 圍欄：去掉最外層圍欄 */
function unfence(s: string): string {
  const m = s.match(/^\s*(`{3,}|~{3,})[\w-]*\n([\s\S]*?)\n\1\s*$/);
  return m ? m[2] : s;
}

/** 解析 AI 回覆：優先使用 ===MARKDOWN=== 等分隔標記；沒有則退而使用 ```markdown / ```json 圍欄 */
export function parseAiOutput(text: string): AiOutput {
  const t = text.replace(/\r\n/g, "\n");
  let markdown = between(t, "===MARKDOWN===", "===END MARKDOWN===");
  let jsonText = between(t, "===JSON===", "===END JSON===");
  const cards = between(t, "===CARDS===", "===END CARDS===");
  if (markdown === null) {
    const m = t.match(/```(?:markdown|md)\n([\s\S]*?)\n```(?!\w)/);
    if (m) markdown = m[1];
  }
  if (jsonText === null) {
    const m = t.match(/```json\n([\s\S]*?)\n```/);
    if (m) jsonText = m[1];
  }
  let json: unknown = null;
  let jsonError: string | null = null;
  if (jsonText !== null) {
    try {
      json = JSON.parse(unfence(jsonText));
    } catch (e) {
      jsonError = `答案 JSON 無法解析：${(e as Error).message}`;
    }
  }
  return { markdown: markdown === null ? null : unfence(markdown).trim() + "\n", json, jsonError, cards: cards === null ? null : unfence(cards) };
}
