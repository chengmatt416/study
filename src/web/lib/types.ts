export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: "admin" | "member";
  access?: { features: Record<import("../../shared/access").Feature, boolean>; defaults: Record<import("../../shared/access").Feature, boolean>; denied: { type: string; id: string; slug?: string }[] };
}

export interface Subject {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  sort: number;
  practice_scale: import("../../shared/practice").PracticeScale;
}

export interface Book {
  ib_document_type?: import("../../shared/ib-resources").IbDocumentType | null;
  ib_level?: "SL"|"HL"|"both"|null;
  ib_first_assessment_year?:number|null;
  ib_version?:string|null;
  id: string;
  title: string;
  kind?: import("../../shared/access").BookKind;
  academic_year?: number | null;
  semester?: import("../../shared/syllabus").Semester | null;
  subject_id: string | null;
  size_bytes: number;
  page_count: number | null;
  page_offset: number;
  has_text_layer: number | null;
  status: string;
  has_cover: number;
  updated_at: number;
  last_page: number | null;
}

export interface DocSummary {
  visibility?: import("../../shared/visibility").Visibility;
  created_by?: string | null;
  id: string;
  kind: "note" | "exam";
  subject_id: string | null;
  slug: string;
  title: string;
  status: string;
  updated_at: number;
  has_revisions: number;
  has_course?: number;
  pending_answers: number;
  best_pct: number | null;
}

export interface DocDetail {
  document: DocSummary & {
    baseline_revision_id: string | null;
    current_revision_id: string | null;
    answers_revision_id: string | null;
    booklet_id: string | null;
    created_by: string | null;
    deleted_at: number | null;
  };
  body: string;
  baseline: string | null;
  changes: { users: { id: string; name: string; email: string }[]; revisionCount: number; lastAt: number | null } | null;
}

export interface DeckSummary {
  visibility?: import("../../shared/visibility").Visibility;
  created_by?: string | null;
  id: string;
  title: string;
  subject_id: string | null;
  description: string | null;
  source_type: string;
  last_synced_at: number | null;
  total: number;
  due: number;
  new_count: number;
  changed: number;
}

export interface Card {
  id: string;
  ord: number;
  front: string;
  back: string;
  baseline_front: string | null;
  baseline_back: string | null;
  updated_at: number;
  deleted_at: number | null;
  updated_by_name: string | null;
  due: number | null;
  state: number | null;
  reps: number | null;
  lapses: number | null;
}
