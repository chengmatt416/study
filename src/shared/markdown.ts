// 共用 Markdown 管線（前端渲染、伺服器端處理試題都用這份）。
// md → mdast（GFM、數學、directive）→ 自訂轉換 → hast → sanitize → KaTeX（含 mhchem）→ HTML
import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import "katex/contrib/mhchem";
import type { Root as MdRoot, Parent as MdParent, RootContent } from "mdast";
import type { Root as HastRoot, Element } from "hast";

export type RenderMode = "note" | "exam" | "exam-review";

export interface RenderOptions {
  mode?: RenderMode;
}

const CALLOUTS: Record<string, string> = {
  tip: "重點",
  key: "核心重點",
  note: "補充",
  warning: "易錯陷阱",
  example: "範例",
  exam: "考點方向",
};

// remark-directive 節點型別（避免額外依賴 mdast-util-directive 型別套件）
interface DirectiveNode extends MdParent {
  type: "containerDirective" | "leafDirective" | "textDirective";
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
}

function isDirective(n: unknown): n is DirectiveNode {
  const t = (n as { type?: string }).type;
  return t === "containerDirective" || t === "leafDirective" || t === "textDirective";
}

function setH(node: object, hName: string, hProperties: Record<string, unknown>) {
  const n = node as { data?: Record<string, unknown> };
  n.data = { ...(n.data ?? {}), hName, hProperties };
}

/** 取出 directive 的 [label]（remark-directive 以 directiveLabel 段落表示）。 */
function takeLabel(node: DirectiveNode): RootContent[] | null {
  const first = node.children?.[0] as (MdParent & { data?: { directiveLabel?: boolean } }) | undefined;
  if (first && first.data?.directiveLabel) {
    node.children.shift();
    return first.children as RootContent[];
  }
  return null;
}

const ROMAN_NUMERAL_RE = /^(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)$/i;
const CHOICE_PREFIX_RE = /^\s*\(?([A-Za-z]|(?:i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xvi{0,3}|xix|xx)|[1-9][0-9]?)[).．、]\s*/;

/** 解析選項前綴（A / i / 1）與移除前綴後的剩餘字串長度。 */
export function parseChoicePrefix(text: string): { raw: string; matchLength: number } | null {
  const m = text.match(CHOICE_PREFIX_RE);
  return m ? { raw: m[1], matchLength: m[0].length } : null;
}

/** 依整組選項推斷正規化後的選項標籤：羅馬數字維持小寫（i, ii, iii）、數字維持原字、字母轉大寫（A, B, C）。 */
export function normalizeChoiceLabels(raws: readonly string[]): string[] {
  const nonEmpty = raws.filter(Boolean);
  const isRomanList =
    nonEmpty.length > 0 &&
    nonEmpty.every((r) => ROMAN_NUMERAL_RE.test(r)) &&
    (nonEmpty.some((r) => r.length >= 2) ||
      (nonEmpty.length >= 2 && nonEmpty[0].toLowerCase() === "i" && nonEmpty[1].toLowerCase() === "ii"));
  return raws.map((raw) => {
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw;
    return isRomanList ? raw.toLowerCase() : raw.toUpperCase();
  });
}

/** 將 directive 的 [label] 或 title 屬性插到容器開頭。 */
function prependDirectiveHeader(
  node: DirectiveNode,
  opts: { type: "heading" | "paragraph"; depth?: 1 | 2 | 3 | 4 | 5 | 6; hName?: string; className: string[] },
  attrs: Record<string, string | null | undefined>,
) {
  const label = takeLabel(node);
  const titleText = attrs.title?.trim();
  const children = label ?? (titleText ? [{ type: "text", value: titleText }] : null);
  if (!children) return;
  const header = {
    type: opts.type,
    ...(opts.depth ? { depth: opts.depth } : {}),
    data: { ...(opts.hName ? { hName: opts.hName } : {}), hProperties: { className: opts.className } },
    children,
  };
  node.children.unshift(header as never);
}

