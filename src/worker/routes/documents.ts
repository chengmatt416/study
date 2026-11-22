// 重點整理與試題共用：文件、修訂、原版（baseline）、回復、即時協作入口。
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../lib/types";
import { requireDocumentWrite, resolveCreateVisibility, resolveVisibilityChange } from "../lib/access";
import type { Visibility } from "../../shared/visibility";
import { requireAdmin } from "../lib/auth";
import { bad, now, readJson, slugifyAscii, str, uid } from "../lib/util";
import { audit } from "../lib/audit";
import { assertNotInChapter } from "../lib/chapter-visibility";
import { stripSolutions } from "../../shared/exam";
import courses from "./courses";

export interface DocRow {
  id: string;
  kind: "note" | "exam";
  subject_id: string | null;
  slug: string;
  title: string;
  status: string;
  baseline_revision_id: string | null;
  current_revision_id: string | null;
  answers_revision_id: string | null;
  booklet_id: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  created_by: string | null;
  visibility: Visibility;
  created_at: number;
  updated_at: number;
}

const MAX_MD = 1_500_000; // D1 單列上限約 2MB

export async function getDoc(env: Env, slug: string): Promise<DocRow> {
  const doc = await env.DB.prepare("SELECT * FROM documents WHERE slug = ? OR id = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1").bind(slug, slug, slug).first<DocRow>();
  if (!doc) bad("找不到文件", 404);
  return doc;
}

export async function revisionBody(env: Env, id: string | null): Promise<string> {
  if (!id) return "";
  const r = await env.DB.prepare("SELECT body_md FROM revisions WHERE id = ?").bind(id).first<{ body_md: string }>();
  return r?.body_md ?? "";
}

/** 建立新修訂並設為 current（供 REST 儲存、即時協作自動儲存、匯入、回復共用）。 */
export async function createRevision(
  env: Env,
  doc: Pick<DocRow, "id" | "current_revision_id">,
  body: string,
  opts: { authorId: string | null; message?: string | null; source: "manual" | "autosave" | "import" | "revert" | "baseline"; contributors?: string[] },
): Promise<string> {
  if (body.length > MAX_MD) bad("內容過長", 413);
  const id = uid();
  const t = now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO revisions (id, document_id, parent_id, body_md, author_id, contributors, message, source, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).bind(id, doc.id, doc.current_revision_id, body, opts.authorId, JSON.stringify(opts.contributors ?? (opts.authorId ? [opts.authorId] : [])), opts.message ?? null, opts.source, t),
    env.DB.prepare("UPDATE documents SET current_revision_id = ?, baseline_revision_id=CASE WHEN visibility='private' THEN ? ELSE baseline_revision_id END, updated_at = ? WHERE id = ?").bind(id, id, t, doc.id),
  ]);
  return id;
}

/** 通知即時協作房間：內容被外部改動（回復、匯入）。 */
export async function resetRoom(env: Env, docId: string, body: string, revisionId: string) {
  const stub = env.DOC_ROOM.get(env.DOC_ROOM.idFromName(docId));
  await stub.fetch("https://room/reset", { method: "POST", body: JSON.stringify({ body, revisionId }) });
}

async function uniqueSlug(env: Env, base: string): Promise<string> {
  let slug = base;
  for (let i = 2; await env.DB.prepare("SELECT 1 FROM documents WHERE slug = ?").bind(slug).first(); i++) slug = `${base}-${i}`;
  return slug;
}

const docs = new Hono<AppEnv>();
docs.route("/", courses);

