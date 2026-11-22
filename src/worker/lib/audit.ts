import { now, uid } from "./util";

export async function audit(db: D1Database, actorId: string | null, action: string, entity: string, entityId: string | null, meta?: unknown) {
  if (entityId && ["note", "exam", "document", "deck"].includes(entity)) {
    const table = entity === "deck" ? "decks" : "documents";
    if (await db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND visibility='private'`).bind(entityId).first()) return;
  }
  await db
    .prepare("INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta_json, created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(uid(), actorId, action, entity, entityId, meta === undefined ? null : JSON.stringify(meta), now())
    .run();
}
