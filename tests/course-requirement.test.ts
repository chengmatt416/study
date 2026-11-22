import { describe, expect, it } from "vitest";
import { courseRequirement, MAX_COURSE_REQUIREMENT_CHARS, requirementProblem } from "../src/shared/course-requirement";
import { MAX_CHAPTERS, validateBlueprint, type CourseBlueprint } from "../src/shared/course-blueprint";
import { blueprint } from "./helpers/blueprint";

const chapter = (index: number) => ({
  key: `第${index + 1}章 向量與線性組合的幾何意義`, summary: "用幾何圖像建立向量加法、純量積與線性組合的概念，並連結到方程組的解",
  prerequisites: index ? [`第${index}章 向量與線性組合的幾何意義`] : [], minutes: 30, difficulty: index ? 2 : 1,
  new_concepts: [{ name: "線性組合的定義與幾何意義", kind: "concept" }, { name: "向量加法的平行四邊形法則", kind: "procedure" }, { name: "生成空間 span", kind: "term" }],
  objectives: [
    { id: `c${index}-a`, text: "定義線性組合並判斷給定向量是否為另外兩向量的線性組合", command_term: "define", syllabus_ref: "AHL 3.13", bloom: "understand" },
    { id: `c${index}-b`, text: "計算線性組合的係數並以圖形驗證結果的合理性", command_term: "calculate", syllabus_ref: "AHL 3.13", bloom: "apply" },
    { id: `c${index}-c`, text: "解釋兩向量平行時生成空間退化的原因並舉出反例", command_term: "explain", syllabus_ref: "AHL 3.14", bloom: "analyze" },
  ],
  misconceptions: ["span-is-plane", "parallel-ok", "scalar-order"], exam_traps: ["平行向量誤判為可生成整個平面", "係數方程組只解一式就下結論", "忘記檢查第三個分量是否一致"],
});
const full = () => validateBlueprint({ ...blueprint(), chapters: Array.from({ length: MAX_CHAPTERS }, (_, index) => chapter(index)) }).value as CourseBlueprint;

describe("the generation requirement budget", () => {
  it("fits a full twelve-chapter plan", () => {
    expect(full().chapters).toHaveLength(12);
    expect(requirementProblem(full())).toBeNull();
    expect(courseRequirement("主題", full()).length).toBeLessThan(MAX_COURSE_REQUIREMENT_CHARS);
  });
  it("tells the chatbot to read IB documents without listing them", () => {
    const text = courseRequirement("主題", full());
    expect(text).toContain("list_ib_resources");
    expect(text).not.toContain("可用 IB 文件索引");
  });
  it("carries the plan and the rules the outline step needs", () => {
    const text = courseRequirement("週期與頻率", full());
    for (const part of ["週期與頻率", "課程藍圖", "第12章", "「章名｜小節」", "題目位置規則"]) expect(text, part).toContain(part);
  });
  it("names the limit when a plan is too long to start", () => {
    const long = "很長的章節摘要說明".repeat(33);
    const bloated = { ...full(), chapters: full().chapters.map((item) => ({ ...item, summary: long, objectives: item.objectives.map((objective) => ({ ...objective, text: long })) })) };
    expect(requirementProblem(bloated)).toContain(String(MAX_COURSE_REQUIREMENT_CHARS));
  });
  it("stays inside the Core's 64 KB start body at the longest allowed requirement", () => {
    const worst = "字".repeat(MAX_COURSE_REQUIREMENT_CHARS);
    const body = JSON.stringify({ part_id: `${"a".repeat(36)}:9`, input: { requirement: worst, materialIds: ["material-id"], interactive: true, outlineReview: "auto", agents: { mode: "auto" } } });
    expect(new TextEncoder().encode(body).length).toBeLessThan(64 * 1024);
  });
});
