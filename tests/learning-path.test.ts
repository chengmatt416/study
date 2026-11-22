import { describe, expect, it } from "vitest";
import { advanceLearning, diagnosticRoute, initialLearningState, masteryPassed, type LearningAction } from "../src/shared/learning-path";
import { validateCourse } from "../src/shared/openmaic";
import { advanceGeneration, generationStep } from "../src/shared/course-generation";
import { generatedCourse, initialState, moduleOutput, planOutput } from "./fixtures/course-generation";

const course = generatedCourse();
if (course.format !== "openmaic-scenes") throw new Error("expected scene course");
const first = course.scenes.find((s) => s.type === "interactive")!;
const chapters = [first, { ...first, id: "second", order: 1 }, { ...first, id: "third", order: 2 }];
const correct = { pre1: ["A"] };

describe("先測分流與精熟學習", () => {
  it("從最早缺口開始，保留後續章節的先備順序，不會以總分跳過弱點", () => {
    expect(diagnosticRoute(chapters, [correct, {}, correct])).toEqual([1, 2]);
    expect(diagnosticRoute(chapters, [{}, correct, correct])).toEqual([0, 1, 2]);
    expect(diagnosticRoute(chapters, [correct, correct, correct])).toEqual([]);
    expect(diagnosticRoute(chapters, [])).toEqual([0, 1, 2]);
  });

  it("先教學，再完成互動，檢核全對才前進，答錯可以重學", () => {
    let state = initialLearningState;
    const act = (action: LearningAction) => state = advanceLearning(state, action, chapters, true);
    act({ type: "advance" }); expect(state.phase).toBe("welcome");
    act({ type: "start" });
    act({ type: "diagnose", responses: [correct, {}, correct] });
    expect(state.route).toEqual([1, 2]);
    act({ type: "begin" }); expect(state.phase).toBe("teaching");
    act({ type: "check" }); expect(state.phase).toBe("teaching");
    act({ type: "teach-next" }); expect(state.teachingStep).toBe(1);
    act({ type: "teach-next" }); expect(state.phase).toBe("interaction");
    act({ type: "check" }); expect(state.phase).toBe("interaction");
    act({ type: "interact", step: 1 }); act({ type: "check" });
    expect(state.phase).toBe("checkpoint");
    act({ type: "assess", responses: { check1: ["B"] } }); act({ type: "advance" });
    expect(state.phase).toBe("checkpoint");
    act({ type: "relearn" }); expect(state).toMatchObject({ phase: "teaching", teachingStep: 0, interactionStep: 0, checkpointPassed: false, cycle: 1 });
    act({ type: "teach-next" }); act({ type: "teach-next" }); act({ type: "interact", step: 1 }); act({ type: "check" });
    act({ type: "assess", responses: { check1: ["A"] } });
    expect(state.checkpointPassed).toBe(true);
    act({ type: "advance" }); expect(state).toMatchObject({ phase: "teaching", chapter: 1, checkpointPassed: false });
    act({ type: "teach-next" }); act({ type: "teach-next" }); act({ type: "interact", step: 1 }); act({ type: "check" });
    act({ type: "assess", responses: { check1: ["A"] } }); act({ type: "advance" });
    expect(state.phase).toBe("final");
  });

  it("先測全對可進最終檢核，也可自主選擇從頭重學", () => {
    const result = advanceLearning({ ...initialLearningState, phase: "pretest" }, { type: "diagnose", responses: chapters.map(() => correct) }, chapters, true);
    expect(advanceLearning(result, { type: "begin" }, chapters, true).phase).toBe("final");
    expect(advanceLearning(result, { type: "begin" }, chapters, false).phase).toBe("complete");
    const all = advanceLearning(result, { type: "all-chapters" }, chapters, true);
    expect(all.route).toEqual([0, 1, 2]);
    expect(advanceLearning(all, { type: "begin" }, chapters, true).phase).toBe("teaching");
  });

  it("空檢核、重複選項、空答案及簡答不能被當作客觀掌握證據", () => {
    expect(masteryPassed([], {})).toBe(false);
    expect(masteryPassed(first.content.checkpoint!, { check1: ["A", "A"] })).toBe(false);
    expect(masteryPassed(first.content.checkpoint!, {})).toBe(false);
    expect(masteryPassed([{ ...first.content.checkpoint![0], type: "short_answer" }], { check1: ["A"] })).toBe(false);
  });

  it("新生成缺少教學詳解或先測不過關，舊草稿回到規劃，新規格匯入不可缺環節", () => {
    const state = advanceGeneration(initialState(), planOutput);
    expect(() => advanceGeneration(state, { ...moduleOutput, teaching_steps: moduleOutput.teaching_steps.map((s) => ({ ...s, explanation_md: "再讀一次" })) })).toThrow(/explanation_md/);
    expect(() => advanceGeneration(state, { ...moduleOutput, checkpoint: planOutput.modules[0].pretest })).toThrow(/不可重複先測/);
    const old = structuredClone(state);
    delete (old.plan!.modules[0] as { pretest?: unknown }).pretest;
    expect(generationStep(old)).toBe("plan");
    const invalid = structuredClone(course);
    if (invalid.format === "openmaic-scenes" && invalid.scenes[0].type === "interactive") delete invalid.scenes[0].content.checkpoint;
    expect(validateCourse(invalid).ok).toBe(false);
    if (invalid.format === "openmaic-scenes") delete invalid.learning_design;
    expect(validateCourse(invalid).ok).toBe(true);
  });
});
