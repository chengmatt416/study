import { describe, expect, it } from "vitest";
import { advanceGeneration, generationCourse, generationStep, generationTask, reviseGeneration } from "../src/shared/course-generation";
import { completedState, initialState, moduleOutput, planOutput, quizOutput, reviewOutput } from "./fixtures/course-generation";

describe("MCP 逐步課程生成", () => {
  it("規劃→逐個模組→測驗→審查→發布，不能直接跳到完成", () => {
    let state = initialState();
    expect(generationStep(state)).toBe("plan");
    expect(() => advanceGeneration(state, moduleOutput)).toThrow();
    expect(() => generationCourse(state)).toThrow();
    const plan = structuredClone(planOutput);
    plan.modules.push({ ...plan.modules[0], id: "lab-2", title: "延伸探究" });
    state = advanceGeneration(state, plan);
    expect(generationTask(state)).toMatchObject({ step: "module", module_index: 0 });
    state = advanceGeneration(state, moduleOutput);
    expect(generationTask(state)).toMatchObject({ step: "module", module_index: 1 });
    expect(() => advanceGeneration(state, quizOutput)).toThrow();
    state = advanceGeneration(state, moduleOutput);
    expect(generationStep(state)).toBe("quiz");
    state = advanceGeneration(state, quizOutput);
    expect(generationStep(state)).toBe("review");
    expect(generationTask(state).course).toHaveProperty("scenes.length", 3);
    state = advanceGeneration(state, reviewOutput);
    expect(generationStep(state)).toBe("publish");
    expect(() => advanceGeneration(state, reviewOutput)).toThrow(/publish_course_generation/);
    const course = generationCourse(state);
    expect(course.format).toBe("openmaic-scenes");
  });

  it("格式錯誤不修改草稿；每一步都有可用的 input_schema", () => {
    const state = advanceGeneration(initialState(), planOutput);
    expect(() => advanceGeneration(state, { ...moduleOutput, checks: { ...moduleOutput.checks, reset_works: false } })).toThrow();
    expect(state.modules).toHaveLength(0);
    expect(generationTask(state).input_schema).toHaveProperty("properties.html");
    expect(() => advanceGeneration(state, { ...moduleOutput, html: "<html>static only</html>" })).toThrow(/互動模組/);
  });

  it("修正模組或測驗後必須重新審查", () => {
    const complete = completedState();
    const revised = reviseGeneration(complete, "module", 0, { ...moduleOutput, html: moduleOutput.html.replace("質量", "質量 m") });
    expect(revised.review).toBeNull();
    expect(generationStep(revised)).toBe("review");
    expect(complete.review).not.toBeNull();
    const revisedQuiz = reviseGeneration(complete, "quiz", undefined, quizOutput);
    expect(generationStep(revisedQuiz)).toBe("review");
    expect(() => reviseGeneration(complete, "module", 5, moduleOutput)).toThrow();
    expect(() => reviseGeneration(initialState(), "quiz", undefined, quizOutput)).toThrow();
  });

  it("拒絕重複模組 id 與題號", () => {
    expect(() => advanceGeneration(initialState(), { ...planOutput, modules: [planOutput.modules[0], planOutput.modules[0]] })).toThrow();
    const state = advanceGeneration(advanceGeneration(initialState(), planOutput), moduleOutput);
    const quiz = structuredClone(quizOutput);
    quiz.questions[1].id = quiz.questions[0].id;
    expect(() => advanceGeneration(state, quiz)).toThrow(/題號不可重複/);
  });

  it("每一步帶黑白設計、克制光暈與具體教學品質要求", () => {
    let state = initialState();
    for (const output of [planOutput, moduleOutput, quizOutput, reviewOutput]) {
      const task = generationTask(state);
      expect(task.quality_policy).toBe("study-monochrome/v5");
      expect(task.design_brief.palette).toContain("黑、白、中性灰");
      expect(task.design_brief.glow).toContain("0.04–0.12");
      expect(task.design_brief.accessibility).toContain("4.5:1");
      expect(task.content_brief.assessment).toContain("干擾選項");
      state = advanceGeneration(state, output);
    }
    expect(generationStep(state)).toBe("publish");
  });

  it("精修紀錄須涵蓋內容、動態、版面，並逐一對應事件步驟", () => {
    const state = advanceGeneration(initialState(), planOutput);
    const shallow = structuredClone(moduleOutput);
    shallow.polish_pass.refinements = shallow.polish_pass.refinements.filter((r) => r.area !== "content");
    expect(() => advanceGeneration(state, shallow)).toThrow();
    const missingEvent = structuredClone(moduleOutput);
    missingEvent.polish_pass.event_choreography[0].step_id = "missing";
    expect(() => advanceGeneration(state, missingEvent)).toThrow(/event_choreography/);
    const old = completedState();
    delete old.module_checks[0].polish_pass;
    expect(generationStep(old)).toBe("review");
    expect(generationTask(old).modules_needing_revision).toEqual([0]);
    expect(generationTask(state).motion_brief.timings.max_stagger_ms).toBe(160);
  });

  it("沒有固定模組數上限，超過原本的 6 模組與 40 場景也能完成", () => {
    const plan = structuredClone(planOutput);
    plan.modules = Array.from({ length: 48 }, (_, i) => ({ ...plan.modules[0], id: i ? `lab-${i}` : "lab" }));
    let state = advanceGeneration(initialState(), plan);
    for (const _ of plan.modules) state = advanceGeneration(state, moduleOutput);
    state = advanceGeneration(state, quizOutput);
    state = advanceGeneration(state, reviewOutput);
    expect(generationStep(state)).toBe("publish");
    expect(generationCourse(state)).toHaveProperty("scenes.length", 49);
  });

  it("v4 要求具體互動設計、真實控制項和概念圖，舊草稿必須補齊", () => {
    const state = advanceGeneration(initialState(), planOutput);
    const missing = structuredClone(moduleOutput) as Partial<typeof moduleOutput>;
    delete missing.interaction_design;
    expect(() => advanceGeneration(state, missing)).toThrow(/interaction_design/);
    for (const html of [
      moduleOutput.html.replace('id="visual"', 'data-id="visual"'),
      moduleOutput.html.replace(/<svg[\s\S]*?<\/svg>/, '<output id="visual">2</output>'),
      moduleOutput.html.replace('id="m"', 'data-id="m"'),
    ]) expect(() => advanceGeneration(state, { ...moduleOutput, html })).toThrow(/interaction_design/);
    const unbound = structuredClone(moduleOutput);
    unbound.lesson_steps[1].reveal_on!.selector = "#m-other";
    expect(() => advanceGeneration(state, unbound)).toThrow(/primary_control/);
    const old = completedState();
    delete old.module_checks[0].interaction_design;
    expect(generationTask(old).modules_needing_revision).toEqual([0]);
    expect(() => advanceGeneration(old, reviewOutput)).toThrow(/revise_course_generation/);
  });

  it("允許語意構圖與成功狀態 selector，提示依概念選操作而非固定預測開場", () => {
    const state = advanceGeneration(initialState(), planOutput);
    const constructed = structuredClone(moduleOutput);
    constructed.html = constructed.html.replace('<svg id="visual"', '<figure id = "visual"><svg').replace('</svg>', '</svg></figure>');
    constructed.lesson_steps[1].reveal_on!.selector = '#m[data-correct="true"]';
    expect(advanceGeneration(state, constructed).modules).toHaveLength(1);
    expect(generationTask(state).content_brief.teaching).toContain('不要把「先預測」');
    expect(generationTask(state).interaction_design_requirement).toContain("避免每個模組重複滑桿加讀值");
    expect(generationTask(state).design_brief.module_motion).toContain("reset");
  });

  it("沒有事件或步驟重複的模組不能通過，舊模組須重新產生逐步內容", () => {
    const state = advanceGeneration(initialState(), planOutput);
    const module = structuredClone(moduleOutput);
    delete (module.lesson_steps[1] as { reveal_on?: unknown }).reveal_on;
    expect(() => advanceGeneration(state, module)).toThrow(/reveal_on/);
    const old = completedState();
    if (old.modules[0].type === "interactive") delete old.modules[0].content.lesson_steps;
    expect(generationStep(old)).toBe("review");
    expect(generationTask(old).modules_needing_revision).toEqual([0]);
  });

  it("低分或空泛證據不能過關，且必須逐一對應目標與真實模組/題號", () => {
    const state = advanceGeneration(initialState(), planOutput);
    const low = structuredClone(moduleOutput);
    low.quality_review.visual_design.score = 3;
    expect(() => advanceGeneration(state, low)).toThrow();
    const vague = structuredClone(moduleOutput);
    vague.quality_review.visual_design.evidence = "已確認符合規範";
    expect(() => advanceGeneration(state, vague)).toThrow();
    const reviewing = advanceGeneration(advanceGeneration(state, moduleOutput), quizOutput);
    const review = structuredClone(reviewOutput);
    review.objective_coverage[0].question_ids = ["missing-question"];
    expect(() => advanceGeneration(reviewing, review)).toThrow(/objective_coverage/);
    review.objective_coverage[0].question_ids = ["q1"];
    review.objective_coverage[0].objective = "沒有在規劃內的目標";
    expect(() => advanceGeneration(reviewing, review)).toThrow(/objective_coverage/);
  });

  it("舊草稿須補上新的視覺品質審查才能發布，簡答題須有參考答案", () => {
    const old = completedState();
    delete old.module_checks[0].quality_review;
    expect(generationStep(old)).toBe("review");
    expect(generationTask(old).modules_needing_revision).toEqual([0]);
    expect(() => advanceGeneration(old, reviewOutput)).toThrow(/revise_course_generation/);
    const state = advanceGeneration(advanceGeneration(initialState(), planOutput), moduleOutput);
    const quiz = structuredClone(quizOutput);
    quiz.questions[2].answer = [];
    expect(() => advanceGeneration(state, quiz)).toThrow();
    quiz.questions[2].answer = ["參考答案"];
    quiz.questions[2].analysis = "正確";
    expect(() => advanceGeneration(state, quiz)).toThrow(/解析至少/);
  });
});
