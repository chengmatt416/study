import { describe, expect, it } from "vitest";
import { diffMarkdown, markInline, tokenize } from "../src/shared/diff-md";
import { renderTree, renderMarkdown } from "../src/shared/markdown";

describe("修訂差異", () => {
  it("token 化保留數學式完整", () => {
    expect(tokenize("令 $x^2 + 1$ 為 abc")).toEqual(["令", " ", "$x^2 + 1$", " ", "為", " ", "abc"]);
  });

  it("行內新增與刪除標記", () => {
    const html = renderTree(diffMarkdown("斜率公式為 $m=1$。", "斜率公式為 $m=2$，很重要。").tree);
    expect(html).toContain('class="rev-ins"');
    expect(html).toContain("很重要");
    expect(html).toContain("katex"); // 公式仍正常渲染
    expect(html).not.toMatch(/[-]/);
  });

  it("新增與刪除區塊", () => {
    const { tree, stats } = diffMarkdown("# 標題\n\n第一段\n\n第二段\n", "# 標題\n\n第一段\n\n新段落\n\n第二段\n");
    expect(stats.insertedBlocks).toBe(1);
    const html = renderTree(tree);
    expect(html).toContain("rev-ins-block");
    const del = diffMarkdown("A\n\nB\n\nC\n", "A\n\nC\n");
    expect(del.stats.deletedBlocks).toBe(1);
    expect(renderTree(del.tree)).toContain("rev-del-block");
  });

  it("粗體跨越標記", () => {
    const html = renderTree(diffMarkdown("重點：速度", "重點：**加速度**與速度").tree);
    expect(html).toMatch(/<strong><mark class="rev-ins">加<\/mark>速度<\/strong>/);
    expect(html).not.toMatch(/[\uE000-\uE003]/);
  });

  it("刪除片段中的 markdown 符號被跳脫", () => {
    expect(markInline("a **b** c", "a c")).toContain("\\*\\*");
  });

  it("directive 容器內遞迴比對", () => {
    const a = ":::tip\n第一點\n\n第二點\n:::\n";
    const b = ":::tip\n第一點\n\n第二點改了\n:::\n";
    const { stats, tree } = diffMarkdown(a, b);
    expect(stats.modifiedBlocks).toBe(1);
    expect(renderTree(tree)).toContain("callout");
  });

  it("相同內容不產生標記", () => {
    const md = "# T\n\n- a\n- b $x$\n";
    expect(renderTree(diffMarkdown(md, md).tree)).toBe(renderMarkdown(md));
  });
});

describe("Markdown 渲染", () => {
  it("LaTeX、mhchem、callout、內部連結、XSS 過濾", () => {
    const html = renderMarkdown(
      ":::key[核心重點]\n$\\ce{H2O}$ 與 $$\\frac{a}{b}$$\n:::\n\n[課本](book:chem#58)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>",
    );
    expect(html).toContain("callout-key");
    expect(html).toContain("核心重點");
    expect(html).toContain("katex");
    expect(html).toContain('href="/books/chem?printed=58"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });

  it("mhchem 與上下標正確渲染（單一 KaTeX 版本）", () => {
    const html = renderMarkdown("$\\ce{2H2 + O2 -> 2H2O}$ 與 $y_1$");
    expect(html).not.toContain("katex-error");
    expect(html).toContain("x-arrow"); // mhchem 將 -> 展開為化學反應箭頭
    expect(html).toContain("msupsub");
  });

  it("試題 directive 的 class 不被 sanitize 移除", () => {
    const html = renderMarkdown("::::question{#q1}\n題目\n:::choices\n- (A) 一\n- (B) 二\n:::\n::::\n", { mode: "exam" });
    expect(html).toContain('class="question"');
    expect(html).toContain('class="choice"');
    expect(html).toContain('data-choice="B"');
  });

  it("標題 id", () => {
    expect(renderMarkdown("## 直線方程式")).toContain('id="直線方程式"');
  });
});
