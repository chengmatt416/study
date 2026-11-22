export const FEATURES = { shared_write: "共享內容寫入", ebooks: "電子書", booklets: "資料手冊", syllabi: "課綱／IB 科目文件", notes: "重點整理與互動課程", exams: "模擬試題", writing: "寫作練習", decks: "字卡", tools: "數學工具", ai: "AI / MCP" } as const;
export type Feature = keyof typeof FEATURES;
export type ResourceType = "feature" | "book" | "document" | "deck";
export interface AccessRule { group_id: string; resource_type: ResourceType; resource_id: string; allowed: number }
export interface AccessResource { type: Exclude<ResourceType, "feature">; id: string; feature: Feature; slug?: string; title?: string; visibility?: "shared" | "private"; owner_id?: string | null }

/** Specific content overrides its group's feature default; a denial from any other group still wins. */
export function canAccess(rules: AccessRule[], feature: Feature, type?: ResourceType, id?: string): boolean {
  const groups = new Set(rules.map((r) => r.group_id));
  for (const group of groups) {
    const specific = type && id ? rules.find((r) => r.group_id === group && r.resource_type === type && r.resource_id === id) : undefined;
    const rule = specific ?? rules.find((r) => r.group_id === group && r.resource_type === "feature" && r.resource_id === feature);
    if (rule?.allowed === 0) return false;
  }
  return true;
}

export function accessibleFeatures(rules: AccessRule[], resources: AccessResource[]): Record<Feature, boolean> {
  return Object.fromEntries(Object.keys(FEATURES).map((f) => [f, canAccess(rules, f as Feature) || resources.some((r) => r.feature === f && canAccess(rules, r.feature, r.type, r.id))])) as Record<Feature, boolean>;
}

/** `chapter`: a chapter's uploaded PDF, read in the ebook reader; it takes its chapter's visibility and never shows in the library. */
export type BookKind = "book" | "booklet" | "syllabus" | "chapter";
export const bookFeature = (kind: string): Feature => kind === "syllabus" ? "syllabi" : kind === "booklet" ? "booklets" : "ebooks";
