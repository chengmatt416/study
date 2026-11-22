// NotebookLM（Gemini Notebook）字卡分享連結解析。
// 非官方介面：Google 改版時只需修改本檔（以及 tests/notebooklm.test.ts 的 fixture）。
//
// 流程：
//   1. https://notebooklm.link.google/<code>  --301-->  https://notebook.google.com/notebook/<nb>/artifact/<artifactId>
//   2. POST https://notebook.google.com/_/LabsTailwindUi/data/batchexecute  rpcids=v9rmvd  f.req=[[["v9rmvd","[\"<artifactId>\",...]",null,"generic"]]]
//      未登入即可呼叫；回應為 batchexecute 格式，內含字卡播放器 HTML
//   3. HTML 中 <app-root data-app-data="{...flashcards...}"> 即為卡片 JSON（內容為 Markdown）

export const NOTEBOOKLM_HOSTS = ["notebooklm.link.google", "notebook.google.com", "notebooklm.google.com"];

export const BATCHEXECUTE_URL = "https://notebook.google.com/_/LabsTailwindUi/data/batchexecute";
export const FLASHCARD_RPC_ID = "v9rmvd";

export interface ParsedCard {
  front: string;
  back: string;
}

export interface ParsedDeck {
  artifactId: string;
  title: string;
  cards: ParsedCard[];
  topics?: { covered?: string[]; followUp?: string[] };
}

export class NotebookLMError extends Error {
  constructor(
    message: string,
    readonly code: "bad_url" | "not_found" | "format_changed" | "network",
  ) {
    super(message);
  }
}

export function isNotebookLMUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && NOTEBOOKLM_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/** 從完整網址取出 artifact id；短網址需先追蹤 redirect。 */
export function extractArtifactId(raw: string): string | null {
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/\/artifact\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function buildFlashcardRequestBody(artifactId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(artifactId)) throw new NotebookLMError("artifact id 格式錯誤", "bad_url");
  const args = JSON.stringify([
    artifactId,
    [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]], [[1, 4, 8, 10, 14]]],
  ]);
  const freq = JSON.stringify([[[FLASHCARD_RPC_ID, args, null, "generic"]]]);
  return new URLSearchParams({ "f.req": freq }).toString();
}

const HTML_ENTITIES: Record<string, string> = { "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&amp;": "&" };

