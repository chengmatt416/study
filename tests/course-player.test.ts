import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { CoursePlayer } from "../src/web/features/openmaic/CoursePlayer";
import { generatedCourse } from "./fixtures/course-generation";
import { GuidedModule } from "../src/web/features/openmaic/GuidedModule";

describe("課程播放器 HTML 隔離", () => {
  it("生成課程使用隔離 srcdoc，且保留場景導覽與教學目標", () => {
    const course = generatedCourse();
    if (course.format !== "openmaic-scenes" || course.scenes[0].type !== "interactive") throw new Error("expected interactive");
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GuidedModule, { html: course.scenes[0].content.html, title: course.title, steps: course.scenes[0].content.lesson_steps })));
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain("Content-Security-Policy");
    expect(markup).toContain("connect-src");
    expect(markup).toContain("先預測");
    expect(markup).toContain("study:lesson-sync");
    expect(markup).toContain("has-side-rail");
    expect(markup).toContain('aria-label="目前互動進度"');
    expect(markup).toContain('aria-valuenow="1"');
    // The future side content reserves its column but is not rendered as visible prose yet.
    expect(markup).not.toContain('<aside class="lesson-side-rail" aria-label="逐步課程說明"><article');
    expect(markup).not.toContain("試用");
  });
  it("開始課程前不顯示主教材、模組指令或 iframe", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CoursePlayer, { course: generatedCourse() })));
    expect(markup).toContain("開始課程");
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain("預測質量比變成");
  });
});
