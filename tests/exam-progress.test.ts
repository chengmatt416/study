import { describe, expect, it } from "vitest";
import type { PublicQuestion } from "../src/shared/exam";
import { examQuestionAnswered, hasExamResponse } from "../src/shared/exam-progress";
import { encodeInk } from "../src/shared/ink";

describe("learner exam completion progress", () => {
  it("counts valid false and zero answers while excluding blank text and empty handwriting", () => {
    expect(hasExamResponse(false)).toBe(true);
    expect(hasExamResponse(0)).toBe(true);
    expect(hasExamResponse("   \n")).toBe(false);
    expect(hasExamResponse({ mode: "ink" })).toBe(false);
    const ink = { version: 1 as const, bg: "lines" as const, pages: [{ id: "p1", strokes: [] }] };
    expect(hasExamResponse({ mode: "ink", ink: encodeInk(ink) })).toBe(false);
    expect(hasExamResponse({ mode: "text", text: "period increases" })).toBe(true);
    expect(hasExamResponse({ mode: "ink", ink: "ink1|lines|500\n#\np,#111111,5:10,10,5 20,20,5" })).toBe(true);
  });
  it("does not label multipart work complete while any required part or blank is still empty", () => {
    const question: PublicQuestion = { id: "q1", type: "multipart", points: 4, parts: [
      { id: "a", type: "fill_blank", points: 2, blanks: [{ id: "x", kind: "numeric" }, { id: "y", kind: "text" }] },
      { id: "b", type: "true_false", points: 2 },
    ] };
    expect(examQuestionAnswered(question, { a: { x: "2" } })).toBe(false);
    expect(examQuestionAnswered(question, { a: { x: "2", y: " " }, b: false })).toBe(false);
    expect(examQuestionAnswered(question, { a: { x: "2", y: "seconds" }, b: false })).toBe(true);
  });
  it("requires every matching relationship before showing a completed question", () => {
    const question: PublicQuestion = { id: "q1", type: "matching", points: 2, lefts: ["mass", "period"] };
    expect(examQuestionAnswered(question, { mass: "kg" })).toBe(false);
    expect(examQuestionAnswered(question, { mass: "kg", period: "s" })).toBe(true);
  });
  it("supports tfng, completion blanks, evidence spans/absence, and multi_choice maxSelections", () => {
    expect(hasExamResponse({ type: "SPAN", blockId: "p1-b0", quote: "   " })).toBe(false);
    expect(hasExamResponse({ type: "SPAN", blockId: "p1-b0", quote: "solar energy" })).toBe(true);
    expect(hasExamResponse({ type: "ABSENCE" })).toBe(true);

    const mc: PublicQuestion = { id: "q1", type: "multi_choice", points: 2, options: ["A", "B", "C"], maxSelections: 2 };
    expect(examQuestionAnswered(mc, ["A"])).toBe(false);
    expect(examQuestionAnswered(mc, ["A", "C"])).toBe(true);

    const comp: PublicQuestion = { id: "q2", type: "completion", points: 2, blanks: [{ id: "a", kind: "text" }, { id: "b", kind: "text" }] };
    expect(examQuestionAnswered(comp, { a: "heat" })).toBe(false);
    expect(examQuestionAnswered(comp, { a: "heat", b: "water" })).toBe(true);
  });
});
