import { workersEnvironment } from './context';

export async function parseInWorker<T>(path: 'images' | 'pptx', body: string | ArrayBuffer, signal?: AbortSignal): Promise<T> {
  const response = await workersEnvironment().OPENMAIC_PARSER.fetch(`https://parser/${path}`, {
    method: 'POST', body, signal: signal as import('@cloudflare/workers-types').AbortSignal | undefined,
  });
  const payload = await response.json<{ error?: string } & T>();
  if (!response.ok || payload.error) throw Object.assign(new Error(payload.error ?? `Document parser failed (${response.status})`), { retryable: response.status === 429 || response.status >= 500 });
  return payload;
}
