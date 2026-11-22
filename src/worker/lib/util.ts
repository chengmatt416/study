import { HTTPException } from "hono/http-exception";

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

export function bad(message: string, status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 = 400, extra?: Record<string, unknown>): never {
  throw new HTTPException(status, { res: Response.json({ error: message, ...extra }, { status }) });
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function slugifyAscii(text: string): string {
  const s = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "doc";
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    bad("請求內容不是合法 JSON");
  }
}

export function str(v: unknown, field: string, { max = 500, optional = false } = {}): string {
  if (v === undefined || v === null || v === "") {
    if (optional) return "";
    bad(`缺少欄位 ${field}`);
  }
  if (typeof v !== "string") bad(`${field} 必須是字串`);
  if (v.length > max) bad(`${field} 太長（上限 ${max}）`);
  return v;
}
