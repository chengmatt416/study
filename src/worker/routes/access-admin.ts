import { Hono, type Context } from "hono";
import { z } from "zod";
import { FEATURES } from "../../shared/access";
import { accessCatalog } from "../lib/access";
import { requireAdmin } from "../lib/auth";
import { audit } from "../lib/audit";
import type { AppEnv } from "../lib/types";
import { bad, now, readJson, uid } from "../lib/util";

const groups = new Hono<AppEnv>();
groups.use("*", requireAdmin);
const schema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().max(2000).default(""),
  members: z.array(z.email().toLowerCase()).max(1000),
  rules: z.array(z.object({ resource_type: z.enum(["feature", "book", "document", "deck"]), resource_id: z.string().min(1).max(200), allowed: z.union([z.literal(0), z.literal(1)]) })).max(3000),
  expected_version: z.number().int().positive().optional(),
});
groups.get("/", async (c) => {
  const [list, members, rules, users] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT id,name,description,version,created_at FROM access_groups ORDER BY name"),
    c.env.DB.prepare("SELECT * FROM access_group_members ORDER BY email"), c.env.DB.prepare("SELECT * FROM access_rules"),
    c.env.DB.prepare("SELECT a.email, a.role, u.name FROM allowlist a LEFT JOIN users u ON u.email = a.email ORDER BY a.email"),
  ]);
  return c.json({ groups: list.results.map((g) => ({ ...g, members: members.results.filter((m) => m.group_id === g.id).map((m) => m.email), rules: rules.results.filter((r) => r.group_id === g.id) })), users: users.results, resources: (await accessCatalog(c.env)).filter((r) => r.visibility !== "private"), features: FEATURES });
});

async function save(c: Context<AppEnv>, id?: string) {
  const parsed = schema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) bad("群組設定格式不正確", 422, { errors: parsed.error.issues.map((i) => i.message) });
  const b = parsed.data;
  const catalog = (await accessCatalog(c.env)).filter((r) => r.visibility !== "private");
  const seen = new Set<string>();
  for (const rule of b.rules) {
    const key = `${rule.resource_type}:${rule.resource_id}`;
    if (seen.has(key)) bad("同一內容的權限規則不可重複");
    seen.add(key);
    if (rule.resource_type === "feature" ? !Object.hasOwn(FEATURES, rule.resource_id) : !catalog.some((r) => r.type === rule.resource_type && r.id === rule.resource_id)) bad("規則指定了不存在的功能或內容");
  }
  const { results: allowed } = await c.env.DB.prepare("SELECT email FROM allowlist").all<{ email: string }>();
  if (b.members.some((email) => !allowed.some((u) => u.email === email))) bad("群組成員必須先在授權名單中");
  if (await c.env.DB.prepare("SELECT id FROM access_groups WHERE name = ? AND id != ?").bind(b.name, id ?? "").first()) bad("群組名稱已存在", 409);
  const groupId = id ?? uid();
  const token = uid();
  const first = id
    ? c.env.DB.prepare("UPDATE access_groups SET name = ?, description = ?, version = version + 1, edit_token = ? WHERE id = ? AND version = ? RETURNING version").bind(b.name, b.description, token, id, b.expected_version ?? -1)
    : c.env.DB.prepare("INSERT INTO access_groups (id,name,description,created_at,edit_token) VALUES (?,?,?,?,?) RETURNING version").bind(groupId, b.name, b.description, now(), token);
  const guard = "EXISTS (SELECT 1 FROM access_groups WHERE id = ? AND edit_token = ?)";
  const result = await c.env.DB.batch([
    first,
    c.env.DB.prepare(`DELETE FROM access_group_members WHERE group_id = ? AND ${guard}`).bind(groupId, groupId, token),
    c.env.DB.prepare(`DELETE FROM access_rules WHERE group_id = ? AND ${guard}`).bind(groupId, groupId, token),
    ...[...new Set(b.members)].map((email) => c.env.DB.prepare(`INSERT INTO access_group_members (group_id,email) SELECT ?,? WHERE ${guard}`).bind(groupId, email, groupId, token)),
    ...b.rules.map((r) => c.env.DB.prepare(`INSERT INTO access_rules (group_id,resource_type,resource_id,allowed) SELECT ?,?,?,? WHERE ${guard}`).bind(groupId, r.resource_type, r.resource_id, r.allowed, groupId, token)),
  ]);
  if (!result[0].results.length) bad("群組已更新，請重新讀取後再儲存", 409);
  await audit(c.env.DB, c.get("user").id, "access.group.save", "access_group", groupId, { name: b.name, members: b.members, rules: b.rules });
  return c.json({ id: groupId, version: (result[0].results[0] as { version: number }).version });
}
groups.post("/", (c) => save(c));
groups.put("/:id", (c) => save(c, c.req.param("id")));
groups.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM access_groups WHERE id = ?").bind(c.req.param("id")).run();
  await audit(c.env.DB, c.get("user").id, "access.group.delete", "access_group", c.req.param("id"));
  return c.json({ ok: true });
});
export default groups;
