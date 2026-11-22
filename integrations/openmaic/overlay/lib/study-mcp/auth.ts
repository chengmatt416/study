import { verifyOpenMaicTicket } from "./protocol";
import type { OpenMaicTicket } from "./protocol";

export const COOKIE = "study_openmaic";
export async function studyTicket(
  headers: Headers,
): Promise<OpenMaicTicket | null> {
  const authorization = headers.get("authorization");
  const value = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : headers
        .get("cookie")
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
  return value
    ? verifyOpenMaicTicket(value, process.env.STUDY_MCP_SECRET ?? "")
    : null;
}
export async function guardStudyRequest(
  request: Request,
): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path === "/api/health" || path === "/api/study-mcp/session") return;
  if (
    path.startsWith("/_next/") ||
    /^\/(?:favicon|logos|avatars|vendor|fonts|locales|images)\b/.test(path)
  )
    return;
  const ticket = await studyTicket(request.headers);
  if (!ticket)
    return Response.json(
      {
        error: "請從 STUDY 開啟 OpenMAIC 課堂",
        code: "STUDY_SESSION_REQUIRED",
      },
      { status: 401 },
    );
  if (path.startsWith("/api/model-config") && request.method !== "GET")
    return Response.json(
      { error: "MCP 模式的模型 transport 由 STUDY 管理，無需 API key" },
      { status: 403 },
    );
  if (path.startsWith("/api/study-mcp/") && ticket.scope !== "api")
    return Response.json(
      { error: "MCP tasks require a signed service request" },
      { status: 403 },
    );
  if (ticket.classroom_id) {
    const match = path.match(
      /^\/(?:classroom|api\/stage-meta|api\/stages|api\/persistence\/documents)\/([^/]+)/,
    );
    if (match && decodeURIComponent(match[1]) !== ticket.classroom_id)
      return Response.json(
        { error: "Classroom is outside this STUDY session" },
        { status: 403 },
      );
  }
}
