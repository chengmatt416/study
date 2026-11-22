type SecretEnv = Env & { LIVE_AI_ENCRYPTION_KEY?: string };
async function encryptionKey(env: SecretEnv) {
  const value = env.LIVE_AI_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Live AI encryption key unavailable');
  const bytes = Uint8Array.from(value.match(/../g)!, part => parseInt(part, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const aad = new TextEncoder().encode('study/live-ai/openrouter/v1');
export async function encryptLiveAiKey(env: SecretEnv, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await encryptionKey(env), new TextEncoder().encode(value)));
  return 'v1.' + btoa(String.fromCharCode(...iv, ...ciphertext));
}
export async function decryptLiveAiKey(env: SecretEnv, envelope: string): Promise<string> {
  if (!envelope.startsWith('v1.')) throw new Error('Unknown key envelope');
  const bytes = Uint8Array.from(atob(envelope.slice(3)), char => char.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0,12), additionalData: aad }, await encryptionKey(env), bytes.slice(12)));
}
