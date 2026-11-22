import { describe, expect, it } from "vitest";
import { latexToPlain } from "../src/shared/latex-math";
import { expressionEquivalent, gradeQuestion, parseNumber } from "../src/shared/exam";

describe("latexToPlain", () => {
  it("fractions, roots, powers", () => {
    expect(parseNumber(latexToPlain("\\frac{11}{49}"))).toBeCloseTo(11 / 49);
    expect(parseNumber(latexToPlain("\\sqrt{2}"))).toBeCloseTo(Math.SQRT2);
    expect(parseNumber(latexToPlain("\\sqrt[3]{27}"))).toBeCloseTo(3);
    expect(parseNumber(latexToPlain("2.1\\times10^{-3}"))).toBeCloseTo(2.1e-3);
    expect(parseNumber(latexToPlain("\\dfrac{\\pi}{2}"))).toBeCloseTo(Math.PI / 2);
    expect(parseNumber(latexToPlain("\\left(\\frac{1}{2}\\right)^{2}"))).toBeCloseTo(0.25);
  });
  it("expressions", () => {
    expect(expressionEquivalent(latexToPlain("\\left(x-1\\right)^{2}"), "x^2-2x+1")).toBe(true);
    expect(expressionEquivalent(latexToPlain("2x\\cdot\\sin\\left(x\\right)"), "2*x*sin(x)")).toBe(true);
    expect(expressionEquivalent(latexToPlain("\\frac{x+1}{x}"), "1+1/x")).toBe(true);
    expect(expressionEquivalent(latexToPlain("e^{2x}"), "exp(2x)")).toBe(true);
    expect(expressionEquivalent(latexToPlain("\\ln x"), "log(x)")).toBe(false); // 需要括號，避免誤判
    expect(expressionEquivalent(latexToPlain("\\ln\\left(x\\right)"), "log(x)")).toBe(true);
    expect(expressionEquivalent(latexToPlain("x_{1}+x_{2}"), "x_2+x_1")).toBe(true);
    expect(expressionEquivalent(latexToPlain("\\log_{2}\\left(x\\right)"), "log(x)/log(2)")).toBe(true);
  });
  it("grading accepts latex answers", () => {
    expect(gradeQuestion({ id: "1", type: "numeric", answer: "11/49" }, "\\frac{11}{49}").correct).toBe(true);
    expect(gradeQuestion({ id: "1", type: "numeric", answer: 3.2, unit: "m/s" }, "3.2\\,\\mathrm{m}\\,\\mathrm{s}^{-1}").correct).toBe(true);
    expect(gradeQuestion({ id: "1", type: "expression", answer: "(x+1)^2" }, "x^{2}+2x+1").correct).toBe(true);
    expect(gradeQuestion({ id: "1", type: "fill_blank", blanks: [{ id: "a", kind: "numeric", answer: 0.5 }] }, { a: "\\frac{1}{2}" }).correct).toBe(true);
    expect(gradeQuestion({ id: "1", type: "numeric", answer: 30 }, "30^{\\circ}").correct).toBe(true);
  });
});

import { extractQuestionMarkdown, gradeExam, stripSolutions } from "../src/shared/exam";
describe("review helpers", () => {
  const md = "::::question{#1}\n題一 $x$\n\n:::solution\n解析\n:::\n::::\n\n::::question{#2}\n題二\n::::\n";
  it("extracts question markdown", () => {
    const q = extractQuestionMarkdown(stripSolutions(md));
    expect(Object.keys(q)).toEqual(["1", "2"]);
    expect(q["1"]).toContain("題一");
    expect(q["1"]).not.toContain("解析");
  });
  it("applies comments", () => {
    const r = gradeExam({ schema: "exam-answers/v1", questions: [{ id: "1", type: "open", points: 3 }] } as never, { "1": "x" }, { "1": 2 }, { "1": "不錯" });
    expect(r.score).toBe(2);
    expect(r.questions[0].comment).toBe("不錯");
  });
});
