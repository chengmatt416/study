// 管理後台：授權名單、使用者、稽核紀錄、用量、系統檢查。
import { Hono } from "hono";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson } from "../lib/util";
import { audit } from "../lib/audit";
import { storageUsed } from "../lib/quota";
import { runNotebookLMCheck } from "../cron";
import accessGroups from "./access-admin";
import liveAiAdmin from "./live-ai-admin";

const admin = new Hono<AppEnv>();
admin.route("/access-groups", accessGroups);
admin.route("/live-ai", liveAiAdmin);

admin.get("/allowlist", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.email, a.role, a.note, a.created_at, u.name, u.last_login_at
       FROM allowlist a LEFT JOIN users u ON u.email = a.email ORDER BY a.role, a.email`,
  ).all();
  return c.json({ allowlist: results });
});

admin.post("/allowlist", async (c) => {
  const b = await readJson<{ emails: string | string[]; role?: "admin" | "member"; note?: string }>(c.req.raw);
  const list = (Array.isArray(b.emails) ? b.emails : String(b.emails ?? "").split(/[\s,;]+/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const invalid = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (invalid.length) bad(`email 格式錯誤：${invalid.join(", ")}`);
  if (!list.length) bad("請輸入至少一個 email");
  const role = b.role === "admin" ? "admin" : "member";
  const t = now();
  await c.env.DB.batch(
    list.map((e) =>
      c.env.DB.prepare(
        "INSERT INTO allowlist (email, role, note, invited_by, created_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET role = excluded.role, note = COALESCE(excluded.note, allowlist.note)",
      ).bind(e, role, b.note?.slice(0, 200) || null, c.get("user").id, t),
    ),
  );
  await audit(c.env.DB, c.get("user").id, "allowlist.add", "allowlist", null, { emails: list, role });
  return c.json({ added: list.length });
});

admin.delete("/allowlist/:email", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).toLowerCase();
  if (email === c.get("user").email.toLowerCase()) bad("不能移除自己");
  await c.env.DB.prepare("DELETE FROM allowlist WHERE email = ?").bind(email).run();
  // 移除名單 → 立即登出該使用者
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)").bind(email).run();
  await audit(c.env.DB, c.get("user").id, "allowlist.remove", "allowlist", null, { email });
  return c.json({ ok: true });
});

admin.get("/audit", async (c) => {
  const before = Number(c.req.query("before") ?? now() + 1);
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, u.name AS actor_name, u.email AS actor_email FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
      WHERE l.created_at < ? ORDER BY l.created_at DESC LIMIT 100`,
  )
    .bind(before)
    .all();
  return c.json({ entries: results });
});

admin.get("/usage", async (c) => {
  const used = await storageUsed(c.env.DB);
  const limit = Number(c.env.MAX_STORAGE_BYTES);
  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM books) AS books,
            (SELECT COUNT(*) FROM documents WHERE kind='note') AS notes, (SELECT COUNT(*) FROM documents WHERE kind='exam') AS exams,
            (SELECT COUNT(*) FROM decks) AS decks, (SELECT COUNT(*) FROM cards WHERE deleted_at IS NULL) AS cards,
            (SELECT COUNT(*) FROM review_log WHERE reviewed_at > ?) AS reviews_30d,
            (SELECT COUNT(*) FROM exam_attempts WHERE started_at > ?) AS attempts_30d,
            (SELECT COUNT(*) FROM answer_revisions ar JOIN documents d ON d.id=ar.document_id WHERE ar.status = 'pending' AND d.visibility='shared') AS pending_answers,
            (SELECT COUNT(*) FROM documents WHERE visibility='shared' AND baseline_revision_id IS NOT current_revision_id) AS docs_with_revisions`,
  )
    .bind(now() - 30 * 86400000, now() - 30 * 86400000)
    .first();
  const { results: checks } = await c.env.DB.prepare("SELECT * FROM system_checks").all();
  return c.json({
    storage: { used, limit, freeTier: 10 * 1024 ** 3 },
    counts,
    checks,
    plan: {
      note: "Workers Paid 含：1,000 萬次請求/月、D1 250 億列讀取/5000 萬列寫入/5GB、Durable Objects 100 萬請求 + 40 萬 GB-s；R2 另計但有 10GB/月免費額度。本系統不使用 Browser Rendering。",
    },
  });
});

admin.post("/checks/notebooklm", async (c) => {
  const r = await runNotebookLMCheck(c.env);
  return c.json(r);
});

admin.get("/trash", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.slug, d.kind, d.title, d.deleted_at, u.name AS deleted_by_name, u.email AS deleted_by_email,
            (SELECT COUNT(*) FROM exam_attempts ea WHERE ea.document_id = d.id) AS attempts
       FROM documents d LEFT JOIN users u ON u.id = d.deleted_by
      WHERE d.status = 'archived' ORDER BY d.deleted_at DESC`,
  ).all();
  return c.json({ documents: results });
});

admin.get("/revisions/pending", async (c) => {
  const { results: docs } = await c.env.DB.prepare(
    `SELECT d.id, d.slug, d.kind, d.title, d.updated_at,
            (SELECT COUNT(*) FROM revisions r WHERE r.document_id = d.id AND r.created_at > COALESCE((SELECT created_at FROM revisions b WHERE b.id = d.baseline_revision_id), 0)) AS revisions
       FROM documents d WHERE d.visibility='shared' AND d.baseline_revision_id IS NOT d.current_revision_id ORDER BY d.updated_at DESC`,
  ).all();
  const { results: decks } = await c.env.DB.prepare(
    `SELECT d.id, d.title, COUNT(k.id) AS changed FROM decks d JOIN cards k ON k.deck_id = d.id AND k.deleted_at IS NULL
      WHERE d.visibility='shared' AND (k.baseline_front IS NULL OR k.baseline_front != k.front OR k.baseline_back != k.back) GROUP BY d.id ORDER BY d.title`,
  ).all();
  const { results: answers } = await c.env.DB.prepare(
    `SELECT ar.id, ar.created_at, ar.message, d.slug, d.title, u.name AS author_name FROM answer_revisions ar
       JOIN documents d ON d.id = ar.document_id LEFT JOIN users u ON u.id = ar.author_id WHERE ar.status = 'pending' AND d.visibility='shared' ORDER BY ar.created_at DESC`,
  ).all();
  return c.json({ documents: docs, decks, answers });
});

export default admin;
