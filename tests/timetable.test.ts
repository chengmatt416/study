import { describe, expect, it } from "vitest";
import { conflictsWith, entriesForDay, timetableEntrySchema, todayWeekday, visibleDays, type TimetableEntry } from "../src/shared/timetable";

const entry = (over: Partial<TimetableEntry>): TimetableEntry => ({ id: "a", day: 1, start: "09:00", end: "09:50", title: "數學", ...over });

describe("timetable", () => {
  it("rejects invalid times and end before start", () => {
    expect(timetableEntrySchema.safeParse(entry({ start: "9:00" })).success).toBe(false);
    expect(timetableEntrySchema.safeParse(entry({ end: "09:00" })).success).toBe(false);
    expect(timetableEntrySchema.safeParse(entry({ title: "  " })).success).toBe(false);
    expect(timetableEntrySchema.safeParse(entry({})).success).toBe(true);
  });

  it("detects overlaps on the same day only, treating touching ranges as free", () => {
    const list = [entry({ id: "a" }), entry({ id: "b", day: 2 })];
    expect(conflictsWith(list, { day: 1, start: "09:30", end: "10:20", title: "x" })).toHaveLength(1);
    expect(conflictsWith(list, { day: 1, start: "09:50", end: "10:40", title: "x" })).toHaveLength(0);
    expect(conflictsWith(list, { day: 3, start: "09:00", end: "09:50", title: "x" })).toHaveLength(0);
    expect(conflictsWith(list, { day: 1, start: "09:00", end: "09:50", title: "x" }, "a")).toHaveLength(0);
  });

  it("sorts a day by start time and shows weekends only when used", () => {
    const list = [entry({ id: "late", start: "13:00", end: "13:50" }), entry({ id: "early" }), entry({ id: "sat", day: 6 })];
    expect(entriesForDay(list, 1).map((e) => e.id)).toEqual(["early", "late"]);
    expect(visibleDays(list.slice(0, 2))).toEqual([1, 2, 3, 4, 5]);
    expect(visibleDays(list)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("uses a Monday-based UTC+8 weekday", () => {
    expect(todayWeekday(new Date("2026-11-01T00:00:00Z"))).toBe(7); // Sunday
    expect(todayWeekday(new Date("2026-11-01T17:00:00Z"))).toBe(1); // Monday 01:00 in UTC+8
  });
});
