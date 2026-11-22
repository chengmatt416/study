// A chapter's visibility decides the visibility of the notes, exams and decks its owner put in it.
// Only what the chapter's owner created follows the chapter; other people's content keeps its own setting.
// A piece of content that sits in a shared chapter stays shared, so it can't be made private from its own page or
// by a chapter that goes private while it is still in a shared one.
import { bad } from "./util";
import type { Visibility } from "../../shared/visibility";

export type ContentType = "document" | "deck";

export interface ChapterItem {
  type: ContentType;
  id: string;
  kind: "note" | "exam" | "deck";
  title: string;
  visibility: Visibility;
  created_by: string | null;
}

/** The content in one chapter that `userId` created (archived notes and exams are not part of a chapter any more). */
export async function ownedInChapter(db: D1Database, topicId: string, userId: string): Promise<ChapterItem[]> {
  const { results } = await db.prepare(`SELECT l.content_type AS type, l.content_id AS id, COALESCE(d.kind,'deck') AS kind,
      COALESCE(d.title,k.title) AS title, COALESCE(d.visibility,k.visibility) AS visibility, COALESCE(d.created_by,k.created_by) AS created_by
    FROM content_links l
    LEFT JOIN documents d ON l.content_type='document' AND d.id=l.content_id
    LEFT JOIN decks k ON l.content_type='deck' AND k.id=l.content_id
    WHERE l.topic_id=? AND COALESCE(d.created_by,k.created_by)=? AND COALESCE(d.status,'published')<>'archived'`)
    .bind(topicId, userId).all<ChapterItem & { type: ContentType }>();
  return results.map((row) => ({ ...row, visibility: row.visibility as Visibility }));
}

/** Titles of the other shared chapters that contain this item. */
export async function otherSharedChapters(db: D1Database, type: ContentType, id: string, exceptTopicId: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT t.title FROM content_links l JOIN topics t ON t.id=l.topic_id
    WHERE l.content_type=? AND l.content_id=? AND l.topic_id<>? AND t.visibility='shared' ORDER BY t.title`).bind(type, id, exceptTopicId).all<{ title: string }>();
  return results.map((row) => row.title);
}

/** Every chapter that contains this item, for the message when its own page tries to change its visibility. */
export async function chaptersContaining(db: D1Database, type: ContentType, id: string): Promise<string[]> {
  const { results } = await db.prepare(`SELECT t.title FROM content_links l JOIN topics t ON t.id=l.topic_id
    WHERE l.content_type=? AND l.content_id=? ORDER BY t.title`).bind(type, id).all<{ title: string }>();
  return results.map((row) => row.title);
}

/** Changes one item's visibility with the same statements its own visibility route runs. */
export function setItemVisibility(db: D1Database, item: Pick<ChapterItem, "type" | "id">, visibility: Visibility, at: number): D1PreparedStatement[] {
  return item.type === "document"
    ? [db.prepare("UPDATE documents SET visibility = ?, baseline_revision_id = current_revision_id, updated_at = ? WHERE id = ?").bind(visibility, at, item.id)]
    : [
      db.prepare("UPDATE decks SET visibility = ?, updated_at = ? WHERE id = ?").bind(visibility, at, item.id),
      db.prepare("UPDATE cards SET baseline_front = front, baseline_back = back WHERE deck_id = ? AND deleted_at IS NULL").bind(item.id),
    ];
}

/** The item's own visibility cannot change while a chapter holds it: the chapter decides. */
export async function assertNotInChapter(db: D1Database, type: ContentType, id: string) {
  const titles = await chaptersContaining(db, type, id);
  if (titles.length) bad(`這份內容在章節「${titles[0]}」中，可見範圍跟隨章節。請先從章節移出，或到章節改公開／私人設定`, 409, { chapters: titles });
}

/** Moving a chapter to private must not hide content that other shared chapters still show. */
export async function assertCanGoPrivate(db: D1Database, items: ChapterItem[], topicId: string) {
  const stuck: { title: string; chapter: string }[] = [];
  for (const item of items) {
    const [chapter] = await otherSharedChapters(db, item.type, item.id, topicId);
    if (chapter) stuck.push({ title: item.title, chapter });
  }
  if (stuck.length) bad(`這些內容也在其他公共章節裡，不能跟著改成私人：${stuck.map((s) => `「${s.title}」（${s.chapter}）`).join("、")}。請先從那些章節移出`, 409, { content: stuck });
}