docs.get("/", async (c) => {
  const kind = c.req.query("kind");
  const subject = c.req.query("subject");
  const where: string[] = ["d.status != 'archived'", "NOT EXISTS (SELECT 1 FROM content_organization o WHERE o.user_id=? AND o.content_type='document' AND o.content_id=d.id AND o.archived_at IS NOT NULL)"];
  const vals: unknown[] = [c.get("user").id];
  if (kind) (where.push("d.kind = ?"), vals.push(kind));
  if (subject) (where.push("d.subject_id = ?"), vals.push(subject));
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.kind, d.subject_id, d.slug, d.title, d.status, d.updated_at, d.visibility, d.created_by,
            (d.baseline_revision_id IS NOT d.current_revision_id) AS has_revisions,
            (EXISTS (SELECT 1 FROM note_courses nc WHERE nc.document_id = d.id) OR EXISTS (SELECT 1 FROM long_courses lc JOIN long_course_parts p ON p.course_id=lc.id WHERE lc.document_id=d.id AND p.published_at IS NOT NULL)) AS has_course,
            (SELECT COUNT(*) FROM answer_revisions ar WHERE ar.document_id = d.id AND ar.status = 'pending') AS pending_answers,
            (SELECT MAX(score * 100.0 / NULLIF(max_score,0)) FROM exam_attempts ea WHERE ea.document_id = d.id AND ea.user_id = ? AND ea.submitted_at IS NOT NULL) AS best_pct
       FROM documents d WHERE ${where.join(" AND ")} ORDER BY d.subject_id, d.title`,
  )
    .bind(c.get("user").id, ...vals)
    .all();
  return c.json({ documents: results });
});

docs.post("/", async (c) => {
  const b = await readJson<{ kind: "note" | "exam"; title: string; subject_id?: string; body_md?: string; slug?: string; status?: string; visibility?: Visibility }>(c.req.raw);
  if (b.kind !== "note" && b.kind !== "exam") bad("kind 必須是 note 或 exam");
  const visibility = resolveCreateVisibility(c, b.visibility);
  const title = str(b.title, "title", { max: 200 });
  const body = b.body_md ?? `# ${title}\n`;
  const slug = await uniqueSlug(c.env, slugifyAscii(b.slug || title));
  const id = uid();
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO documents (id, kind, subject_id, slug, title, status, created_by, created_at, updated_at, visibility) VALUES (?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(id, b.kind, b.subject_id || null, slug, title, b.status === "draft" ? "draft" : "published", c.get("user").id, t, t, visibility)
    .run();
  const revId = await createRevision(c.env, { id, current_revision_id: null }, body, { authorId: c.get("user").id, source: "import", message: "建立" });
  // 第一版即為原版
  await c.env.DB.prepare("UPDATE documents SET baseline_revision_id = ? WHERE id = ?").bind(revId, id).run();
  await audit(c.env.DB, c.get("user").id, "document.create", b.kind, id, { title });
  return c.json({ id, slug, visibility });
});

async function contributorsSince(env: Env, doc: DocRow) {
  // 原版之後所有修訂的參與者與時間
  const base = doc.baseline_revision_id
    ? await env.DB.prepare("SELECT created_at FROM revisions WHERE id = ?").bind(doc.baseline_revision_id).first<{ created_at: number }>()
    : null;
  const { results } = await env.DB.prepare(
    "SELECT contributors, created_at FROM revisions WHERE document_id = ? AND created_at > ? ORDER BY created_at",
  )
    .bind(doc.id, base?.created_at ?? 0)
    .all<{ contributors: string; created_at: number }>();
  const ids = new Set<string>();
  for (const r of results) for (const u of JSON.parse(r.contributors || "[]") as string[]) ids.add(u);
  if (!ids.size) return { users: [], revisionCount: 0, lastAt: null };
  const { results: users } = await env.DB.prepare(
    `SELECT id, name, email FROM users WHERE id IN (${[...ids].map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all();
  return { users, revisionCount: results.length, lastAt: results.at(-1)?.created_at ?? null };
}

/**
 * 取得文件內容。
 * view=current（預設，含 baseline 供前端算螢光差異）｜edit（編輯用，含試題解析）
 * 試題在非 edit 檢視時移除 :::solution。
 */
docs.get("/:slug", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const view = c.req.query("view") ?? "current";
  let current = await revisionBody(c.env, doc.current_revision_id);
  let baseline = doc.baseline_revision_id === doc.current_revision_id ? null : await revisionBody(c.env, doc.baseline_revision_id);
  if (doc.kind === "exam" && view !== "edit") {
    current = stripSolutions(current);
    baseline = baseline === null ? null : stripSolutions(baseline);
  }
  const changes = baseline === null ? null : await contributorsSince(c.env, doc);
  return c.json({ document: doc, body: current, baseline, changes });
});

docs.put("/:slug", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const b = await readJson<{ title?: string; subject_id?: string | null; status?: string; booklet_id?: string | null; visibility?: Visibility }>(c.req.raw);
  const t = now();
  if (b.visibility !== undefined) bad("請使用 PUT /api/documents/:slug/visibility 變更可見範圍");
  if (b.status === "archived") bad("請使用刪除功能", 400);
  if (b.booklet_id !== undefined) {
    if (b.booklet_id) {
      const bk = await c.env.DB.prepare("SELECT 1 FROM books WHERE id = ? AND kind = 'booklet'").bind(b.booklet_id).first();
      if (!bk) bad("找不到此資料手冊", 404);
    }
    await c.env.DB.prepare("UPDATE documents SET booklet_id = ?, updated_at = ? WHERE id = ?").bind(b.booklet_id || null, t, doc.id).run();
  }
  await c.env.DB.prepare(
    "UPDATE documents SET title = COALESCE(?, title), subject_id = CASE WHEN ? THEN ? ELSE subject_id END, status = COALESCE(?, status), updated_at = ? WHERE id = ?",
  )
    .bind(
      b.title ? str(b.title, "title", { max: 200 }) : null,
      b.subject_id !== undefined ? 1 : 0,
      b.subject_id || null,
      b.status && ["draft", "published", "archived"].includes(b.status) ? b.status : null,
      t,
      doc.id,
    )
    .run();
  await audit(c.env.DB, c.get("user").id, "document.update", doc.kind, doc.id, b);
  return c.json({ ok: true });
});

/** 建立者一鍵切換私人 ↔ 共享。互動課程、答案、字卡沿用文件的可見範圍；切換後目前版本即為原版（私人內容不需審核）。 */
docs.put("/:slug/visibility", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const b = await readJson<{ visibility?: unknown }>(c.req.raw);
  const next = resolveVisibilityChange(c, doc, b.visibility);
  // A note or exam in a chapter follows the chapter's visibility, so it cannot be changed on its own.
  if (next) await assertNotInChapter(c.env.DB, "document", doc.id);
  if (next) {
    await c.env.DB.prepare("UPDATE documents SET visibility = ?, baseline_revision_id = current_revision_id, updated_at = ? WHERE id = ?").bind(next, now(), doc.id).run();
    await audit(c.env.DB, c.get("user").id, "document.visibility", doc.kind, doc.id, { visibility: next });
  }
  return c.json({ ok: true, visibility: next ?? doc.visibility });
});

/** 刪除：管理員或建立者可移到垃圾桶；管理員可加 ?permanent=1 永久刪除（含修訂與作答紀錄） */
docs.delete("/:slug", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const user = c.get("user");
  if (user.role !== "admin" && doc.created_by !== user.id) bad("只有管理員或建立者可以刪除", 403);
  if (c.req.query("permanent") === "1") {
    if (user.role !== "admin" && !(doc.visibility === "private" && doc.created_by === user.id)) bad("只有管理員或私人內容擁有者可以永久刪除", 403);
    await c.env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(doc.id).run();
    if (doc.visibility !== "private") await audit(c.env.DB, user.id, "document.purge", doc.kind, doc.id, { title: doc.title });
    return c.json({ ok: true, permanent: true });
  }
  await c.env.DB.prepare("UPDATE documents SET status = 'archived', deleted_at = ?, deleted_by = ? WHERE id = ?").bind(now(), user.id, doc.id).run();
  await audit(c.env.DB, user.id, "document.delete", doc.kind, doc.id, { title: doc.title });
  return c.json({ ok: true });
});

docs.post("/:slug/restore", requireAdmin, async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  await c.env.DB.prepare("UPDATE documents SET status = 'published', deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?").bind(now(), doc.id).run();
  await audit(c.env.DB, c.get("user").id, "document.restore", doc.kind, doc.id, { title: doc.title });
  return c.json({ ok: true });
});

docs.get("/:slug/revisions", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.parent_id, r.author_id, r.contributors, r.message, r.source, r.created_at, LENGTH(r.body_md) AS size, u.name AS author_name, u.email AS author_email
       FROM revisions r LEFT JOIN users u ON u.id = r.author_id
      WHERE r.document_id = ? ORDER BY r.created_at DESC LIMIT 300`,
  )
    .bind(doc.id)
    .all();
  return c.json({ revisions: results, baselineId: doc.baseline_revision_id, currentId: doc.current_revision_id });
});

