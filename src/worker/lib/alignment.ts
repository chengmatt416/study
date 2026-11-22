import { bookFeature, canAccess } from '../../shared/access';
import { checkSources, type AvailableSource, type BlueprintLevel, type BlueprintSource } from '../../shared/course-blueprint';
import { currentSyllabusTerm } from '../../shared/syllabus';
import { accessRules } from './access';
import type { SessionUser } from './types';
import { VISIBLE_CHAPTER_SQL } from '../routes/chapters';

interface BookRow { id: string; title: string; kind: 'book' | 'syllabus'; ib_document_type: 'syllabus' | 'guideline' | 'mark_scheme' | null; ib_level: 'both' | 'SL' | 'HL' | null; academic_year: number | null; semester: string | null }
const IB_KIND = { syllabus: 'ib_syllabus', guideline: 'ib_guide', mark_scheme: 'ib_markscheme' } as const;

/**
 * Documents a course or exam for this subject may cite: the ebooks of the subject, every IB reference document (they are not split by subject) and the school syllabus of the current term
 * that the user can read. Anything else (another subject, an old term, a document the user's group cannot open) is not citable.
 */
export async function citableSources(env: Env, user: SessionUser, subjectId: string | null, chapterId?: string | null): Promise<AvailableSource[]> {
  const rules = await accessRules(env, user);
  const term = currentSyllabusTerm();
  const { results } = await env.DB.prepare("SELECT id,title,kind,ib_document_type,ib_level,academic_year,semester FROM books WHERE status='ready' AND kind IN ('book','syllabus') AND (ib_document_type IS NOT NULL OR subject_id=?)").bind(subjectId).all<BookRow>();
  const out: AvailableSource[] = [];
  for (const book of results) {
    if (!canAccess(rules, bookFeature(book.kind), 'book', book.id)) continue;
    if (book.kind === 'book') out.push({ id: book.id, title: book.title, kind: 'ebook', ib_level: null });
    else if (book.ib_document_type) out.push({ id: book.id, title: book.title, kind: IB_KIND[book.ib_document_type], ib_level: book.ib_level });
    else if (book.academic_year === term.academic_year && book.semester === term.semester) out.push({ id: book.id, title: book.title, kind: 'school_syllabus', ib_level: null });
  }
  // Chapter uploads of this subject are citable; the ones of the chapter being planned must be used.
  const materials = await env.DB.prepare(`SELECT m.id,m.filename,m.topic_id FROM chapter_materials m JOIN topics t ON t.id=m.topic_id WHERE ${VISIBLE_CHAPTER_SQL} AND (t.subject_id=? OR t.id=?)`).bind(user.id, subjectId, chapterId ?? null).all<{ id: string; filename: string; topic_id: string }>();
  for (const m of materials.results) out.push({ id: m.id, title: m.filename, kind: 'chapter_material', ib_level: null, required: !!chapterId && m.topic_id === chapterId });
  return out;
}

/** Errors for a plan whose cited documents do not hold up against the database. */
export async function sourceProblems(env: Env, user: SessionUser, subjectId: string | null, cited: BlueprintSource[], exemptions: { kind: BlueprintSource['kind'] }[], level: BlueprintLevel, chapterId?: string | null) {
  return checkSources(cited, exemptions, level, await citableSources(env, user, subjectId, chapterId));
}
