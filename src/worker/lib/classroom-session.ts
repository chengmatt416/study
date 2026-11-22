import { verifyOpenMaicTicket } from "../../shared/openmaic-transport";

export async function activeClassroomTicket(request: Request, env: { DB: D1Database; OPENMAIC_MCP_SECRET?: string }) {
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("study_openmaic="))?.slice("study_openmaic=".length);
  const ticket = cookie ? await verifyOpenMaicTicket(cookie, env.OPENMAIC_MCP_SECRET ?? "") : null;
  if (!ticket || ticket.scope !== "classroom" || !ticket.classroom_id) return null;
  if (ticket.session_hash) {
    const session = await env.DB.prepare("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN allowlist a ON a.email=u.email WHERE s.id_hash=? AND s.user_id=? AND s.expires_at>?").bind(ticket.session_hash, ticket.sub.slice(6), Date.now()).first();
    if (!session) return null;
  }
  return ticket;
}

export function expiredClassroomResponse(request: Request) {
  const headers = { "cache-control": "no-store", "set-cookie": "study_openmaic=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure" };
  if (request.method === "GET" && /^\/classroom(?:\/|$)/.test(new URL(request.url).pathname) && request.headers.get("accept")?.includes("text/html")) {
    return new Response('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>重新開啟課堂 · STUDY</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#fafafa;color:#18181b;font:16px/1.8 system-ui,sans-serif}main{max-width:32rem;padding:32px}h1{font-size:26px;line-height:1.4}p{color:#52525b}a{display:inline-flex;align-items:center;min-height:44px;padding:4px 18px;border-radius:12px;background:#18181b;color:white;text-decoration:none}a:focus-visible{outline:3px solid #71717a;outline-offset:4px}@media(prefers-color-scheme:dark){body{background:#18181b;color:#fafafa}p{color:#d4d4d8}a{background:#fafafa;color:#18181b}}</style><main><p>STUDY 課堂</p><h1>請重新開啟課堂</h1><p>課堂登入已到期或帳號已變更。已儲存的進度會保留，請回到 STUDY 重新開課。</p><a href="/">返回 STUDY</a></main></html>', { status: 401, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }
  return Response.json({ error: "課堂登入已到期或變更，請從 STUDY 重新開啟課堂", code: "classroom_session_required" }, { status: 401, headers });
}
