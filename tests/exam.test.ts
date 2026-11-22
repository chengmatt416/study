import { describe, expect, it } from "vitest";
import {
  analyzeExamMarkdown,
  answersTemplate,
  crossCheck,
  expressionEquivalent,
  gradeExam,
  numericMatches,
  parseNumber,
  roundSig,
  stripSolutions,
  toPublic,
  validateAnswers,
  type AnswersFile,
} from "../src/shared/exam";

const md = `---
title: 模擬卷 A
time_limit_min: 60
calculators: [scientific, graphing]
---

## Section A

::::question{#q1}
斜率為何？

:::choices
- (A) $\\tfrac12$
- (B) $2$
- (C) 3
- (D) 6
:::
::::

:::question{#q2}
$a=$ :blank{#a} ，$b=$ :blank{#b}
:::

:::solution{for=q2}
答案是 $\\frac{11}{49}$
:::

::::question{#q3}
多小題
:::part{#a}
(a) 求 x：:blank{#x}
:::
:::part{#b}
(b) 說明
:::
::::
`;

const answers: AnswersFile = {
  schema: "exam-answers/v1",
  questions: [
    { id: "q1", type: "single_choice", answer: "B", points: 2 },
    {
      id: "q2",
      type: "fill_blank",
      points: 4,
      blanks: [
        { id: "a", kind: "numeric", answer: "11/49", tolerance: { sig_figs: 3 } },
        { id: "b", kind: "numeric", answer: "6/49", tolerance: { sig_figs: 3 } },
      ],
    },
    {
      id: "q3",
      type: "multipart",
      parts: [
        { id: "a", type: "fill_blank", blanks: [{ id: "x", kind: "expression", answer: "2x+3" }], points: 2 },
        { id: "b", type: "open", points: 3, model_answer: "..." },
      ],
    },
  ],
};