/** 自訂 directive → HTML 結構 */
export function remarkAppDirectives(options: RenderOptions = {}) {
  const mode = options.mode ?? "note";
  return (tree: MdRoot) => {
    let questionNo = 0;
    let passageNo = 0;
    visit(tree, (node) => {
      if (!isDirective(node)) return;
      const attrs = node.attributes ?? {};
      const name = node.name;

      if (node.type === "containerDirective" && name in CALLOUTS) {
        const label = takeLabel(node);
        const title: RootContent = {
          type: "paragraph",
          data: { hProperties: { className: ["callout-title"] } },
          children: (label as never) ?? [{ type: "text", value: CALLOUTS[name] }],
        } as RootContent;
        node.children.unshift(title as never);
        setH(node, "aside", { className: ["callout", `callout-${name}`] });
        return;
      }

      if (node.type === "containerDirective" && (name === "passage" || name === "stimulus")) {
        passageNo++;
        prependDirectiveHeader(node, { type: "heading", depth: 3, className: ["exam-passage-title"] }, attrs);
        const id = attrs.id ?? `${name === "passage" ? "p" : "s"}${passageNo}`;
        setH(node, "article", {
          className: [name === "passage" ? "exam-passage" : "exam-stimulus"],
          ...(name === "passage" ? { dataPassage: id } : { dataStimulus: id }),
          dataLettered: attrs.lettered ?? (name === "passage" ? "true" : "false"),
        });
        return;
      }

      if (node.type === "containerDirective" && (name === "flowchart" || name === "diagram")) {
        prependDirectiveHeader(node, { type: "paragraph", hName: "figcaption", className: ["exam-figure-caption"] }, attrs);
        setH(node, "figure", { className: [`exam-${name}`] });
        return;
      }

      if (node.type === "containerDirective" && name === "notes") {
        prependDirectiveHeader(node, { type: "paragraph", className: ["exam-notes-title"] }, attrs);
        setH(node, "div", { className: ["exam-notes"] });
        return;
      }

      if (node.type === "containerDirective" && name === "solution") {
        const label = takeLabel(node);
        const summary = {
          type: "paragraph",
          data: { hName: "summary" },
          children: label ?? [{ type: "text", value: "解析" }],
        };
        node.children.unshift(summary as never);
        setH(node, "details", { className: ["solution"], dataFor: attrs.for ?? undefined, open: mode === "exam-review" });
        return;
      }

      if (node.type === "containerDirective" && name === "question") {
        questionNo++;
        const id = attrs.id ?? `q${questionNo}`;
        setH(node, "section", {
          className: ["question"],
          dataQuestion: id,
          dataNo: String(questionNo),
          ...(attrs.passage ? { dataPassage: attrs.passage } : {}),
        });
        return;
      }

      if (node.type === "containerDirective" && name === "part") {
        setH(node, "div", { className: ["question-part"], dataPart: attrs.id ?? "" });
        return;
      }

      if (node.type === "containerDirective" && name === "choices") {
        // 內含一個清單；每個項目開頭的 (A) / A. / (i) / 1. 為選項標籤
        setH(node, "div", { className: ["choices"] });
        const listItems: { li: MdParent; textNode?: { type: string; value: string }; prefix: { raw: string; matchLength: number } | null }[] = [];
        visit(node, "listItem", (li) => {
          const para = li.children[0] as MdParent | undefined;
          const text = para?.children?.[0] as { type: string; value: string } | undefined;
          const prefix = text?.type === "text" ? parseChoicePrefix(text.value) : null;
          listItems.push({ li, textNode: text, prefix });
        });
        const labels = normalizeChoiceLabels(listItems.map((item) => item.prefix?.raw ?? ""));
        listItems.forEach((item, index) => {
          const label = labels[index] ?? "";
          if (item.prefix && item.textNode) {
            item.textNode.value = item.textNode.value.slice(item.prefix.matchLength);
          }
          (item.li as { data?: Record<string, unknown> }).data = {
            hProperties: { className: ["choice"], dataChoice: label },
          };
        });
        return;
      }

      if (name === "blank") {
        setH(node, "span", { className: ["blank"], dataBlank: attrs.id ?? "" });
        node.children = [];
        return;
      }

      // 未知 directive：以一般區塊/文字呈現，避免內容消失
      if (node.type === "textDirective") setH(node, "span", {});
      else setH(node, "div", {});
    });
  };
}

/** 內部連結：book:<id>#<印刷頁碼>、deck:<id>、exam:<slug>、note:<slug> → app 路由 */
export function rehypeAppLinks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName !== "a") return;
      const href = String(el.properties?.href ?? "");
      const m = href.match(/^(book|deck|exam|note):([^#?\s]+)(?:#(\d+))?$/);
      if (m) {
        const [, kind, id, page] = m;
        const to =
          kind === "book" ? `/books/${id}${page ? `?printed=${page}` : ""}` : kind === "deck" ? `/decks/${id}` : `/${kind}s/${id}`;
        el.properties = { ...el.properties, href: to, className: ["app-link", `app-link-${kind}`], dataInternal: "1" };
      } else if (/^https?:/.test(href)) {
        el.properties = { ...el.properties, target: "_blank", rel: ["noopener", "noreferrer"] };
      }
    });
  };
}

