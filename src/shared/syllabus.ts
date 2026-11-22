import { z } from "zod";

export const SEMESTERS = { "1": "上學期", "2": "下學期", summer: "暑期" } as const;
export type Semester = keyof typeof SEMESTERS;
export const syllabusTermSchema = z.object({
  academic_year: z.number().int().min(1900).max(2200),
  semester: z.enum(["1", "2", "summer"]),
});
export type SyllabusTerm = z.infer<typeof syllabusTermSchema>;

/** An editable August academic-year default, rather than a school-specific calendar. */
export function currentSyllabusTerm(date = new Date()): SyllabusTerm {
  const local = new Date(date.getTime() + 8 * 3600000);
  const month = local.getUTCMonth() + 1;
  return { academic_year: local.getUTCFullYear() - (month < 8 ? 1 : 0), semester: month >= 8 || month === 1 ? "1" : "2" };
}
export const academicYearLabel = (year: number) => `${year}–${year + 1}`;
