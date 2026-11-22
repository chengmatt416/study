import type { Context, MiddlewareHandler } from "hono";
import { FEATURES, accessibleFeatures, bookFeature, canAccess, type AccessResource, type AccessRule, type Feature, type ResourceType } from "../../shared/access";
import type { AppEnv, SessionUser } from "./types";
import { visibleTo, writableBy, type Visibility } from "../../shared/visibility";
import { bad, readJson } from "./util";

export async function accessCatalog(env: Env): Promise<AccessResource[]> {
  const [books, docs, decks] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT b.id, b.title, b.kind, t.visibility AS visibility, t.created_by AS owner_id FROM books b LEFT JOIN chapter_materials m ON m.book_id = b.id LEFT JOIN topics t ON t.id = m.topic_id"),
    env.DB.prepare("SELECT id, title, kind, slug, visibility, created_by FROM documents"),
    env.DB.prepare("SELECT id, title, visibility, created_by FROM decks"),
  ]);
  return [
    ...books.results.map((b) => ({
      type: "book" as const, id: String(b.id), title: String(b.title), feature: bookFeature(String(b.kind)),
      // A chapter's PDF is visible exactly when its chapter is (a missing chapter hides it).
      ...(String(b.kind) === "chapter" ? { visibility: (b.visibility as Visibility | null) ?? "private", owner_id: (b.owner_id as string | null) ?? null } : {}),
    })),
    ...docs.results.map((d) => ({ type: "document" as const, id: String(d.id), title: String(d.title), slug: String(d.slug), visibility: d.visibility as Visibility, owner_id: d.created_by as string | null, feature: d.kind === "exam" ? "exams" as const : "notes" as const })),
    ...decks.results.map((d) => ({ type: "deck" as const, id: String(d.id), title: String(d.title), visibility: d.visibility as Visibility, owner_id: d.created_by as string | null, feature: "decks" as const })),
  ];
}

export async function accessRules(env: Env, user: SessionUser): Promise<AccessRule[]> {
  if (user.role === "admin") return [];
  const { results } = await env.DB.prepare("SELECT r.* FROM access_rules r JOIN access_group_members m ON m.group_id = r.group_id WHERE m.email = ?")
    .bind(user.email.toLowerCase()).all<AccessRule>();
  return results;
}

export async function requireDocumentAccess(env: Env, user: SessionUser, id: string): Promise<boolean> {
  const doc = await env.DB.prepare("SELECT kind,visibility,created_by FROM documents WHERE id = ? AND status != 'archived'").bind(id).first<{ kind: string; visibility: Visibility; created_by: string | null }>();
  return !!doc && visibleTo({ visibility: doc.visibility, owner_id: doc.created_by }, user.id) && canAccess(await accessRules(env, user), doc.kind === "exam" ? "exams" : "notes", "document", id);
}

