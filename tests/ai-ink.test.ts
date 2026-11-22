import { describe, expect, it } from "vitest";
import { buildCardsPrompt, buildExamPrompt, buildNotePrompt, parseAiOutput } from "../src/shared/ai-prompts";
import { splitInk } from "../src/shared/ink";
import { analyzeExamMarkdown, crossCheck, stripSolutions, validateAnswers } from "../src/shared/exam";
import { parsePastedCards } from "../src/shared/notebooklm";
import { renderMarkdown } from "../src/shared/markdown";

describe("一般橡皮擦：切斷筆跡", () => {
  const line: [number, number, number][] = [
    [0, 0, 0.5],
    [100, 0, 0.5],
  ];
  it("擦中間 → 分成左右兩段（即使只有兩個端點）", () => {
    const parts = splitInk(line, 2, 50, 0, 5);
    expect(parts).toHaveLength(2);
    expect(Math.max(...parts[0].map((p) => p[0]))).toBeLessThan(45);
    expect(Math.min(...parts[1].map((p) => p[0]))).toBeGreaterThan(55);
  });
  it("擦端點 → 剩一段；擦整條 → 不剩", () => {
    expect(splitInk(line, 2, 0, 0, 5)).toHaveLength(1);
    expect(splitInk(line, 2, 50, 0, 80)).toHaveLength(0);
  });
  it("沒碰到 → 原樣一段", () => {
    expect(splitInk(line, 2, 50, 40, 5)).toHaveLength(1);
  });
});

describe("AI prompt 與輸出解析", () => {
  it("prompt 包含格式規格", () => {
    const exam = buildExamPrompt({ subject: "Math", topic: "直線", count: 5, minutes: 30, difficulty: "standard", types: ["single_choice", "fill_blank"], calculators: ["scientific"] });
    expect(exam).toContain("::::question{#q1}");
    expect(exam).toContain('"schema": "exam-answers/v1"');
    expect(exam).toContain("===JSON===");
    expect(buildNotePrompt({ subject: "Chemistry", topic: "週期表", source: "教材內容" })).toContain("<<<SOURCE");
    expect(buildCardsPrompt({ subject: "English", topic: "U1", count: 20, style: "vocabulary" })).toContain("===CARDS===");
  });

  it("解析分隔標記格式並與題目一致", () => {
    const reply = `好的，以下是試卷：
===MARKDOWN===
---
title: 測驗
time_limit_min: 20
calculators: [scientific]
---

::::question{#q1}
$2+2=$ ?
:::choices
- (A) 3
- (B) 4
:::
::::

:::solution{for=q1}
答案是 4
:::

::::question{#q2}
$x=$ :blank{#a}
:::solution
題內解析不可外洩
:::
::::
===END MARKDOWN===
===JSON===
{"schema":"exam-answers/v1","questions":[{"id":"q1","type":"single_choice","answer":"B","points":1},{"id":"q2","type":"fill_blank","points":1,"blanks":[{"id":"a","kind":"numeric","answer":3}]}]}
===END JSON===`;
    const out = parseAiOutput(reply);
    expect(out.jsonError).toBeNull();
    const v = validateAnswers(out.json);
    expect(v.ok).toBe(true);
    if (v.ok) expect(crossCheck(out.markdown!, v.value)).toEqual([]);
    expect(analyzeExamMarkdown(out.markdown!).solutionRanges).toHaveLength(2);
    const stripped = stripSolutions(out.markdown!);
    expect(stripped).not.toContain("答案是 4");
    expect(stripped).not.toContain("題內解析不可外洩");
    expect(renderMarkdown(out.markdown!, { mode: "exam" })).toContain('data-question="q2"');
  });

  it("退而解析 ``` 圍欄與字卡", () => {
    const out = parseAiOutput("```markdown\n# 標題\n\n內容 $x$\n```\n\n```json\n{\"a\":1}\n```");
    expect(out.markdown).toBe("# 標題\n\n內容 $x$\n");
    expect(out.json).toEqual({ a: 1 });
    const bad = parseAiOutput("===JSON===\n{bad}\n===END JSON===");
    expect(bad.jsonError).toMatch(/無法解析/);
    const cards = parseAiOutput("===CARDS===\nmole\n===\n莫耳\n---\n$E=mc^2$\n===\n質能\n===END CARDS===");
    expect(parsePastedCards(cards.cards!)).toEqual([
      { front: "mole", back: "莫耳" },
      { front: "$E=mc^2$", back: "質能" },
    ]);
  });
});
