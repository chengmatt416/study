// 內部 API 橋接：MCP 工具重用既有的 REST 路由（權限、驗證邏輯完全一致）。
// 使用者身分透過 WeakMap 綁定在「Worker 內部建立的 Request 物件」上，外部請求無法偽造。
import { Hono, type ExecutionContext } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, SessionUser } from "../lib/types";
import books from "../routes/books";
import docs from "../routes/documents";
import exams from "../routes/exams";
import writingPractice, { writingMcp } from "../routes/writing-practice";
import practiceMcp from "../routes/practice-mcp";
import decks from "../routes/decks";
import misc from "../routes/misc";
import learning from "../routes/learning";
import timetable from "../routes/timetable";
import content from "../routes/content";
import chapters from "../routes/chapters";
import courseGenerations from "../routes/course-generations";
import openMaicCore from "../routes/openmaic-core";
import longCourses from "../routes/long-courses";
import { enforceAccess } from "../lib/access";

const internalUsers = new WeakMap<Request, SessionUser>();

const internal = new Hono<AppEnv>().basePath("/api");
internal.use("*", async (c, next) => {
  const user = internalUsers.get(c.req.raw);
  if (!user) return c.json({ error: "forbidden" }, 403);
  c.set("user", user);
  await next();
});
internal.use("*", enforceAccess);
internal.route("/books", books);
internal.route("/documents", docs);
internal.route("/course-generations", courseGenerations);
internal.route("/openmaic", openMaicCore);
internal.route("/long-courses", longCourses);
internal.route("/learning", learning);
internal.route("/timetable", timetable);
internal.route("/content", content);
internal.route("/chapters", chapters);
internal.route("/exams", exams);
internal.route("/writing/mcp", writingMcp);
internal.route("/writing", writingPractice);
internal.route("/practice/mcp", practiceMcp);
internal.route("/decks", decks);
internal.route("/", misc);
internal.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("internal api error", err);
  return c.json({ error: "伺服器錯誤" }, 500);
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(details.length ? `${message}\n- ${details.join("\n- ")}` : message);
  }
}

/** Binary responses keep the same identity binding and ACL middleware as JSON calls. */
export async function callApiResponse(env: Env, ctx: ExecutionContext, user: SessionUser, method: string, path: string, body?: unknown, headers?: HeadersInit): Promise<Response> {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  const req = new Request(`https://internal${path}`, {
    method, headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  internalUsers.set(req, user);
  return internal.fetch(req, env, ctx);
}

export async function callApi<T = unknown>(env: Env, ctx: ExecutionContext, user: SessionUser, method: string, path: string, body?: unknown): Promise<T> {
  const res = await callApiResponse(env, ctx, user, method, path, body);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(data.error ?? `HTTP ${res.status}`), res.status, (data.errors as string[]) ?? []);
  return data as T;
}