export const enforceAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const rules = await accessRules(c.env, c.get("user"));
  const user = c.get("user");
  const canSharedWrite = canAccess(rules, "shared_write");
  c.set("canSharedWrite", canSharedWrite);
  c.set("accessRules", rules);
  const path = c.req.path.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [section, id, child] = path;
  if (section === "practice") {
    await next();
    c.header("cache-control", "no-store");
    return;
  }
  const resources = await accessCatalog(c.env);
  const allowed = (r: AccessResource) => visibleTo(r, user.id) && canAccess(rules, r.feature, r.type, r.id);
  const check = (type: ResourceType, id: unknown) => {
    if (id !== undefined && id !== null && typeof id !== "string") bad("內容識別碼必須是字串");
    const resource = resources.find((r) => r.type === type && r.id === id) ?? resources.find((r) => r.type === type && r.slug === id);
    if (resource && !visibleTo(resource, user.id)) bad("找不到此內容", 404);
    if (resource && !allowed(resource)) bad("你的使用者群組無權存取此內容", 403);
  };
  const feature = (f: Feature) => { if (!canAccess(rules, f)) bad("你的使用者群組未開放此功能", 403); };
  c.set("accessResources", resources);
  let body: Record<string, unknown> = {};
  if (["POST", "PUT"].includes(c.req.method) && (c.req.header("content-type") ?? "").includes("application/json")) {
    const value = await readJson<unknown>(c.req.raw.clone());
    if (value && typeof value === "object" && !Array.isArray(value)) body = value as Record<string, unknown>;
  }
  const writing = !["GET", "HEAD", "OPTIONS"].includes(c.req.method);
  const requireWritable = (type: ResourceType, value: unknown) => {
    const resource = resources.find((r) => r.type === type && (r.id === value || r.slug === value));
    if (resource && !visibleTo(resource, user.id)) bad("找不到此內容", 404);
    if (resource && !writableBy(resource, user.id, canSharedWrite)) bad("你的群組已停用共享內容寫入；可建立或編輯自己的私人內容", 403);
  };
  if (writing) {
    if (section === "documents") {
      if (id) requireWritable("document", id);
      else resolveCreateVisibility(c, body.visibility);
    } else if (section === "decks") {
      if (id === "cards" && child) {
        const card = await c.env.DB.prepare("SELECT deck_id FROM cards WHERE id=?").bind(child).first<{ deck_id: string }>();
        if (card) requireWritable("deck", card.deck_id);
      } else if (id === "import" || !id) {
        if (body.deck_id) requireWritable("deck", body.deck_id);
        else resolveCreateVisibility(c, body.visibility);
      } else if (child !== "settings") requireWritable("deck", id);
    } else if (section === "exams") {
      if (id && !["attempts", "mistakes", "validate", "alignment-check"].includes(id) && child !== "attempts") requireWritable("document", id);
    } else if (section === "course-generations") {
      if (id) {
        const generation = await c.env.DB.prepare("SELECT document_id FROM course_generations WHERE id=? AND created_by=?").bind(id, user.id).first<{ document_id: string }>();
        if (generation) requireWritable("document", generation.document_id);
      } else requireWritable("document", body.note_slug);
    } else if (section === "books" && !canSharedWrite) {
      if (child === "progress" || child === "bookmarks") { /* personal reading state */ }
      else if (child === "annotations") {
        const create = path[3] === "batch" ? (Array.isArray(body.create) ? body.create : []) : c.req.method === "POST" ? [body] : [];
        if (create.some((item) => (item as { visibility?: string }).visibility === "shared")) bad("你的群組無法建立共享標注", 403);
        const ids = [...create.map((item) => (item as { id?: unknown }).id), ...(Array.isArray(body.delete) ? body.delete : []), ...(path[3] && path[3] !== "batch" ? [path[3]] : [])].filter((v): v is string => typeof v === "string");
        for (const annotationId of ids) if (await c.env.DB.prepare("SELECT 1 FROM annotations WHERE id=? AND visibility='shared'").bind(annotationId).first()) bad("你的群組無法修改共享標注", 403);
      } else bad("你的群組已停用共享內容寫入", 403);
    } else if (!["books", "reviews", "assets", "decks", "documents", "exams", "course-generations", "openmaic", "long-courses", "timetable", "content", "chapters"].includes(section) && !canSharedWrite) bad("你的群組已停用共享內容寫入", 403);
  }
  if (section === "timetable") {
    feature("syllabi");
  } else if (section === "openmaic" || section === "long-courses" || section === "learning") {
    feature("ai");
  } else if (section === "documents") {
    if (id) check("document", id);
    else if (c.req.method !== "GET") feature(body.kind === "exam" ? "exams" : "notes");
    if (body.booklet_id) check("book", body.booklet_id);
  } else if (section === "books") {
    if (id === "uploads") {
      if (child) {
        const up = await c.env.DB.prepare("SELECT book_id FROM uploads WHERE id = ?").bind(child).first<{ book_id: string }>();
        if (up) check("book", up.book_id);
      } else if (body.book_id) check("book", body.book_id);
      else feature(bookFeature(String(body.kind ?? "book")));
    } else if (id) check("book", id);
  } else if (section === "decks") {
    if (id === "cards" && child) {
      const card = await c.env.DB.prepare("SELECT deck_id FROM cards WHERE id = ?").bind(child).first<{ deck_id: string }>();
      if (card) check("deck", card.deck_id);
    } else if (id === "import" || (!id && c.req.method !== "GET")) { if (body.deck_id) check("deck", body.deck_id); else feature("decks"); }
    else if (id) check("deck", id);
  } else if (section === "exams") {
    if (id === "attempts" && child) {
      const att = await c.env.DB.prepare("SELECT document_id FROM exam_attempts WHERE id = ? AND user_id = ?").bind(child, c.get("user").id).first<{ document_id: string }>();
      if (att) check("document", att.document_id);
    } else if (id === "mistakes") { if (body.slug) check("document", body.slug); }
    else if (id === "validate") feature("exams");
    else if (id && id !== "attempts") check("document", id);
  } else if (section === "writing") {
    feature("writing");
    if (id === "mcp") feature("ai");
  } else if (section === "course-generations") {
    feature("ai");
    if (id) {
      const gen = await c.env.DB.prepare("SELECT document_id FROM course_generations WHERE id = ? AND created_by = ?").bind(id, c.get("user").id).first<{ document_id: string }>();
      if (gen) check("document", gen.document_id);
    } else check("document", body.note_slug ?? c.req.query("note_slug"));
  } else if (section === "reviews") {
    if (Array.isArray(body.items)) for (const item of body.items) {
      const cardId = (item as { card_id?: string }).card_id;
      if (cardId) {
        const card = await c.env.DB.prepare("SELECT deck_id FROM cards WHERE id = ?").bind(cardId).first<{ deck_id: string }>();
        if (card) check("deck", card.deck_id);
      }
    }
  } else if (section === "assets" && id) {
    const assetPath = `%/api/assets/${id.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const [docs, cards] = await c.env.DB.batch<{ id: string }>([
      c.env.DB.prepare("SELECT DISTINCT d.id FROM documents d JOIN revisions r ON r.document_id = d.id WHERE r.body_md LIKE ? ESCAPE '\\'").bind(assetPath),
      c.env.DB.prepare("SELECT DISTINCT deck_id AS id FROM cards WHERE front LIKE ? ESCAPE '\\' OR back LIKE ? ESCAPE '\\' OR baseline_front LIKE ? ESCAPE '\\' OR baseline_back LIKE ? ESCAPE '\\'").bind(assetPath, assetPath, assetPath, assetPath),
    ]);
    const links = [...docs.results.map((d) => ({ type: "document", id: d.id })), ...cards.results.map((d) => ({ type: "deck", id: d.id }))];
    if (links.some((link) => resources.some((r) => r.type === link.type && r.id === link.id && !allowed(r)))) bad("此圖片所屬內容未開放", 403);
    if (!links.length) {
      const accessible = await c.env.DB.prepare(`
        SELECT 1 FROM assets a WHERE a.id=? AND (
          a.uploaded_by=? OR EXISTS (
            SELECT 1 FROM practice_items p WHERE p.user_id=a.uploaded_by
              AND p.visibility='shared' AND p.item_json LIKE ? ESCAPE '\\'
          )
        )
      `).bind(id, c.get("user").id, assetPath).first();
      if (!accessible) bad("此圖片所屬內容未開放", 403);
    }
  }
  await next();
  if (c.res.status === 101) return;
  c.header("cache-control", "no-store");
  if (c.req.method !== "GET" || !c.res.ok || !(c.res.headers.get("content-type") ?? "").includes("application/json")) return;
  const data = await c.res.json() as Record<string, unknown>;
  const visible = (type: ResourceType, value: unknown, bySlug = false) => {
    const resource = resources.find((r) => r.type === type && (bySlug ? r.slug === value : r.id === value));
    return !resource || allowed(resource);
  };
  // Explicit response contracts, including search/snippets and learning-history derivatives.
  const filter = (key: string, type: ResourceType, field: string) => {
    if (Array.isArray(data[key])) data[key] = (data[key] as Record<string, unknown>[]).filter((r) => visible(type, r[field], field === "slug"));
  };
  if (section === "admin") {
    filter("documents", "document", "id"); filter("decks", "deck", "id"); filter("answers", "document", "slug");
    if (id === "audit" && Array.isArray(data.entries)) data.entries = data.entries.filter((entry) => {
      const row = entry as { entity_id?: string; entity_type?: string };
      const resource = resources.find((r) => r.id === row.entity_id);
      return !resource || visibleTo(resource, user.id);
    });
  }
  if (section === "books") filter("books", "book", "id");
  if (section === "documents") filter("documents", "document", "id");
  if (section === "decks" && !id) filter("decks", "deck", "id");
  if (section === "search") { filter("documents", "document", "slug"); filter("books", "book", "id"); filter("cards", "deck", "deck_id"); }
  if (section === "me") { filter("exams", "document", "slug"); filter("mistakes", "document", "slug"); }
  if (section === "exams" && (id === "attempts" || id === "mistakes")) {
    filter("attempts", "document", "slug"); filter("mistakes", "document", "slug");
    if ("total_open" in data) data.total_open = (data.mistakes as unknown[]).length;
  }
  if (section === "exams" && data.booklet && typeof data.booklet === "object" && !visible("book", (data.booklet as { id: string }).id)) data.booklet = null;
  c.res = c.json(data, c.res.status as 200);
  c.header("cache-control", "no-store");
};

export async function userAccess(env: Env, user: SessionUser) {
  const rules = await accessRules(env, user);
  const catalog = (await accessCatalog(env)).filter((r) => visibleTo(r, user.id));
  return {
    features: accessibleFeatures(rules, catalog),
    defaults: Object.fromEntries(Object.keys(FEATURES).map((f) => [f, canAccess(rules, f as Feature)])),
    denied: catalog.filter((r) => !canAccess(rules, r.feature, r.type, r.id)).map((r) => ({ type: r.type, id: r.id, slug: r.slug })),
  };
}

/** Only the owner can see private content; admin status does not override this boundary. */
export async function requireDocumentWrite(env: Env, user: SessionUser, id: string): Promise<boolean> {
  if (!await requireDocumentAccess(env, user, id)) return false;
  const doc = await env.DB.prepare("SELECT visibility,created_by FROM documents WHERE id=?").bind(id).first<{ visibility: Visibility; created_by: string | null }>();
  return !!doc && writableBy({ visibility: doc.visibility, owner_id: doc.created_by }, user.id, canAccess(await accessRules(env, user), "shared_write"));
}

export function resolveCreateVisibility(c: Context<AppEnv>, requested: unknown): Visibility {
  const sharedWrite = c.get("canSharedWrite");
  if (requested !== undefined && requested !== "shared" && requested !== "private") bad("visibility 必須是 shared 或 private");
  const visibility = requested ?? (sharedWrite ? "shared" : "private");
  if (visibility === "shared" && !sharedWrite) bad("你的群組已停用共享內容寫入，請改為私人內容", 403);
  return visibility as Visibility;
}

/** The creator switches their own note, exam or deck between private and shared. Returns the new value, or null when nothing changes. */
export function resolveVisibilityChange(c: Context<AppEnv>, current: { visibility: Visibility; created_by: string | null }, requested: unknown): Visibility | null {
  if (requested !== "shared" && requested !== "private") bad("visibility 必須是 shared 或 private");
  if (!current.created_by || current.created_by !== c.get("user").id) bad("只有建立者可以變更可見範圍", 403);
  if (requested === current.visibility) return null;
  if (requested === "shared" && !c.get("canSharedWrite")) bad("你的群組已停用共享內容寫入，無法改為共享", 403);
  return requested;
}

/**
 * pdf.js reads a large book as many small ranges, one request each. This answers those requests with one batched query
 * (the user's group rules and the book), instead of the full content catalog every other route loads. Same rules: the book
 * must be ready and its feature (ebooks, booklets, syllabi) and the book itself allowed for the user's groups.
 */
export async function readableBookFile(env: Env, user: SessionUser, bookId: string): Promise<string | null> {
  const book = env.DB.prepare("SELECT b.kind, b.r2_key, b.status, t.visibility AS visibility, t.created_by AS owner_id FROM books b LEFT JOIN chapter_materials m ON m.book_id = b.id LEFT JOIN topics t ON t.id = m.topic_id WHERE b.id = ?").bind(bookId);
  type Row = { kind: string; r2_key: string; status: string; visibility: string | null; owner_id: string | null };
  // The chapter's PDF is hidden from everyone but the chapter's owner while the chapter is private (the same rule as the chapter).
  const hidden = (row: Row) => row.kind === "chapter" && !visibleTo({ visibility: (row.visibility ?? "private") as Visibility, owner_id: row.owner_id }, user.id);
  if (user.role === "admin") {
    const row = await book.first<Row>();
    return row && row.status === "ready" && !hidden(row) ? row.r2_key : null;
  }
  const [rules, rows] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT r.* FROM access_rules r JOIN access_group_members m ON m.group_id = r.group_id WHERE m.email = ?").bind(user.email.toLowerCase()),
    book,
  ]);
  const row = rows.results[0] as Row | undefined;
  if (!row || row.status !== "ready" || hidden(row)) return null;
  if (!canAccess(rules.results as unknown as AccessRule[], bookFeature(row.kind), "book", bookId)) bad("你的使用者群組無權存取此內容", 403);
  return row.r2_key;
}
