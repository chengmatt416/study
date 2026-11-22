import { isLiveAiPurpose, type LiveAiPurpose } from './ai-boundary';
export interface LiveAiGrant { sub: string; turn: string; classroom: string; purpose: LiveAiPurpose; exp: number }
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
async function key(secret: string) {
  if (secret.length < 32) throw new Error('Live AI signing secret unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signLiveAiGrant(grant: LiveAiGrant, secret: string): Promise<string> {
  const payload = encode(encoder.encode(JSON.stringify(grant)));
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode('study-live-ai/v1:' + payload))))}`;
}
export async function verifyLiveAiGrant(token: string, secret: string, now = Date.now()): Promise<LiveAiGrant | null> {
  try {
    if (token.length > 4096) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || !await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode('study-live-ai/v1:' + payload))) return null;
    const grant = JSON.parse(new TextDecoder().decode(decode(payload))) as LiveAiGrant;
    if (!/^study:[A-Za-z0-9_-]{1,200}$/.test(grant.sub) || !/^[A-Za-z0-9_-]{1,200}$/.test(grant.classroom) || !/^[a-f0-9-]{36}$/.test(grant.turn) || !isLiveAiPurpose(grant.purpose) || !Number.isSafeInteger(grant.exp) || grant.exp <= now || grant.exp > now + 180000) return null;
    return grant;
  } catch { return null; }
}
