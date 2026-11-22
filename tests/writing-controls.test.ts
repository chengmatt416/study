import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WritingControls } from "../src/web/features/writing/WritingControls";

describe("writing controls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([[null, "00:00"], ["NaN", "00:00"], ["65055", "01:05"]])(
    "renders saved time %s as %s",
    (stored, time) => {
      const getItem = vi.fn(() => stored);
      vi.stubGlobal("sessionStorage", { getItem });
      const html = renderToStaticMarkup(createElement(WritingControls, { storageKey: "writing:user:practice:elapsed", running: true }));
      expect(getItem).toHaveBeenCalledWith("writing:user:practice:elapsed");
      expect(html).toContain('role="timer" aria-label="累計作答時間"');
      expect(html).toContain(`</svg>${time}</span>`);
      expect(html).toContain('aria-label="全螢幕作答"');
    },
  );
});
