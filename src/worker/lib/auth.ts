// Google OAuth（OIDC Authorization Code + PKCE + nonce）與 session。
// 觀看與編輯共用同一份授權名單（allowlist）；不在名單上的 Google 帳號一律拒絕。
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Role, SessionUser } from "./types";
import { bad, base64url, now, randomToken, sha256Hex, uid } from "./util";

const COOKIE = "__Host-sid";
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const STATE_TTL = 10 * 60 * 1000;

const isLocal = (url: string) => {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
};

async function hashSession(env: Env, token: string) {
  return sha256Hex(`${token}.${env.SESSION_PEPPER ?? ""}`);
}

function bootstrapAdmins(env: Env): string[] {
  return (env.BOOTSTRAP_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 回傳此 email 的角色；bootstrap admin 第一次登入時自動寫入名單。不在名單 → null */
export async function resolveRole(env: Env, email: string): Promise<Role | null> {
  const e = email.toLowerCase();
  const row = await env.DB.prepare("SELECT role FROM allowlist WHERE email = ?").bind(e).first<{ role: Role }>();
  if (row) return row.role;
  if (bootstrapAdmins(env).includes(e)) {
    await env.DB.prepare("INSERT OR IGNORE INTO allowlist (email, role, note, created_at) VALUES (?, 'admin', 'bootstrap', ?)")
      .bind(e, now())
      .run();
    return "admin";
  }
  return null;
}

async function upsertUser(env: Env, p: { sub: string | null; email: string; name?: string | null; picture?: string | null }) {
  const email = p.email.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  const t = now();
  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET google_sub = COALESCE(?, google_sub), name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url), last_login_at = ? WHERE id = ?",
    )
      .bind(p.sub, p.name ?? null, p.picture ?? null, t, existing.id)
      .run();
    return existing.id;
  }
  const id = uid();
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, p.sub, email, p.name ?? null, p.picture ?? null, t, t)
    .run();
  return id;
}

async function createSession(c: Context<AppEnv>, userId: string) {
  const previous = getCookie(c, COOKIE);
  if (previous) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash=?").bind(await hashSession(c.env, previous)).run();
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at, user_agent, created_at) VALUES (?,?,?,?,?)")
    .bind(await hashSession(c.env, token), userId, t + SESSION_TTL, (c.req.header("user-agent") ?? "").slice(0, 300), t)
    .run();
  setCookie(c, COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: SESSION_TTL / 1000 });
  deleteCookie(c, "study_openmaic", { path: "/", secure: true });
}

function safeRedirect(to: string | null | undefined): string {
  return to && to.startsWith("/") && !to.startsWith("//") ? to : "/";
}

export async function startGoogle(c: Context<AppEnv>) {
  if (!c.env.GOOGLE_CLIENT_ID) return c.redirect("/login?error=oauth_not_configured");
  const state = randomToken(24);
  const verifier = randomToken(48);
  const nonce = randomToken(16);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  await c.env.DB.prepare("INSERT INTO oauth_states (state, code_verifier, nonce, redirect_to, created_at) VALUES (?,?,?,?,?)")
    .bind(state, verifier, nonce, safeRedirect(c.req.query("redirect")), now())
    .run();
  const origin = new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0))));
}

export async function googleCallback(c: Context<AppEnv>) {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (c.req.query("error")) return c.redirect("/login?error=cancelled");
  if (!code || !state) return c.redirect("/login?error=bad_request");
  const st = await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, nonce, redirect_to, created_at")
    .bind(state)
    .first<{ code_verifier: string; nonce: string; redirect_to: string; created_at: number }>();
  if (!st || now() - st.created_at > STATE_TTL) return c.redirect("/login?error=state_expired");

  const origin = new URL(c.req.url).origin;
  // 直接以 TLS 向 Google token endpoint 取得 id_token（OIDC Core 3.1.3.7：可省略簽章驗證，仍驗證 iss/aud/exp/nonce）
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: st.code_verifier,
    }),
  });
  if (!tokenRes.ok) return c.redirect("/login?error=token_exchange");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return c.redirect("/login?error=token_exchange");
  const claims = decodeJwtPayload(id_token);
  const okIss = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!okIss || claims.aud !== c.env.GOOGLE_CLIENT_ID || Number(claims.exp) * 1000 < now() || claims.nonce !== st.nonce)
    return c.redirect("/login?error=invalid_token");
  if (claims.email_verified !== true || typeof claims.email !== "string") return c.redirect("/login?error=email_unverified");

  const role = await resolveRole(c.env, claims.email);
  if (!role) return c.redirect(`/login?error=not_allowed&email=${encodeURIComponent(claims.email)}`);
  const userId = await upsertUser(c.env, {
    sub: String(claims.sub),
    email: claims.email,
    name: (claims.name as string) ?? null,
    picture: (claims.picture as string) ?? null,
  });
  await createSession(c, userId);
  return c.redirect(safeRedirect(st.redirect_to));
}

/** 本機開發專用：免 Google 直接以名單內 email 登入。正式環境（DEV_LOGIN!=1 或非 localhost）一律 404。 */
export async function devLogin(c: Context<AppEnv>) {
  if (c.env.DEV_LOGIN !== "1" || !isLocal(c.req.url)) return c.notFound();
  const email = (c.req.query("email") ?? "").toLowerCase();
  if (!email) bad("缺少 email");
  const role = await resolveRole(c.env, email);
  if (!role) return c.redirect("/login?error=not_allowed");
  const userId = await upsertUser(c.env, { sub: null, email, name: email.split("@")[0] });
  await createSession(c, userId);
  return c.redirect(safeRedirect(c.req.query("redirect")));
}

export async function logout(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await hashSession(c.env, token)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: true });
  deleteCookie(c, "study_openmaic", { path: "/", secure: true });
  return c.json({ ok: true });
}

export async function loadUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const hash = await hashSession(c.env, token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.avatar_url, a.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       LEFT JOIN allowlist a ON a.email = u.email
      WHERE s.id_hash = ?`,
  )
    .bind(hash)
    .first<SessionUser & { expires_at: number; role: Role | null }>();
  if (!row) return null;
  const t = now();
  if (row.expires_at < t || !row.role) {
    // 過期或已被移出名單：立即失效
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(hash).run();
    return null;
  }
  if (row.expires_at - t < SESSION_TTL - 24 * 3600 * 1000) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?").bind(t + SESSION_TTL, hash).run(),
    );
  }
  c.set("sessionHash", hash);
  return { id: row.id, email: row.email, name: row.name, avatar_url: row.avatar_url, role: row.role };
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUser(c);
  if (!user) return c.json({ error: "請先登入" }, 401);
  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ error: "需要管理員權限" }, 403);
  await next();
};

/** 寫入類請求檢查 Origin（搭配 SameSite=Lax cookie 防 CSRF） */
export const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "來源不符" }, 403);
  }
  await next();
};
