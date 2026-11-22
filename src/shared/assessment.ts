import { z } from "zod";

export const assessmentScopePatchSchema = z.object({
  coverage_md: z.string().max(20000).optional().describe("本科段考範圍 Markdown；空字串可清空，省略保留原值"),
  has_exam: z.boolean().optional().describe("本科是否有段考；省略保留原值"),
  exam_date: z.iso.date().nullable().optional().describe("本科考試日期 YYYY-MM-DD；null 清空，省略保留原值"),
}).refine((patch) => Object.values(patch).some((value) => value !== undefined), "至少提供 coverage_md、has_exam 或 exam_date 一項");
