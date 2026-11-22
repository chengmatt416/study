// 修訂差異 → 螢光標示。
// 1. 兩版各自解析成 mdast，逐「區塊」比對（段落、標題、清單項、directive 容器…）
// 2. 內容改變的區塊：在原始碼層級做詞/字比對（數學式 $…$ 視為不可分割），用私用區字元插入標記後重新解析
// 3. 走訪文字節點，把標記區段包成 <mark class="rev-ins"> / <del class="rev-del">
// 新增區塊 → .rev-ins-block；刪除區塊 → 以舊內容插入並加 .rev-del-block
import { diffArrays } from "diff";
import type { Root as MdRoot, Parent as MdParent, RootContent, Text, PhrasingContent } from "mdast";
import { parseMarkdown, stripFrontmatter } from "./markdown";

const INS_START = "";
const INS_END = "";
const DEL_START = "";
const DEL_END = "";
const MARKERS = /[-]/;

type Node = RootContent & { position?: { start: { offset?: number }; end: { offset?: number } }; data?: Record<string, unknown> };

export interface DiffStats {
  insertedBlocks: number;
  deletedBlocks: number;
  modifiedBlocks: number;
}

function src(md: string, n: Node): string {
  const s = n.position?.start.offset;
  const e = n.position?.end.offset;
  return s != null && e != null ? md.slice(s, e) : JSON.stringify(n);
}

function addClass(n: Node, cls: string) {
  const data = (n.data ??= {});
  const hProps = ((data.hProperties as Record<string, unknown>) ??= {});
  const prev = hProps.className;
  hProps.className = [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), cls];
}

/** Token 化：$$…$$、$…$ 為整體；英數詞；中日韓逐字；空白；其他單一字元。 */
export function tokenize(s: string): string[] {
  const re = /\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\\\n])+\$|`[^`\n]+`|[A-Za-z0-9_À-ɏ]+(?:['’][A-Za-z]+)?|\s+|[\s\S]/gu;
  return s.match(re) ?? [];
}

const MD_SPECIAL = /([\\`*_[\]{}<>#|!~])/g;

function escapeDeleted(tok: string): string {
  if (tok.startsWith("$")) return tok; // 數學式保持完整，讓它仍能渲染
  return tok.replace(MD_SPECIAL, "\\$1");
}

/** 產生加上標記的 markdown 原始碼（以目前版為主體，插入被刪除的片段）。 */
export function markInline(oldSrc: string, newSrc: string): string {
  const parts = diffArrays(tokenize(oldSrc), tokenize(newSrc));
  let out = "";
  for (const p of parts) {
    const text = p.value.join("");
    if (p.added) out += INS_START + text + INS_END;
    else if (p.removed) {
      // 被刪除的換行不要插回，以免破壞區塊結構
      const del = p.value.map(escapeDeleted).join("").replace(/\n+/g, " ");
      if (del.trim()) out += DEL_START + del + DEL_END;
    } else out += text;
  }
  return out;
}

/** 將標記字元轉成 mark/del 節點（跨越粗體、連結等節點也能正確處理）。 */
function applyMarkers(root: MdParent) {
  let state: "none" | "ins" | "del" = "none";

  const wrap = (children: PhrasingContent[], kind: "ins" | "del"): PhrasingContent => ({
    type: "emphasis", // 借用 phrasing 容器，實際輸出 hName
    data: { hName: kind === "ins" ? "mark" : "del", hProperties: { className: [`rev-${kind}`] } },
    children,
  });

  const walk = (parent: MdParent) => {
    const next: RootContent[] = [];
    for (const child of parent.children as Node[]) {
      if (child.type === "text") {
        const segs = (child as Text).value.split(/([-])/);
        for (const seg of segs) {
          if (seg === INS_START) state = "ins";
          else if (seg === DEL_START) state = "del";
          else if (seg === INS_END || seg === DEL_END) state = "none";
          else if (seg) {
            const t: Text = { type: "text", value: seg };
            next.push(state === "none" ? t : (wrap([t], state) as RootContent));
          }
        }
        continue;
      }
      if (child.type === "inlineCode" || child.type === "code" || child.type === "inlineMath" || child.type === "math") {
        const v = (child as { value: string }).value;
        if (MARKERS.test(v)) {
          (child as { value: string }).value = v.replace(/[-]/g, "");
          addClass(child, "rev-ins");
        } else if (state !== "none") {
          addClass(child, `rev-${state}`);
        }
        next.push(child);
        continue;
      }
      if ("children" in child) walk(child as MdParent);
      next.push(child);
    }
    parent.children = next as never;
  };
  walk(root);
}

function sameKind(a: Node, b: Node): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "heading") return (a as { depth: number }).depth === (b as { depth: number }).depth;
  if (a.type === "containerDirective" || a.type === "leafDirective") {
    const an = a as unknown as { name: string; attributes?: unknown };
    const bn = b as unknown as { name: string; attributes?: unknown };
    return an.name === bn.name && JSON.stringify(an.attributes ?? {}) === JSON.stringify(bn.attributes ?? {});
  }
  if (a.type === "list") return (a as { ordered?: boolean }).ordered === (b as { ordered?: boolean }).ordered;
  return true;
}