describe("試題結構", () => {
  it("分析 md：題號、選項、空格、小題、frontmatter", () => {
    const s = analyzeExamMarkdown(md);
    expect(s.frontmatter).toMatchObject({ title: "模擬卷 A", time_limit_min: 60, calculators: ["scientific", "graphing"] });
    expect(s.questionIds).toEqual(["q1", "q2", "q3"]);
    expect(s.choices.q1).toEqual(["A", "B", "C", "D"]);
    expect(s.blanks.q2).toEqual(["a", "b"]);
    expect(s.parts.q3).toEqual(["a", "b"]);
    expect(s.blanks["q3.a"]).toEqual(["x"]);
    expect(s.solutionRanges).toHaveLength(1);
  });

  it("stripSolutions 移除解析且保留其他內容", () => {
    const out = stripSolutions(md);
    expect(out).not.toContain("11}{49");
    expect(out).toContain(":::question{#q3}");
    expect(out).toContain("title: 模擬卷 A");
  });

  it("驗證與交叉檢查", () => {
    expect(validateAnswers(answers).ok).toBe(true);
    expect(crossCheck(md, answers)).toEqual([]);
    const bad = validateAnswers({ schema: "x", questions: [{ id: "q1", type: "single_choice" }, { id: "q1", type: "nope" }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(3);
    const mismatch = crossCheck(md, { ...answers, questions: [{ id: "q1", type: "single_choice", answer: "E" }] });
    expect(mismatch.join("\n")).toMatch(/q2.*找不到/);
    expect(mismatch.join("\n")).toMatch(/E 不在選項/);
  });

  it("公開規格不含答案", () => {
    const pub = answers.questions.map((q) => toPublic(q, "seed", analyzeExamMarkdown(md).choices));
    const json = JSON.stringify(pub);
    expect(json).not.toContain("11/49");
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain("2x+3");
    expect(pub[0].options).toEqual(["A", "B", "C", "D"]);
    expect(pub[2].points).toBe(5);
  });

  it("樣板產生", () => {
    const t = answersTemplate(md);
    expect(t.questions.map((q) => q.type)).toEqual(["single_choice", "fill_blank", "multipart"]);
    expect(validateAnswers(t).ok).toBe(true);
  });
});

describe("批改", () => {
  it("數值解析", () => {
    expect(parseNumber("11/49")).toBeCloseTo(0.22449, 4);
    expect(parseNumber("2.24e-1")).toBeCloseTo(0.224);
    expect(parseNumber("2.24×10^-1")).toBeCloseTo(0.224);
    expect(parseNumber("√2")).toBeCloseTo(1.41421, 4);
    expect(parseNumber("2π")).toBeCloseTo(6.28318, 4);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("12 cm", "cm")).toBe(12);
    expect(parseNumber("import('x')")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("有效位數與容許誤差", () => {
    expect(roundSig(0.224489, 3)).toBe(0.224);
    expect(roundSig(12345, 3)).toBe(12300);
    expect(numericMatches(0.224, 11 / 49, { sig_figs: 3 })).toBe(true);
    expect(numericMatches(0.225, 11 / 49, { sig_figs: 3 })).toBe(false);
    expect(numericMatches(3.15, 3.14159, { abs: 0.01 })).toBe(true);
    expect(numericMatches(3.2, 3.14159, { abs: 0.01 })).toBe(false);
    expect(numericMatches(0.5, 0.5)).toBe(true);
  });

  it("代數式等價", () => {
    expect(expressionEquivalent("3+2x", "2x+3")).toBe(true);
    expect(expressionEquivalent("2(x+1)+1", "2x+3")).toBe(true);
    expect(expressionEquivalent("x^2-1", "(x-1)(x+1)")).toBe(true);
    expect(expressionEquivalent("2x+4", "2x+3")).toBe(false);
    expect(expressionEquivalent("sqrt(x^2)", "x")).toBe(false);
  });

  it("整卷批改 + 自評", () => {
    const res = gradeExam(answers, { q1: "b", q2: { a: "0.224", b: "0.5" }, q3: { a: { x: "3+2x" }, b: "我的說明" } });
    expect(res.questions[0]).toMatchObject({ score: 2, correct: true });
    expect(res.questions[1]).toMatchObject({ score: 2, correct: "partial", detail: { a: true, b: false } });
    expect(res.questions[2].parts?.[0].score).toBe(2);
    expect(res.pendingSelfGrade).toBe(1);
    expect(res.score).toBe(6);
    expect(res.max).toBe(11);
    const withSelf = gradeExam(answers, { q1: "B" }, { "q3.b": 2 });
    expect(withSelf.pendingSelfGrade).toBe(0);
    expect(withSelf.score).toBe(4);
  });

  it("複選題計分方式", () => {
    const f: AnswersFile = {
      schema: "exam-answers/v1",
      questions: [
        { id: "a", type: "multi_choice", answer: ["A", "C"], points: 2 },
        { id: "b", type: "multi_choice", answer: ["A", "C"], points: 2, scoring: "partial" },
        { id: "c", type: "multi_choice", answer: ["A", "C"], points: 4, options: ["A", "B", "C", "D"], scoring: "per_option" },
      ],
    };
    const r = gradeExam(f, { a: ["A"], b: ["A", "B", "C"], c: ["A", "B"] });
    expect(r.questions.map((q) => q.score)).toEqual([0, 1, 2]);
  });

  it("排序、配對、是非、文字", () => {
    const f: AnswersFile = {
      schema: "exam-answers/v1",
      questions: [
        { id: "o", type: "ordering", items: ["1", "2", "3"] },
        { id: "m", type: "matching", pairs: [{ left: "Na", right: "鈉" }, { left: "K", right: "鉀" }], points: 2 },
        { id: "t", type: "true_false", answer: false },
        { id: "x", type: "text", accept: ["Perpendicular bisector"], ignore_punct: true },
      ],
    };
    const r = gradeExam(f, { o: ["1", "2", "3"], m: { Na: "鈉", K: "鈉" }, t: false, x: "  perpendicular   bisector. " });
    expect(r.questions.map((q) => q.score)).toEqual([1, 1, 1, 1]);
  });

  it("支援 TFNG、YNNG、結構填空（含字數限制與詞庫）、原文舉證與羅馬數字選項", () => {
    const readingMd = `---
title: IB English B Reading
time_limit_min: 45
---

## Text A

::::passage{#p1 title="Urban Rooftops"}
First paragraph about solar panels.

Second paragraph about water retention.
::::

::::question{#q1 passage="p1"}
Solar panels reduce rooftop heat.
::::

::::question{#q2 passage="p1"}
The writer believes all roofs should be painted white.
::::

::::question{#q3 passage="p1"}
Choose the correct heading.
:::choices
- (i) Early challenges
- (ii) Water retention benefits
- (iii) Policy history
:::
::::

::::question{#q4 passage="p1"}
Complete the flow chart below.
::::

::::question{#q5 passage="p1"}
Complete using the word bank.
::::

::::question{#q6 passage="p1"}
Quote the phrase in paragraph B about water.
::::

::::question{#q7 passage="p1"}
Choose TWO statements.
:::choices
- (A) One
- (B) Two
- (C) Three
:::
::::
`;

    const readingAnswers: AnswersFile = {
      schema: "exam-answers/v1",
      questions: [
        { id: "q1", type: "tfng", answer: "TRUE", points: 1, passage: "p1" },
        { id: "q2", type: "ynng", answer: "NOT_GIVEN", points: 1, passage: "p1" },
        { id: "q3", type: "single_choice", answer: "ii", points: 1 },
        {
          id: "q4",
          type: "completion",
          points: 1,
          word_limit: 2,
          numbers_allowed: true,
          layout: { kind: "flowchart", title: "Cooling cycle", steps: ["Rain falls", "Soil holds {gap}"] },
          accept: ["20 liters", "rainwater"],
        },
        {
          id: "q5",
          type: "completion",
          points: 1,
          layout: { kind: "text", lines: ["Green roofs improve {gap}."] },
          word_bank: [
            { key: "A", text: "insulation" },
            { key: "B", text: "traffic" },
          ],
          accept: ["A"],
        },
        {
          id: "q6",
          type: "evidence",
          points: 1,
          block_id: "B",
          accept_quotes: ["water retention"],
          allow_absence: true,
        },
        {
          id: "q7",
          type: "multi_choice",
          answer: ["A", "C"],
          select_count: 2,
          points: 2,
        },
      ],
    };

    expect(validateAnswers(readingAnswers).ok).toBe(true);
    expect(crossCheck(readingMd, readingAnswers)).toEqual([]);

    const s = analyzeExamMarkdown(readingMd);
    expect(s.choices.q3).toEqual(["i", "ii", "iii"]);
    expect(s.passages).toEqual(["p1"]);

    const pub = readingAnswers.questions.map((q) => toPublic(q, "seed", s.choices));
    expect(pub[6].maxSelections).toBe(2);
    expect(JSON.stringify(pub)).not.toContain("water retention");

    const gradedOk = gradeExam(readingAnswers, {
      q1: "true",
      q2: "Not Given",
      q3: "ii",
      q4: "20 liters", // 1 word + 1 number -> within 2-word limit
      q5: "a",
      q6: { type: "SPAN", blockId: "p1-b1", blockLetter: "B", quote: "Water retention." },
      q7: ["A", "C"],
      __flags: ["q2"],
      __highlights: [{ id: "h1", passageId: "p1", blockId: "p1-b0", startOffset: 0, endOffset: 5, quote: "First" }],
    } as never);
    expect(gradedOk.score).toBe(8);
    expect(gradedOk.max).toBe(8);

    // 超過 word_limit 應判錯；段落不符的舉證應判錯
    const gradedOver = gradeExam(readingAnswers, {
      q1: "FALSE",
      q2: "NO",
      q3: "i",
      q4: "lots of cold rainwater", // 4 words > limit 2
      q5: "B",
      q6: { type: "SPAN", blockId: "p1-b0", blockLetter: "A", quote: "water retention" }, // wrong block A vs B
      q7: ["A"],
    });
    expect(gradedOver.score).toBe(0);
  });
});
