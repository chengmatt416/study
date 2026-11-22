import { describe, expect, it } from "vitest";
import { nextAssessment } from "../src/shared/assessment-schedule";

describe("the learner's next assessment", () => {
  const today = "2026-11-05";
  const assessment = (id: string, start_date: string | null, end_date: string | null = null) => ({ id, start_date, end_date });
  it("chooses the closest future assessment when the API returns newest dates first", () => {
    const list = [assessment("later", "2027-01-06", "2027-01-08"), assessment("next", "2026-11-09", "2026-11-10")];
    expect(nextAssessment(list, today)?.id).toBe("next");
    expect(list.map(item => item.id)).toEqual(["later", "next"]);
  });
  it("keeps an assessment in progress ahead of future ones and excludes expired single-day assessments", () => {
    expect(nextAssessment([assessment("expired", "2026-11-04"), assessment("future", "2026-11-06"), assessment("current", "2026-11-03", "2026-11-05")], today)?.id).toBe("current");
    expect(nextAssessment([assessment("expired", "2026-11-04")], today)).toBeUndefined();
  });
  it("puts undated assessments after scheduled ones without losing undated scopes", () => {
    expect(nextAssessment([assessment("undated", null), assessment("scheduled", "2026-11-10")], today)?.id).toBe("scheduled");
    expect(nextAssessment([assessment("undated", null)], today)?.id).toBe("undated");
    expect(nextAssessment([], today)).toBeUndefined();
  });
  it("uses the closest end date when two assessments are already in progress", () => {
    expect(nextAssessment([assessment("long", "2026-11-01", "2026-11-10"), assessment("soon", "2026-11-04", "2026-11-06")], today)?.id).toBe("soon");
  });
});