docs.get("/:slug/revisions/:rid", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const r = await c.env.DB.prepare("SELECT * FROM revisions WHERE id = ? AND document_id = ?").bind(c.req.param("rid"), doc.id).first();
  if (!r) bad("找不到修訂", 404);
  return c.json({ revision: r });
});

/** 手動「儲存版本」（附說明）。base_revision_id 不符時回 409（樂觀鎖）。 */
docs.post("/:slug/revisions", async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const b = await readJson<{ body_md: string; base_revision_id?: string | null; message?: string; force?: boolean; reset?: boolean }>(c.req.raw);
  const body = str(b.body_md, "body_md", { max: MAX_MD });
  if (!b.force && b.base_revision_id !== undefined && b.base_revision_id !== doc.current_revision_id) {
    return c.json({ error: "此文件已被其他人更新", current_revision_id: doc.current_revision_id, body: await revisionBody(c.env, doc.current_revision_id) }, 409);
  }
  if (body === (await revisionBody(c.env, doc.current_revision_id))) return c.json({ id: doc.current_revision_id, unchanged: true });
  const id = await createRevision(c.env, doc, body, { authorId: c.get("user").id, message: (b.message ?? "").slice(0, 300) || null, source: "manual" });
  // reset：內容來自編輯器以外（例如 MCP / AI），同步給正在即時編輯的人
  if (b.reset) await resetRoom(c.env, doc.id, body, id);
  else c.executionCtx.waitUntil(c.env.DOC_ROOM.get(c.env.DOC_ROOM.idFromName(doc.id)).fetch("https://room/saved", { method: "POST", body: JSON.stringify({ body, revisionId: id }) }));
  return c.json({ id });
});