const CONTAINER_TYPES = new Set(["containerDirective", "list", "listItem", "blockquote"]);
const INLINE_TYPES = new Set(["paragraph", "heading", "tableCell"]);

/** 比對兩組區塊，回傳合併後的子節點（含刪除區塊）。 */
function diffBlocks(oldMd: string, newMd: string, oldNodes: Node[], newNodes: Node[], stats: DiffStats): Node[] {
  const oldSig = oldNodes.map((n) => n.type + "\u0000" + src(oldMd, n));
  const newSig = newNodes.map((n) => n.type + "\u0000" + src(newMd, n));
  const parts = diffArrays(oldSig, newSig);
  const out: Node[] = [];
  let oi = 0;
  let ni = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      for (let k = 0; k < p.count!; k++) out.push(newNodes[ni++]);
      oi += p.count!;
      continue;
    }
    if (p.removed) {
      const removed = oldNodes.slice(oi, oi + p.count!);
      oi += p.count!;
      const nextPart = parts[i + 1];
      const added = nextPart?.added ? newNodes.slice(ni, ni + nextPart.count!) : [];
      if (nextPart?.added) {
        ni += nextPart.count!;
        i++;
      }
      // 依序配對同型區塊視為「修改」，其餘為純刪除/新增
      const n = Math.max(removed.length, added.length);
      for (let k = 0; k < n; k++) {
        const o = removed[k];
        const a = added[k];
        if (o && a && sameKind(o, a)) {
          out.push(modifyBlock(oldMd, newMd, o, a, stats));
        } else {
          if (o) {
            addClass(o, "rev-del-block");
            stats.deletedBlocks++;
            out.push(o);
          }
          if (a) {
            addClass(a, "rev-ins-block");
            stats.insertedBlocks++;
            out.push(a);
          }
        }
      }
      continue;
    }
    // 純新增
    for (let k = 0; k < p.count!; k++) {
      const a = newNodes[ni++];
      addClass(a, "rev-ins-block");
      stats.insertedBlocks++;
      out.push(a);
    }
  }
  return out;
}

function modifyBlock(oldMd: string, newMd: string, o: Node, a: Node, stats: DiffStats): Node {
  if (CONTAINER_TYPES.has(a.type) && "children" in a && "children" in o) {
    (a as MdParent).children = diffBlocks(
      oldMd,
      newMd,
      (o as MdParent).children as Node[],
      (a as MdParent).children as Node[],
      stats,
    ) as never;
    return a;
  }
  stats.modifiedBlocks++;
  if (INLINE_TYPES.has(a.type)) {
    const marked = markInline(src(oldMd, o), src(newMd, a));
    const reparsed = parseMarkdown(marked).children[0] as Node | undefined;
    if (reparsed && reparsed.type === a.type) {
      applyMarkers(reparsed as MdParent);
      addClass(reparsed, "rev-mod-block");
      return reparsed;
    }
  }
  // 無法做行內比對（表格、程式碼、公式區塊…）：舊版刪除 + 新版新增
  addClass(a, "rev-ins-block");
  addClass(o, "rev-del-block");
  const wrapper: Node = {
    type: "blockquote",
    data: { hName: "div", hProperties: { className: ["rev-replace"] } },
    children: [o, a],
  } as never;
  return wrapper;
}

/** 回傳加上修訂標記的 mdast（交給 renderTree 輸出 HTML）。 */
export function diffMarkdown(oldMdRaw: string, newMdRaw: string): { tree: MdRoot; stats: DiffStats } {
  const oldMd = stripFrontmatter(oldMdRaw).body;
  const newMd = stripFrontmatter(newMdRaw).body;
  const oldTree = parseMarkdown(oldMd);
  const newTree = parseMarkdown(newMd);
  const stats: DiffStats = { insertedBlocks: 0, deletedBlocks: 0, modifiedBlocks: 0 };
  newTree.children = diffBlocks(oldMd, newMd, oldTree.children as Node[], newTree.children as Node[], stats) as never;
  return { tree: newTree, stats };
}

/** 純文字差異（字卡正反面用），回傳 HTML-safe 片段陣列。 */
export function diffPlain(oldText: string, newText: string): { kind: "same" | "ins" | "del"; text: string }[] {
  return diffArrays(tokenize(oldText), tokenize(newText)).map((p) => ({
    kind: p.added ? "ins" : p.removed ? "del" : "same",
    text: p.value.join(""),
  }));
}

/** 將字卡內容的差異轉為帶標記 markdown（讓卡片也能用 renderTree 正常渲染公式）。 */
export function diffInlineMarkdown(oldMd: string, newMd: string): MdRoot {
  const tree = parseMarkdown(markInline(oldMd, newMd));
  applyMarkers(tree);
  return tree;
}
