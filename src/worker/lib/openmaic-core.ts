import { bad } from "./util";
import { signOpenMaicTicket } from "../../shared/openmaic-transport";

export type OpenMaicCoreEnv = Env & { OPENMAIC_CORE?: Fetcher; OPENMAIC_CORE_URL?: string; OPENMAIC_MCP_SECRET?: string };
export function coreConfiguration(env: OpenMaicCoreEnv) {
  if (!env.OPENMAIC_CORE_URL || (env.OPENMAIC_MCP_SECRET ?? "").length < 32) bad("尚未設定完整 OpenMAIC core。請部署 OpenMAIC Workers，並設定 OPENMAIC_CORE_URL / OPENMAIC_MCP_SECRET。", 503);
  let url: URL;
  try { url = new URL(env.OPENMAIC_CORE_URL); }
  catch { bad("OPENMAIC_CORE_URL 必須是有效的官方服務網址", 503); }
  if (url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol) || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) bad("OpenMAIC core 必須使用 HTTPS；僅本機可使用 HTTP", 503);
  return { origin: url.origin, secret: env.OPENMAIC_MCP_SECRET! };
}
export async function coreRequest<T = Record<string, unknown>>(env: OpenMaicCoreEnv, userId: string, method: string, path: string, body?: unknown, extraHeaders?: HeadersInit): Promise<T> {
  const config = coreConfiguration(env);
  if (!path.startsWith("/api/") || path.startsWith("//")) throw new Error("Invalid core API path");
  const ticket = await signOpenMaicTicket({ sub: `study:${userId}`, aud: "study-openmaic", scope: "api", exp: Date.now() + 60_000 }, config.secret);
  const headers = new Headers(extraHeaders);
  headers.set("authorization", `Bearer ${ticket}`);
  const raw = typeof body === "string" || body instanceof Uint8Array;
  if (body !== undefined && !raw) headers.set("content-type", "application/json");
  let response: Response;
  try {
    const url = new URL(path, config.origin);
    headers.set("host", url.host);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
    const init: RequestInit = { method, headers, body: body === undefined ? undefined : raw ? body as BodyInit : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20_000) };
    response = env.OPENMAIC_CORE ? await env.OPENMAIC_CORE.fetch(new Request(url, init)) : await fetch(url, init);
  } catch (error) {
    console.error("OpenMAIC core connection failed", { origin: config.origin, name: error instanceof Error ? error.name : "UnknownError", message: error instanceof Error ? error.message.slice(0, 500) : "Unknown connection error" });
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      bad(method === "GET" ? "OpenMAIC core 讀取逾時；既有作業可用原 ID 續接，請稍後重試。" : "OpenMAIC core 回應逾時；請先查詢既有作業或任務狀態，再決定是否重試。", 503);
    }
    bad("無法連線到 OpenMAIC core，請確認官方服務正在運行。", 502);
  }
  if (response!.status >= 300 && response!.status < 400) bad("OpenMAIC core 回傳重新導向；請設定直接連線的 HTTPS origin。", 502);
  let data: Record<string, unknown>;
  try {
    const value: unknown = await response!.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid core response");
    data = value as Record<string, unknown>;
  } catch { bad("OpenMAIC core 尚未就緒或回傳無效內容，請確認服務狀態後重試。", 502); }
  if (!response!.ok) {
    const error = data.error;
    bad(typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String(error.message) : "OpenMAIC core 拒絕此操作", response!.status === 429 ? 429 : response!.status === 409 ? 409 : response!.status === 422 ? 422 : response!.status === 404 ? 404 : response!.status === 403 ? 403 : response!.status === 400 ? 400 : 502, Array.isArray(data.errors) ? { errors: data.errors.filter((item): item is string => typeof item === "string").slice(0, 30) } : undefined);
  }
  return data as T;
}
