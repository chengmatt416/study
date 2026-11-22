import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ReviewCard } from "../src/web/pages/Review";

const render = (flipped: boolean) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReviewCard, { front: "Question text", back: "Secret answer", flipped, disabled: false, onReveal: () => undefined, onRate: () => undefined })));
describe("字卡揭曉", () => {
  it("揭曉前不渲染答案，避免讀屏與搜尋提前透露", () => {
    expect(render(false)).toContain('aria-label="題目"');
    expect(render(false)).not.toContain("Secret answer");
  });
  it("揭曉後保留題目脈絡及 Markdown 答案", () => {
    const markup = render(true);
    expect(markup).toContain("Question text");
    expect(markup).toContain("Secret answer");
    expect(markup).toContain('aria-label="答案"');
  });
});