/** 標題加上 id（與 extractHeadings 規則一致），供目錄跳轉。 */
export function rehypeHeadingIds() {
  return (tree: HastRoot) => {
    const seen = new Map<string, number>();
    visit(tree, "element", (el: Element) => {
      if (!/^h[1-6]$/.test(el.tagName)) return;
      let text = "";
      visit(el, (n) => {
        if (n.type === "text") text += (n as { value: string }).value;
        else if (n.type === "element" && /math/.test(String((n as Element).properties?.className ?? ""))) {
          const child = (n as Element).children[0] as { value?: string } | undefined;
          text += child?.value ?? "";
        }
      });
      const base = slugify(text);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      el.properties = { ...el.properties, id: count ? `${base}-${count}` : base };
    });
  };
}

// 預設 schema 對 section/li/ul 等標籤限制 className 只能是 footnotes/task-list-item；
// 我們的題目與選項需要自訂 class，因此把逐標籤的 className 限制放寬（仍會移除 script/on* 等危險內容）。
const looseAttributes = Object.fromEntries(
  Object.entries(defaultSchema.attributes ?? {}).map(([tag, list]) => [
    tag,
    (list ?? []).map((a) => (Array.isArray(a) && a[0] === "className" ? "className" : a)),
  ]),
);

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "aside", "section", "article", "figure", "figcaption", "details", "summary", "mark", "ins", "del", "u"],
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), "book", "deck", "exam", "note"] },
  attributes: {
    ...looseAttributes,
    "*": [...(looseAttributes["*"] ?? []), "className", "data*", "title"],
    details: ["open"],
    a: [...(looseAttributes.a ?? []), "target", "rel"],
    img: [...(looseAttributes.img ?? []), "loading"],
  },
};

const processors: Partial<Record<RenderMode, Processor<MdRoot, MdRoot, HastRoot, HastRoot, string>>> = {};

export function parseMarkdown(md: string): MdRoot {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective).parse(md) as MdRoot;
}

function getProcessor(mode: RenderMode) {
  if (!processors[mode]) {
    processors[mode] = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkDirective)
      .use(remarkAppDirectives, { mode })
      .use(remarkRehype)
      .use(rehypeSanitize, sanitizeSchema as never)
      .use(rehypeAppLinks)
      .use(rehypeHeadingIds)
      .use(rehypeKatex, { throwOnError: false, strict: "ignore", trust: false } as never)
      .use(rehypeStringify) as never;
  }
  return processors[mode]!;
}

/** 將（已解析、可能已加上修訂標記的）mdast 轉成 HTML。 */
export function renderTree(tree: MdRoot, options: RenderOptions = {}): string {
  const proc = getProcessor(options.mode ?? "note");
  const hast = proc.runSync(structuredClone(tree));
  return proc.stringify(hast);
}

export function renderMarkdown(md: string, options: RenderOptions = {}): string {
  return renderTree(parseMarkdown(stripFrontmatter(md).body), options);
}

// ---- Frontmatter（簡易 YAML：key: value / key: [a, b] / 數字 / 布林）----
export type Frontmatter = Record<string, string | number | boolean | string[]>;

export function stripFrontmatter(md: string): { data: Frontmatter; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: md };
  const data: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*(#.*)?$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    if (/^\[.*\]$/.test(raw)) {
      data[key] = raw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) data[key] = Number(raw);
    else if (raw === "true" || raw === "false") data[key] = raw === "true";
    else data[key] = raw.replace(/^["']|["']$/g, "");
  }
  return { data, body: md.slice(m[0].length) };
}

/** 取得標題清單（TOC 用）。 */
export function extractHeadings(md: string): { depth: number; text: string; id: string }[] {
  const tree = parseMarkdown(stripFrontmatter(md).body);
  const out: { depth: number; text: string; id: string }[] = [];
  const seen = new Map<string, number>();
  visit(tree, "heading", (h) => {
    let text = "";
    visit(h, (n) => {
      const v = (n as { value?: string }).value;
      if (typeof v === "string" && (n.type === "text" || n.type === "inlineCode" || n.type === "inlineMath")) text += v;
    });
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.push({ depth: h.depth, text, id: count ? `${base}-${count}` : base });
  });
  return out;
}

export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, "-")
      .replace(/[^\p{L}\p{N}-]+/gu, "")
      .slice(0, 80) || "section"
  );
}
