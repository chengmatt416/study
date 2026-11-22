import { describe, expect, it } from "vitest";
import { parseExamPaper } from "../src/shared/exam-paper";
import { renderMarkdown } from "../src/shared/markdown";
import type { PublicQuestion } from "../src/shared/exam";

describe("parseExamPaper 與新題型 Markdown 渲染", () => {
  it("解析閱讀文章、段落字母、題組推斷、羅馬數字選項與大題共用題幹", () => {
    const md = `---
title: 綜合模擬考
time_limit_min: 60
---

# 綜合模擬考

## Section A: Reading Comprehension

::::passage{#p1 title="Deep Sea Vents"}
Hydrothermal vents were discovered in 1977.

![Vent diagram](/api/assets/vent.png)

Chemosynthetic bacteria form the base of the food web.
::::

### Part 1: Headings

::::question{#q1}
Pick the heading for paragraph A.
:::choices
- (i) Thermal chemistry
- (ii) The 1977 discovery
:::
::::

::::question{#q2 passage="none"}
Standalone question without passage.
::::

## Section B: Chemistry Data Analysis

| Time / s | 0 | 20 |
| :--- | :---: | :---: |
| Vol / cm3 | 0 | 24 |

::::question{#q3}
Calculate the initial rate from the table.
::::

## Section C: Structured Calculation

::::question{#q4}
A projectile is launched at $20\\text{ m s}^{-1}$ at $30^\\circ$.

:::part{#a}
(a) Find the vertical component $v_y =$ :blank{#vy}.
:::

:::part{#b}
(b) Explain your reasoning.
:::
::::
`;

    const questions: PublicQuestion[] = [
      { id: "q1", type: "single_choice", points: 1, options: ["i", "ii"] },
      { id: "q2", type: "tfng", points: 1 },
      { id: "q3", type: "numeric", points: 2 },
      {
        id: "q4",
        type: "multipart",
        points: 4,
        parts: [
          { id: "a", type: "fill_blank", points: 2, blanks: [{ id: "vy", kind: "numeric" }] },
          { id: "b", type: "open", points: 2 },
        ],
      },
    ];

    const paper = parseExamPaper(md, questions);
    expect(paper.passages).toHaveLength(2);
    expect(paper.passages[0].id).toBe("p1");
    expect(paper.passages[0].title).toBe("Deep Sea Vents");
    // Image-only paragraph does NOT consume a paragraph letter
    expect(paper.passages[0].blocks.map((b) => b.letter)).toEqual(["A", "", "B"]);

    expect(paper.questions[0].passageId).toBe("p1");
    expect(paper.questions[0].choices).toEqual([
      { key: "i", md: "Thermal chemistry" },
      { key: "ii", md: "The 1977 discovery" },
    ]);
    expect(paper.questions[1].passageId).toBeNull();

    // Section B synthesized stimulus from table
    expect(paper.questions[2].passageId).toBe("stimulus-1");
    expect(paper.passagesById["stimulus-1"].kind).toBe("stimulus");

    // Section C multipart pins shared stem to passage pane
    expect(paper.questions[3].passageId).toBeNull();
    expect(paper.questions[3].pinStemToPassagePane).toBe(true);
    expect(paper.questions[3].stemMd).toContain("projectile");
    expect(paper.questions[3].parts).toHaveLength(2);
    expect(paper.questions[3].parts![0].hasInlineBlanks).toBe(true);
  });

  it("renderMarkdown 正確渲染 passage、flowchart 與 diagram 區塊", () => {
    const html = renderMarkdown(
      `::::passage{#p1 title="Passage Title"}
Paragraph text.
::::

:::flowchart[Water Cycle]
1. Evaporation
2. Condensation
:::

:::diagram[Cell Parts]
- Nucleus
- Membrane
:::`,
      { mode: "exam" },
    );
    expect(html).toContain('class="exam-passage"');
    expect(html).toContain('data-passage="p1"');
    expect(html).toContain('class="exam-flowchart"');
    expect(html).toContain('class="exam-diagram"');
    expect(html).toContain("Water Cycle");
  });
});
