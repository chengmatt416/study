import { describe, expect, it } from "vitest";
import { buildCoursePrompt, gradeCourseQuestion, MAX_COURSE_BYTES, sandboxCourseHtml, validateCourse } from "../src/shared/openmaic";
import { openMaicGuide } from "../src/shared/course-generation";
import { BLUEPRINT_GUIDE } from "../src/shared/course-blueprint";
import { generatedCourse } from "./fixtures/course-generation";

const generated = () => generatedCourse();

describe("OpenMAIC 相容課程", () => {
  it("逐步生成的課程可驗證且包含互動模組與三種測驗", () => {
    const v = validateCourse(generated());
    expect(v.ok).toBe(true);
    if (!v.ok || v.course.format !== "openmaic-scenes") throw new Error("invalid example");
    expect(v.course.scenes.map((s) => s.type)).toEqual(["interactive", "quiz"]);
    expect(v.course.scenes[0].content).toHaveProperty("html", expect.stringContaining('id="m"'));
  });

  it("接受原生 manifest 的互動/測驗場景，依 order 排序", () => {
    const course = generated();
    if (course.format !== "openmaic-scenes") throw new Error("invalid example");
    const v = validateCourse({ formatVersion: 1, stage: { name: course.title, description: course.description }, scenes: course.scenes.toReversed() });
    expect(v.ok).toBe(true);
    if (v.ok && v.course.format === "openmaic-scenes") expect(v.course.scenes[0].order).toBe(0);
    expect(validateCourse({ formatVersion: 2 }).ok).toBe(false);
  });

  it("原生 slide / pbl 不會被靜默丟棄，改走完整 HTML 匯入", () => {
    expect(validateCourse({ formatVersion: 1, stage: { name: "Native" }, scenes: [{ type: "slide", title: "Slide", order: 0, content: { type: "slide", canvas: {} } }] }).ok).toBe(false);
    expect(validateCourse({ schema: "study-openmaic/v1", format: "openmaic-html", title: "完整課程", html: "<!doctype html><html><body><script>window.lesson = true</script></body></html>" }).ok).toBe(true);
  });

  it("拒絕空白課程、遠端 iframe、重複順序與題號、錯誤答案", () => {
    const c = generated();
    if (c.format !== "openmaic-scenes") throw new Error("invalid example");
    const lab = c.scenes[0];
    const quiz = c.scenes[1];
    if (lab.type !== "interactive" || quiz.type !== "quiz") throw new Error("invalid scenes");
    expect(validateCourse({ ...c, title: " " }).ok).toBe(false);
    expect(validateCourse({ ...c, scenes: [] }).ok).toBe(false);
    const noHtml = structuredClone(c);
    Object.assign(noHtml.scenes[0].content, { html: undefined, url: "https://example.com" });
    expect(validateCourse(noHtml).ok).toBe(false);
    c.scenes[1].order = 0;
    expect(validateCourse(c)).toMatchObject({ ok: false, errors: ["場景 order 不可重複"] });
    c.scenes[1].order = 1;
    quiz.content.questions[1].id = "q1";
    expect(validateCourse(c).ok).toBe(false);
    quiz.content.questions[1].id = "q2";
    quiz.content.questions[0].answer = ["Z"];
    expect(validateCourse(c).ok).toBe(false);
    quiz.content.questions[0].answer = ["A", "B"];
    expect(validateCourse(c).ok).toBe(false);
    quiz.content.questions[0].answer = ["B"];
    quiz.content.questions[0].options![1].value = "A";
    expect(validateCourse(c).ok).toBe(false);
  });

  it("以 UTF-8 bytes 檢查大小，而非只檢查字元數", () => {
    expect(validateCourse("{".repeat(MAX_COURSE_BYTES + 1))).toMatchObject({ ok: false, errors: ["課程超出 950 KB 上限"] });
    expect(validateCourse({ schema: "study-openmaic/v1", format: "openmaic-html", title: "大課程", html: `<html>${"學".repeat(330_000)}</html>` }).ok).toBe(false);
    expect(validateCourse("not json").ok).toBe(false);
    expect(validateCourse(null).ok).toBe(false);
  });

  it("隔離 HTML 保留互動程式且把限制網路的 CSP 放在匯入內容之前", () => {
    const input = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body><script>run()</script></body></html>';
    const safe = sandboxCourseHtml(input);
    expect(safe.indexOf("connect-src 'none'")).toBeLessThan(safe.indexOf("default-src *"));
    expect(safe).toContain("script-src 'unsafe-inline' 'unsafe-eval' data: blob:");
    expect(safe).toContain(input);
  });

  it("測驗精確比對單/複選，簡答只給參考解析", () => {
    const c = generated();
    if (c.format !== "openmaic-scenes" || c.scenes[1].type !== "quiz") throw new Error("invalid quiz");
    const [single, multiple, short] = c.scenes[1].content.questions;
    expect(gradeCourseQuestion(single, ["A"])).toBe(true);
    expect(gradeCourseQuestion(single, ["B"])).toBe(false);
    expect(gradeCourseQuestion(multiple, ["B", "A"])).toBe(true);
    expect(gradeCourseQuestion(multiple, ["A"])).toBe(false);
    expect(gradeCourseQuestion(multiple, ["A", "A"])).toBe(false);
    expect(gradeCourseQuestion(short, ["任意答案"])).toBeNull();
  });

  it("指令涵蓋免 key、既有筆記、驗證儲存與品質規範", () => {
    const prompt = buildCoursePrompt("化學平衡", "chem-equilibrium");
    for (const part of ["化學平衡", "chem-equilibrium", "start_course_generation", "submit_course_generation_step", "publish_course_generation", "API key", "鍵盤", "重設"]) expect(prompt).toContain(part);
    expect(buildCoursePrompt("新主題")).toContain("list_documents");
    expect(buildCoursePrompt("新主題")).not.toContain("先 create_note");
    expect(BLUEPRINT_GUIDE).toContain("不另存成重點整理");
    expect(openMaicGuide()).not.toContain("或 create_note 建立筆記");
    expect(openMaicGuide()).toContain("expected_version");
  });
});
