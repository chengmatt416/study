// MCP OAuth 授權頁（/authorize）：使用 STUDY 既有的登入（Google）身分，顯示同意畫面後核發權杖。
import { Hono } from "hono";
import { AuthorizationError, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AppEnv, SessionUser } from "../lib/types";
import { loadUser } from "../lib/auth";
import { SCOPES } from "./server";

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const SCOPE_TEXT: Record<string, string> = {
  "study:read": "讀取你的重點整理、試題、字卡、電子書清單、課表、學習進度與已提交的寫作初稿",
  "study:write": "以你的名義新增與修訂重點整理、試題、字卡（修訂會以螢光標示，管理員可回復）、修改個人課表，以及出寫作題與提交批改",
  offline_access: "在你不在線上時維持連線（更新權杖）",
};

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#09090b;color:#fafafa;font-family:Inter,"Noto Sans TC","PingFang TC",system-ui,sans-serif}
.card{width:100%;max-width:440px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);border-radius:28px;padding:32px;backdrop-filter:blur(20px)}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:24px;font-weight:700;letter-spacing:.14em}
.logo span{display:grid;place-items:center;width:36px;height:36px;border-radius:12px;background:#fff;color:#09090b;font-family:Georgia,serif;font-size:20px}
h1{font-size:22px;margin:0 0 8px;font-weight:600;line-height:1.35}
p{color:rgba(255,255,255,.7);font-size:14px;line-height:1.6;margin:8px 0}
.box{border-radius:16px;background:rgba(255,255,255,.06);padding:14px 16px;margin:16px 0;font-size:14px}
.warn{background:rgba(251,191,36,.15);color:#fde68a}
label{display:flex;gap:10px;align-items:flex-start;padding:8px 0;font-size:14px;color:rgba(255,255,255,.88)}
input[type=checkbox]{margin-top:3px;width:16px;height:16px;accent-color:#fff}
.btns{display:flex;gap:10px;margin-top:20px}
button{flex:1;height:46px;border-radius:14px;border:0;font-size:15px;font-weight:600;cursor:pointer}
.allow{background:#fff;color:#09090b}.deny{background:rgba(255,255,255,.1);color:#fff}
small{display:block;margin-top:16px;color:rgba(255,255,255,.4);font-size:12px}
</style></head><body><div class="card"><div class="logo"><span>S</span>STUDY</div>${body}</div></body></html>`;
}

function consentPage(d: ConsentDescription, handle: string, user: SessionUser): string {
  const name = esc(d.clientName);
  const origin = d.clientDomain ? `由 <strong>${esc(d.clientDomain)}</strong> 發布。` : "此應用程式自行註冊，名稱未經驗證。";
  const scopes = d.scope
    .map((s) => `<label><input type="checkbox" name="scope" value="${esc(s)}" checked> <span><strong>${esc(s)}</strong><br>${esc(SCOPE_TEXT[s] ?? s)}</span></label>`)
    .join("");
  return page(
    `授權 ${d.clientName}`,
    `<h1>允許「${name}」存取你的 STUDY？</h1>
<p>${origin}</p>
<div class="box">登入身分：<strong>${esc(user.email)}</strong><br>權杖會傳送到：<strong>${esc(d.redirectHost)}</strong></div>
${d.redirectIsLoopback ? '<div class="box warn">這會把存取權交給你電腦上的應用程式。只有在你剛剛從該程式發起連線時才繼續。</div>' : ""}
<form method="post">
<input type="hidden" name="handle" value="${esc(handle)}">
${scopes}
<div class="btns"><button class="deny" name="decision" value="deny">拒絕</button><button class="allow" name="decision" value="approve">允許</button></div>
</form>
<small>可隨時在 AI 應用程式中中斷連線。AI 建立或修改的內容會以你的名義記錄。</small>`,
  );
}

function errorPage(message: string, status = 400) {
  return new Response(page("無法授權", `<h1>無法完成授權</h1><p>${esc(message)}</p><p><a href="/" style="color:#fff">回到 STUDY</a></p>`), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" },
  });
}

export const authorizeApp = new Hono<AppEnv>();

authorizeApp.get("/authorize", async (c) => {
  const oauth = (c.env as OAuthEnv).OAUTH_PROVIDER;
  try {
    const request = await oauth.parseAuthRequest(c.req.raw);
    const user = await loadUser(c);
    if (!user) {
      // 先登入 STUDY（Google），登入後回到同一個授權網址
      const here = new URL(c.req.url);
      return c.redirect(`/login?redirect=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const details = await oauth.describeConsent(request);
    // 一律提供讀取與寫入兩個選項（有些用戶端如 ChatGPT 只請求部分 scope）；使用者可取消勾選寫入
    const extra = details.scope.includes("offline_access") ? ["offline_access"] : [];
    details.scope = [...SCOPES, ...extra];
    const consent = await oauth.beginConsent(request);
    consent.headers.set("content-type", "text/html; charset=utf-8");
    return new Response(consentPage(details, consent.handle, user), { headers: consent.headers });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return errorPage(e.description ?? "授權請求無效");
    if ((e as Error)?.name === "CimdFetchError") return errorPage("無法驗證此應用程式。");
    throw e;
  }
});

authorizeApp.post("/authorize", async (c) => {
  const oauth = (c.env as OAuthEnv).OAUTH_PROVIDER;
  try {
    const user = await loadUser(c);
    if (!user) return errorPage("登入已過期，請重新從 AI 應用程式連線。", 401);
    const form = await c.req.raw.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(c.req.raw, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const scope = form
      .getAll("scope")
      .map(String)
      .filter((s) => (SCOPES as readonly string[]).includes(s) || s === "offline_access");
    if (!scope.includes("study:read")) scope.unshift("study:read");
    const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: user.id,
      metadata: { email: user.email },
      scope: approved.request.scope,
      props: { userId: user.id, email: user.email },
    });
    approved.headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    if (e instanceof AuthorizationError) return errorPage(e.description ?? "授權頁已過期或已使用，請重新連線。");
    throw e;
  }
});
