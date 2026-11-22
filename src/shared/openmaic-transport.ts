export interface OpenMaicTicket {
  sub: string;
  exp: number;
  aud: "study-openmaic";
  scope: "api" | "classroom";
  classroom_id?: string;
  session_hash?: string;
}
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function key(secret: string) {
  if (secret.length < 32) throw new Error("OpenMAIC transport secret must be at least 32 characters");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signOpenMaicTicket(ticket: OpenMaicTicket, secret: string): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(ticket)));
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))))}`;
}
export async function verifyOpenMaicTicket(value: string, secret: string, now = Date.now()): Promise<OpenMaicTicket | null> {
  try {
    if (value.length > 4096) return null;
    const parts = value.split(".");
    if (parts.length !== 2 || !await crypto.subtle.verify("HMAC", await key(secret), decode(parts[1]), encoder.encode(parts[0]))) return null;
    const ticket = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as OpenMaicTicket;
    if (ticket.aud !== "study-openmaic" || !["api", "classroom"].includes(ticket.scope) || typeof ticket.sub !== "string" || !/^study:[A-Za-z0-9_-]{1,200}$/.test(ticket.sub) || !Number.isSafeInteger(ticket.exp) || ticket.exp <= now || ticket.exp > now + 15 * 60_000) return null;
    if (ticket.classroom_id !== undefined && (typeof ticket.classroom_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(ticket.classroom_id))) return null;
    if (ticket.session_hash !== undefined && (typeof ticket.session_hash !== "string" || !/^[a-f0-9]{64}$/.test(ticket.session_hash))) return null;
    return ticket;
  } catch { return null; }
}