function decodeAttr(s: string): string {
  return s.replace(/&(quot|#39|lt|gt|amp);/g, (m) => HTML_ENTITIES[m]);
}

interface ContentBlock {
  type: string;
  content?: string;
}

function blocksToMarkdown(side: { flashcardContentBlock?: ContentBlock[] } | undefined): string {
  const blocks = side?.flashcardContentBlock ?? [];
  return blocks
    .map((b) => {
      if (b.type === "text") return b.content ?? "";
      // 未知區塊型別：保留文字內容，避免資料遺失
      return b.content ?? "";
    })
    .join("\n\n")
    .trim();
}

/** 解析 batchexecute 回應文字。 */
export function parseFlashcardResponse(body: string): ParsedDeck {
  const start = body.indexOf(`[["wrb.fr","${FLASHCARD_RPC_ID}"`);
  if (start < 0) throw new NotebookLMError("回應中找不到字卡資料（可能已改版或連結無效）", "format_changed");
  const end = body.indexOf("\n", start);
  let inner: unknown;
  try {
    const outer = JSON.parse(body.slice(start, end < 0 ? undefined : end));
    const payload = outer?.[0]?.[2];
    if (typeof payload !== "string") throw new Error("empty payload");
    inner = JSON.parse(payload);
  } catch {
    throw new NotebookLMError("字卡資料無法解析（或連結未公開分享）", "not_found");
  }
  const artifact = (inner as unknown[][])?.[0];
  if (!Array.isArray(artifact)) throw new NotebookLMError("字卡資料結構不符", "format_changed");
  const artifactId = String(artifact[0] ?? "");
  const title = String(artifact[1] ?? "字卡");
  const html = (artifact[9] as unknown[] | undefined)?.[0];
  if (typeof html !== "string") throw new NotebookLMError("此連結不是字卡（flashcards）", "format_changed");
  const m = html.match(/data-app-data="([^"]*)"/);
  if (!m) throw new NotebookLMError("字卡播放器中找不到 data-app-data", "format_changed");
  let data: { flashcards?: unknown[]; topics?: ParsedDeck["topics"] };
  try {
    data = JSON.parse(decodeAttr(m[1]));
  } catch {
    throw new NotebookLMError("data-app-data 不是合法 JSON", "format_changed");
  }
  if (!Array.isArray(data.flashcards)) throw new NotebookLMError("沒有 flashcards 陣列", "format_changed");
  const cards = data.flashcards
    .map((c) => {
      const card = c as { f?: { flashcardContentBlock?: ContentBlock[] }; b?: { flashcardContentBlock?: ContentBlock[] } };
      return { front: blocksToMarkdown(card.f), back: blocksToMarkdown(card.b) };
    })
    .filter((c) => c.front || c.back);
  return { artifactId, title, cards, topics: data.topics };
}

/** 在 Worker 中呼叫：追蹤短網址並取回字卡。 */
export async function fetchNotebookLMDeck(url: string, fetcher: typeof fetch = fetch): Promise<ParsedDeck> {
  if (!isNotebookLMUrl(url)) throw new NotebookLMError("只接受 notebooklm.link.google / notebook.google.com 連結", "bad_url");
  let current = url;
  let artifactId = extractArtifactId(current);
  for (let hop = 0; !artifactId && hop < 5; hop++) {
    const res = await fetcher(current, { redirect: "manual" });
    const loc = res.headers.get("location");
    if (!loc) throw new NotebookLMError("短網址無法解析", "not_found");
    current = new URL(loc, current).toString();
    if (!isNotebookLMUrl(current)) throw new NotebookLMError("連結導向非 NotebookLM 網域", "bad_url");
    artifactId = extractArtifactId(current);
  }
  if (!artifactId) throw new NotebookLMError("找不到 artifact id", "bad_url");
  const res = await fetcher(`${BATCHEXECUTE_URL}?rpcids=${FLASHCARD_RPC_ID}&hl=zh-TW&rt=c`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
      origin: "https://notebook.google.com",
      referer: "https://notebook.google.com/",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
    },
    body: buildFlashcardRequestBody(artifactId),
  });
  if (!res.ok) throw new NotebookLMError(`Google 回應 ${res.status}`, "network");
  return parseFlashcardResponse(await res.text());
}

/** 解析手動貼上的文字：每行「正面<TAB>背面」或「正面 :: 背面」；空行分隔多行卡片時用 `---`。 */
export function parsePastedCards(text: string): ParsedCard[] {
  const out: ParsedCard[] = [];
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return out;
  if (/^\s*---\s*$/m.test(trimmed)) {
    // 區塊格式：正面 / === / 背面，以 --- 分隔卡片
    for (const chunk of trimmed.split(/^\s*---\s*$/m)) {
      const [front, ...rest] = chunk.split(/^\s*===\s*$/m);
      if (front?.trim()) out.push({ front: front.trim(), back: rest.join("\n").trim() });
    }
    return out;
  }
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    const sep = line.includes("\t") ? "\t" : line.includes("::") ? "::" : null;
    if (!sep) continue;
    const idx = line.indexOf(sep);
    const front = line.slice(0, idx).trim();
    const back = line.slice(idx + sep.length).trim();
    if (front) out.push({ front, back });
  }
  return out;
}

/** RFC 4180 CSV（支援引號、跨行欄位）。第一欄正面、第二欄背面；若首列為 front,back 標題則略過。 */
export function parseCsvCards(text: string): ParsedCard[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length && /^front$/i.test(rows[0][0]?.trim() ?? "") && /^back$/i.test(rows[0][1]?.trim() ?? "")) rows.shift();
  return rows
    .filter((r) => r[0]?.trim())
    .map((r) => ({ front: r[0].trim(), back: (r[1] ?? "").trim() }));
}
