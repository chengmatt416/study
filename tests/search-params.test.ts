import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeSearchParams } from "../src/web/lib/search-params";

afterEach(() => vi.unstubAllGlobals());

describe("URL filter updates", () => {
  it("builds rapid updates from the latest browser URL", () => {
    const location = { search: "?academic_year=2025" };
    vi.stubGlobal("window", { location });
    location.search = `?${mergeSearchParams({ semester: "2" })}`;
    const next = mergeSearchParams({ q: "歷年" });
    expect(Object.fromEntries(next)).toEqual({ academic_year: "2025", semester: "2", q: "歷年" });
  });

  it("clears only requested filters and retains unrelated URL state", () => {
    vi.stubGlobal("window", { location: { search: "?resume=1&subject_id=physics&q=period" } });
    expect(Object.fromEntries(mergeSearchParams({ subject_id: "" }))).toEqual({ resume: "1", q: "period" });
  });

  it("keeps explicit all-term selections while removing term defaults", () => {
    vi.stubGlobal("window", { location: { search: "?academic_year=2025&semester=2&q=old" } });
    const defaults = { academic_year: "2026", semester: "1", q: "" };
    expect(Object.fromEntries(mergeSearchParams({ academic_year: "", semester: "" }, defaults))).toEqual({ academic_year: "", semester: "", q: "old" });
    expect(Object.fromEntries(mergeSearchParams({ academic_year: "2026", semester: "1", q: "" }, defaults))).toEqual({});
  });
});
