export type ContentType = "document" | "book" | "deck";
export interface ContentItem {
  id: string;
  type: ContentType;
  kind: "note" | "exam" | "book" | "booklet" | "syllabus" | "deck";
  title: string;
  slug: string | null;
  subject_id: string | null;
  updated_at: number;
  folder_id: string | null;
  archived_at: number | null;
  starred: boolean;
  has_course: boolean;
  /** Whether this account may delete it (documents go to the trash; decks and books are deleted). */
  can_delete: boolean;
  url: string;
}
export interface ContentFolder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  item_count: number;
  child_count: number;
}
