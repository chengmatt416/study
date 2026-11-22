export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isRaw = body instanceof Blob || body instanceof ArrayBuffer || body instanceof FormData;
  const res = await fetch(path.startsWith("/") ? path : `/api/${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined || isRaw ? init.headers : { "content-type": "application/json", ...init.headers },
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  });
  if (res.status === 401 && !path.includes("/me")) {
    const here = location.pathname + location.search;
    location.href = `/login?redirect=${encodeURIComponent(here)}`;
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const d = (typeof data === "object" ? data : { error: data }) as Record<string, unknown>;
    throw new ApiError(String(d.error ?? `HTTP ${res.status}`), res.status, d);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("POST", path, body ?? {}, init),
  put: <T>(path: string, body?: unknown, init?: RequestInit) => request<T>("PUT", path, body ?? {}, init),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const errs = e.data.errors as string[] | undefined;
    return errs?.length ? `${e.message}\n• ${errs.join("\n• ")}` : e.message;
  }
  if (e instanceof TypeError) return "網路連線失敗，請稍後再試";
  return (e as Error)?.message ?? "發生錯誤";
}
