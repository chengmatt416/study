import { Readable } from "node:stream";
import type { R2UploadedPart } from '@cloudflare/workers-types';
import type { MaterialByteInput, MaterialByteStore } from "@/lib/server/materials/bytes";
import { workersEnvironment } from "./context";

const prefix = "openmaic/materials/";
const PART_BYTES = 5 * 1024 * 1024;
async function* webChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try { for (;;) { const { value, done } = await reader.read(); if (done) return; yield value; } }
  finally { reader.releaseLock(); }
}
export const workersMaterialByteStore: MaterialByteStore = {
  async put(key: string, body: MaterialByteInput, mime?: string): Promise<void> {
    const bucket = workersEnvironment().OPENMAIC_FILES;
    const options = mime ? { httpMetadata: { contentType: mime } } : undefined;
    if (body instanceof Uint8Array) { await bucket.put(prefix + key, body, options); return; }
    const stream = body instanceof Readable ? body : webChunks(body);
    const upload = await bucket.createMultipartUpload(prefix + key, options);
    const parts: R2UploadedPart[] = [];
    let buffer = new Uint8Array(PART_BYTES), used = 0;
    try {
      for await (const value of stream) {
        const chunk = typeof value === "string" ? Buffer.from(value) : new Uint8Array(value);
        for (let offset = 0; offset < chunk.byteLength;) {
          const count = Math.min(PART_BYTES - used, chunk.byteLength - offset);
          buffer.set(chunk.subarray(offset, offset + count), used); used += count; offset += count;
          if (used === PART_BYTES) { parts.push(await upload.uploadPart(parts.length + 1, buffer)); buffer = new Uint8Array(PART_BYTES); used = 0; }
        }
      }
      if (used || !parts.length) parts.push(await upload.uploadPart(parts.length + 1, buffer.subarray(0, used)));
      await upload.complete(parts);
    } catch (error) { await upload.abort(); throw error; }
  },
  async get(key: string): Promise<Buffer> {
    const value = await workersEnvironment().OPENMAIC_FILES.get(prefix + key);
    if (!value) throw Object.assign(new Error("Material bytes not found"), { code: "ENOENT" });
    return Buffer.from(await value.arrayBuffer());
  },
  async delete(key: string): Promise<void> { await workersEnvironment().OPENMAIC_FILES.delete(prefix + key); },
  async deletePrefix(key: string): Promise<void> {
    if (!key.endsWith('/')) throw new Error(`invalid material object prefix: ${key}`);
    const bucket = workersEnvironment().OPENMAIC_FILES;
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: prefix + key, cursor });
      if (page.objects.length) await bucket.delete(page.objects.map((item) => item.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  },
  async list(key: string): Promise<Array<{ key: string; modifiedAt: number }>> {
    if (!key.endsWith('/')) throw new Error(`invalid material object prefix: ${key}`);
    const result: Array<{ key: string; modifiedAt: number }> = [];
    let cursor: string | undefined;
    do {
      const page = await workersEnvironment().OPENMAIC_FILES.list({ prefix: prefix + key, delimiter: "/", cursor });
      result.push(...page.objects.map((item) => ({ key: item.key.slice(prefix.length), modifiedAt: item.uploaded.getTime() })));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return result;
  },
};
