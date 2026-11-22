import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { OAuthProvider, insufficientScope, type OAuthResourceAuth } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import type { AppEnv, Role, SessionUser } from "./lib/types";
import { checkOrigin, devLogin, googleCallback, logout, requireAdmin, requireUser, startGoogle } from "./lib/auth";
import books, { serveBookFile } from "./routes/books";
import docs from "./routes/documents";
import exams from "./routes/exams";
import writingPractice from "./routes/writing-practice";
import practice from "./routes/practice";
import decks from "./routes/decks";
import admin from "./routes/admin";
import misc from "./routes/misc";
import courseGenerations from "./routes/course-generations";
import openMaicCore from "./routes/openmaic-core";
import longCourses from "./routes/long-courses";
import { scheduled } from "./cron";
import { authorizeApp } from "./mcp/authorize";
import { buildServer, WRITE_TOOLS } from "./mcp/server";
import { mcpPdfDownloads } from "./mcp/book-pdf";
import { enforceAccess, accessRules, readableBookFile } from "./lib/access";
import { canAccess } from "../shared/access";
import { proxyOpenMaic } from "./lib/openmaic-proxy";
import { privateLiveAiGateway } from "./lib/live-ai/service";
import liveAi from "./routes/live-ai";
import learning from "./routes/learning";
import timetable from "./routes/timetable";
import content from "./routes/content";
import chapters from "./routes/chapters";

export { DocRoom } from "./collab";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});
app.use("*", checkOrigin);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/auth/google/start", startGoogle);
app.get("/auth/google/callback", googleCallback);
app.get("/auth/dev", devLogin);
app.post("/auth/logout", logout);
app.get("/auth/config", (c) =>
  c.json({
    appName: c.env.APP_NAME,
    contactEmail: c.env.CONTACT_EMAIL || undefined,
    google: !!c.env.GOOGLE_CLIENT_ID,
    devLogin: c.env.DEV_LOGIN === "1" && /^(localhost|127\.0\.0\.1)$/.test(new URL(c.req.url).hostname),
    mcpUrl: `${new URL(c.req.url).origin}/mcp`,
  }),
);

// Short-lived, book-scoped grants authenticate external PDF fetches without browser cookies.
app.route("/mcp-files", mcpPdfDownloads);
app.route("/openmaic/live", liveAi);

app.use("*", requireUser);
// PDF ranges skip the full access catalog (one batched query instead); registered before enforceAccess so it answers first.
app.get("/books/:id/file", async (c) => {
  const key = await readableBookFile(c.env, c.get("user"), c.req.param("id"));
  if (!key) return c.json({ error: "找不到此書" }, 404);
  return serveBookFile(c.env, c.req.raw, key);
});
app.use("*", enforceAccess);
app.route("/books", books);
app.route("/documents", docs);
app.route("/course-generations", courseGenerations);
app.route("/openmaic", openMaicCore);
app.route("/long-courses", longCourses);
app.route("/learning", learning);
app.route("/timetable", timetable);
app.route("/content", content);
app.route("/chapters", chapters);
app.route("/exams", exams);
app.route("/writing", writingPractice);
app.route("/practice", practice);
app.route("/decks", decks);
app.use("/admin/*", requireAdmin);
app.route("/admin", admin);
app.route("/", misc);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ error: "伺服器錯誤" }, 500);
});

// ---------- MCP server（OAuth 保護） ----------
type McpCtx = ExecutionContext & { props?: { userId?: string }; auth?: OAuthResourceAuth };

/** 這次請求是否呼叫了需要寫入權限的工具（支援 JSON-RPC 批次） */
async function callsWriteTool(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  try {
    const body = (await request.clone().json()) as unknown;
    const msgs = Array.isArray(body) ? body : [body];
    return msgs.some((m) => {
      const msg = m as { method?: string; params?: { name?: string } };
      return msg?.method === "tools/call" && WRITE_TOOLS.has(String(msg.params?.name));
    });
  } catch {
    return false;
  }
}

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: McpCtx): Promise<Response> {
    const scopes = ctx.auth?.scope ?? ["study:read"];
    // 權杖沒有寫入權限卻呼叫寫入工具 → 標準的 scope step-up 挑戰（ChatGPT / Claude 會重新授權）
    if (ctx.auth && !scopes.includes("study:write") && (await callsWriteTool(request))) {
      return insufficientScope(ctx.auth, ["study:read", "study:write"], "此操作需要寫入權限（study:write）");
    }
    // 每次請求重新檢查授權名單：被移出名單的帳號立即失去 MCP 存取權
    const user = await env.DB.prepare(
      "SELECT u.id, u.email, u.name, u.avatar_url, a.role FROM users u JOIN allowlist a ON a.email = u.email WHERE u.id = ?",
    )
      .bind(ctx.props?.userId ?? "")
      .first<SessionUser & { role: Role }>();
    if (!user) return Response.json({ error: "此帳號已不在授權名單中" }, { status: 403 });
    if (!canAccess(await accessRules(env, user), "ai")) return Response.json({ error: "你的使用者群組未開放 AI / MCP" }, { status: 403 });
    const url = new URL(request.url);
    const handler = createMcpHandler(() => buildServer({ env, ctx, user, scopes, origin: url.origin }), {
      route: "/mcp",
      allowedHostnames: [url.hostname],
      // 遠端 MCP 只接受 Bearer 權杖（不使用 cookie），不需以 Origin 防 DNS rebinding；允許瀏覽器型用戶端
      allowedOriginHostnames: "*",
    });
    return handler(request, env, ctx);
  },
};

const defaultHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/authorize") return authorizeApp.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

// 依「請求進來的網域」建立 OAuth provider：workers.dev 與自訂網域各自有正確的 resource / issuer
const providers = new Map<string, OAuthProvider<Env>>();
function getProvider(origin: string) {
  let provider = providers.get(origin);
  if (provider) return provider;
  provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: mcpHandler as never,
    defaultHandler: defaultHandler as never,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: ["study:read", "study:write", "offline_access"],
    // 用戶端會先請求這些 scope；一併要求寫入，使用者可在同意頁取消勾選
    requiredScopes: ["study:read", "study:write"],
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
    clientIdMetadataDocumentEnabled: true,
  });
  providers.set(origin, provider);
  return provider;
}

export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/internal/live-ai/completions') return privateLiveAiGateway(request, env);
    const classroom = await proxyOpenMaic(request, env);
    if (classroom) return classroom;
    const url = new URL(request.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    // 只接受 HTTPS（本機開發除外）；網域由 Cloudflare 路由決定，因此請求的網域可信
    const origin = local || url.protocol === "https:" ? url.origin : env.PUBLIC_ORIGIN;
    return getProvider(origin).fetch(request, env, ctx);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scheduled(env));
  },
} satisfies ExportedHandler<Env>;