/** 管理員：把目前版本（或指定版本）確認為新原版 → 螢光標示消失。 */
docs.post("/:slug/baseline", requireAdmin, async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const b = await readJson<{ revision_id?: string }>(c.req.raw).catch(() => ({}) as { revision_id?: string });
  const rid = b.revision_id ?? doc.current_revision_id;
  const exists = await c.env.DB.prepare("SELECT 1 FROM revisions WHERE id = ? AND document_id = ?").bind(rid, doc.id).first();
  if (!exists) bad("找不到修訂", 404);
  await c.env.DB.prepare("UPDATE documents SET baseline_revision_id = ?, updated_at = ? WHERE id = ?").bind(rid, now(), doc.id).run();
  await audit(c.env.DB, c.get("user").id, "document.baseline", doc.kind, doc.id, { revision_id: rid });
  return c.json({ ok: true });
});

/** 管理員：回復到某一版（產生一筆新修訂，內容等於該版）。 */
docs.post("/:slug/revert", requireAdmin, async (c) => {
  const doc = await getDoc(c.env, c.req.param("slug"));
  const { revision_id } = await readJson<{ revision_id: string }>(c.req.raw);
  const r = await c.env.DB.prepare("SELECT body_md, created_at FROM revisions WHERE id = ? AND document_id = ?")
    .bind(revision_id, doc.id)
    .first<{ body_md: string; created_at: number }>();
  if (!r) bad("找不到修訂", 404);
  const id = await createRevision(c.env, doc, r.body_md, {
    authorId: c.get("user").id,
    source: "revert",
    message: `回復至 ${new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} 的版本`,
  });
  await resetRoom(c.env, doc.id, r.body_md, id);
  await audit(c.env.DB, c.get("user").id, "document.revert", doc.kind, doc.id, { to: revision_id });
  return c.json({ id });
});

/** 即時協作 WebSocket → Durable Object（每份文件一個房間） */
export async function collabUpgrade(c: Context<AppEnv>) {
  if (c.req.header("upgrade") !== "websocket") bad("需要 WebSocket", 400);
  const doc = await getDoc(c.env, c.req.param("slug")!);
  const user = c.get("user");
  if (!await requireDocumentWrite(c.env, user, doc.id)) bad("目前無法編輯這份內容", 403);
  const stub = c.env.DOC_ROOM.get(c.env.DOC_ROOM.idFromName(doc.id));
  const headers = new Headers(c.req.raw.headers);
  headers.set("x-doc-id", doc.id);
  headers.set("x-user-id", user.id);
  headers.set("x-user-name", encodeURIComponent(user.name ?? user.email));
  return stub.fetch(new Request("https://room/connect", { headers }));
}

docs.get("/:slug/collab", collabUpgrade);
docs.get("/:slug/collab/*", collabUpgrade);

export default docs;
