import { z } from "zod";

/** 1 = 週一 … 7 = 週日 */
export const WEEKDAYS = ["", "週一", "週二", "週三", "週四", "週五", "週六", "週日"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const endAfterStart = (e: { start: string; end: string }) => e.end > e.start;
export const timetableFields = {
  day: z.number().int().min(1).max(7),
  start: z.string().regex(TIME),
  end: z.string().regex(TIME),
  title: z.string().trim().min(1).max(80),
  room: z.string().trim().max(40).nullish().transform((v) => v || undefined),
  subject_id: z.string().max(64).nullish().transform((v) => v || null),
};
export const timetableDraftSchema = z.object(timetableFields).refine(endAfterStart, { path: ["end"], message: "結束時間必須晚於開始時間" });
export const timetableEntrySchema = z.object({ id: z.string().min(1).max(64), ...timetableFields }).refine(endAfterStart, { path: ["end"], message: "結束時間必須晚於開始時間" });
/** PUT／MCP 修改：只提供要改的欄位，伺服器合併後再整體驗證。 */
export const timetablePatchSchema = z.object(timetableFields).partial();
export type TimetableEntry = z.infer<typeof timetableEntrySchema>;
export type TimetableDraft = z.infer<typeof timetableDraftSchema>;
export const MAX_TIMETABLE_ENTRIES = 200;

export const byTime = (a: TimetableEntry, b: TimetableEntry) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title);

export function entriesForDay(entries: TimetableEntry[], day: number) {
  return entries.filter((e) => e.day === day).sort(byTime);
}

/** 同一天內時間區段重疊（頭尾相接不算）。 */
export function conflictsWith(entries: TimetableEntry[], draft: TimetableDraft, ignoreId?: string) {
  return entries.filter((e) => e.id !== ignoreId && e.day === draft.day && e.start < draft.end && draft.start < e.end);
}

/** 週一為 1；以 UTC+8 判斷，與學期預設一致。 */
export function todayWeekday(date = new Date()) {
  const day = new Date(date.getTime() + 8 * 3600000).getUTCDay();
  return day === 0 ? 7 : day;
}

/** 週末沒有課時只顯示週一至週五。 */
export function visibleDays(entries: TimetableEntry[]) {
  return entries.some((e) => e.day > 5) ? [1, 2, 3, 4, 5, 6, 7].filter((d) => d <= 5 || entries.some((e) => e.day === d)) : [1, 2, 3, 4, 5];
}
