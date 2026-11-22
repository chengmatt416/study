import type { ExportedHandler, Request as WorkerRequest, Response as WorkerResponse } from '@cloudflare/workers-types';
import { runImageJob } from '@/lib/server/material-extraction/document-image-worker.cloudflare.mjs';
import { runPptxJob } from '@/lib/server/agent-runtime/import-pptx-worker.cloudflare.mjs';

let busy = false;
function response(body: BodyInit, status: number, headers?: HeadersInit): WorkerResponse {
  return new Response(body, { status, headers }) as Response & WorkerResponse;
}
function json(body: unknown, status: number): WorkerResponse {
  return response(JSON.stringify(body), status, { 'content-type': 'application/json' });
}
async function readBounded(request: Pick<WorkerRequest, 'body'>, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Document exceeds the parser input limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
const worker: ExportedHandler = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/images','/pptx'].includes(path)) return response('Not found', 404);
    if (busy) return json({ error: 'Document parser is busy; retry shortly' }, 429);
    busy = true;
    try {
      const body = await readBounded(request, path === '/images' ? 8 * 1024 * 1024 : 32 * 1024 * 1024);
      const result = path === '/images' ? runImageJob(JSON.parse(new TextDecoder().decode(body))) : await runPptxJob({ buffer: body.buffer });
      return json(result, result.error ? 422 : 200);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Document parsing failed' }, 422); }
    finally { busy = false; }
  },
};
export default worker;
