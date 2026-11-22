import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExamPaneToggle, ExamSplitHandle, ExamStage } from "../src/web/features/exam/ExamStage";

describe("shared exam and writing panes", () => {
  it("puts the adjustable divider between the passage and answer only in split mode", () => {
    const stageRef = createRef<HTMLDivElement>();
    const answer = createElement("main", { className: "exam-deck" }, "Answer");
    const passage = createElement("aside", { className: "exam-passage-pane" }, "Prompt");
    const split = renderToStaticMarkup(createElement(ExamStage, { stageRef, passage, children: answer }));
    expect(split).toContain("--split:48%");
    expect(split).toMatch(/Prompt<\/aside><div[^>]*role="separator"[^>]*aria-valuemin="30"[^>]*aria-valuemax="70"[^>]*aria-valuenow="48"[^>]*><\/div><main[^>]*>Answer/);
    const single = renderToStaticMarkup(createElement(ExamStage, { stageRef, children: answer }));
    expect(single).toContain("Answer");
    expect(single).not.toContain('role="separator"');
  });

  it("shows the active mobile pane using the activity's labels", () => {
    const html = renderToStaticMarkup(createElement(ExamPaneToggle, {
      view: "passage", passageLabel: "題目與圈註", answerLabel: "批改", onChange: () => {},
    }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*題目與圈註<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>.*批改<\/button>/);
  });

  it("offers the same adjustable separator for the scratchpad with its own label and ratio", () => {
    const html = renderToStaticMarkup(createElement(ExamSplitHandle, {
      container: createRef<HTMLDivElement>(), split: 60, save: () => {}, preview: () => {}, initial: 50,
      label: "調整題目與書寫板欄寬度", className: "exam-scratch-divider",
    }));
    expect(html).toMatch(/exam-scratch-divider[^>]+role="separator"[^>]+aria-label="調整題目與書寫板欄寬度"[^>]+aria-valuenow="60"/);
  });
});
