import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NoteCoursePanel } from "../src/web/features/openmaic/NoteCoursePanel";
import { generatedCourse } from "./fixtures/course-generation";

describe("已發布課程介面", () => {
  it("顯示學習入口，預設隱藏 MCP 生成指令與匯入管理", () => {
    const client = new QueryClient();
    client.setQueryData(["note-course", "physics"], { course: generatedCourse(), version: 1, updated_at: 1 });
    client.setQueryData(["course-generations", "physics"], { generations: [] });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(NoteCoursePanel, { slug: "physics", title: "Physics" }))));
    expect(html).toContain("開始課程");
    expect(html).toContain("更新或管理課程");
    expect(html).not.toContain("複製課程生成指令");
    expect(html).not.toContain("課程檔案");
    client.clear();
  });
});
