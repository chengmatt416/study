import { describe, expect, it } from "vitest";
import { buildExamPrompt, buildNotePrompt, EXAM_LANGUAGE_GUIDE, type ExamPromptOptions } from "../src/shared/ai-prompts";

const exam: Omit<ExamPromptOptions, "language"> = { subject: "Physics", topic: "Kinematics", count: 10, minutes: 40, difficulty: "standard", types: ["single_choice", "numeric"], calculators: ["scientific"] };

describe("language of AI prompts", () => {
  it("writes the paper in English when the user has not chosen a language", () => {
    const prompt = buildExamPrompt(exam);
    expect(prompt).toContain("Write the whole paper in English");
    expect(prompt).not.toContain("繁體中文");
    expect(EXAM_LANGUAGE_GUIDE).toContain("一律使用英文");
  });

  it("keeps the language the user asked for", () => {
    expect(buildExamPrompt({ ...exam, language: "zh" })).toContain("使用繁體中文");
    expect(buildExamPrompt({ ...exam, language: "zh" })).not.toContain("Write the whole paper in English");
    expect(buildExamPrompt({ ...exam, language: "bilingual" })).toContain("中英對照");
  });

  it("leaves notes on their own default", () => {
    expect(buildNotePrompt({ subject: "Physics", topic: "Kinematics" })).toContain("使用繁體中文");
  });
});
