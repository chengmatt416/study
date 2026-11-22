import type { IbResourceMetadata } from "./ib-resources";
import type { BookKind } from "./access";
import type { SyllabusTerm } from "./syllabus";

export interface UploadMetadata extends Partial<IbResourceMetadata> {
  title: string; subject_id?: string; book_id?: string; kind?: BookKind;
  academic_year?: number; semester?: SyllabusTerm["semester"];
}
export const uploadResumeKey = (file: { name: string; size: number; lastModified: number }, meta: UploadMetadata, ownerId: string) =>
  `upload:v2:${JSON.stringify([ownerId, meta.kind ?? "book", meta.book_id ?? "", meta.academic_year ?? null, meta.semester ?? null, meta.subject_id ?? "", meta.title, ...(meta.ib_document_type ? ["ib",meta.ib_document_type,meta.ib_level ?? "both",meta.ib_first_assessment_year ?? null,meta.ib_version ?? ""] : []), file.name, file.size, file.lastModified])}`;

export function matchesLegacyUpload(meta: UploadMetadata, ownerId: string, upload: { book_id: string; created_by: string | null; size_bytes: number }, size: number, book: { id: string; title: string; kind?: BookKind; subject_id: string | null; academic_year?: number | null; semester?: string | null } & Partial<{[K in keyof IbResourceMetadata]:IbResourceMetadata[K]|null}>) {
  return upload.created_by === ownerId && upload.size_bytes === size && upload.book_id === book.id
    && (meta.kind ?? "book") === (book.kind ?? "book")
    && (meta.book_id ? meta.book_id === book.id : meta.title === book.title
      && (meta.subject_id ?? "") === (book.subject_id ?? "")
      && (meta.ib_document_type ?? null) === (book.ib_document_type ?? null) && (meta.ib_level ?? (meta.ib_document_type ? "both" : null)) === (book.ib_level ?? null) && (meta.ib_first_assessment_year ?? null) === (book.ib_first_assessment_year ?? null) && (meta.ib_version ?? "") === (book.ib_version ?? "")
      && (meta.academic_year ?? null) === (book.academic_year ?? null) && (meta.semester ?? null) === (book.semester ?? null));
}
