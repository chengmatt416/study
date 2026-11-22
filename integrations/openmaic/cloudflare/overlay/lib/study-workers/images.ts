import { deflateSync } from 'node:zlib';
import { workersEnvironment } from './context';
import type { ImageTransform, ReadableStream as WorkerReadableStream } from '@cloudflare/workers-types';

type Raw = { width: number; height: number; channels: number };
const stream = (data: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } }) as WorkerReadableStream<Uint8Array>;
function imagesBinding() { const binding = workersEnvironment().IMAGES; if (!binding) throw new Error('Cloudflare Images binding is required'); return binding; }
function chunk(name: string, body: Buffer): Buffer {
  const type = Buffer.from(name), content = Buffer.concat([type, body]);
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(body.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, content, checksum]);
}
/** Encode PDF.js raw pixels without native libraries or a local filesystem. */
export function rawPng(data: Uint8Array, raw: Raw): Buffer {
  const { width, height, channels } = raw;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || ![1,2,3,4].includes(channels) || width * height * channels !== data.byteLength || data.byteLength > 64 * 1024 * 1024) throw new Error('Invalid or oversized raw image');
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height,4); ihdr[8] = 8; ihdr[9] = [0,0,4,2,6][channels];
  const stride = width * channels, rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) rows.set(data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
class WorkerImage {
  private transform: ImageTransform = {};
  private format: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png';
  private quality = 82;
  constructor(private data: Uint8Array) {}
  rotate() { return this; } // Images applies EXIF orientation during decoding.
  resize(options: { width: number; height: number; fit?: string; withoutEnlargement?: boolean }) { this.transform = { ...this.transform, width: options.width, height: options.height, fit: options.withoutEnlargement ? 'scale-down' : 'contain' }; return this; }
  flatten(options: { background: string }) { this.transform.background = options.background; return this; }
  webp(options: { quality?: number; effort?: number } = {}) { this.format = 'image/webp'; this.quality = options.quality ?? 82; return this; }
  jpeg(options: { quality?: number } = {}) { this.format = 'image/jpeg'; this.quality = options.quality ?? 82; return this; }
  png() { this.format = 'image/png'; return this; }
  async metadata() {
    const info = await imagesBinding().info(stream(this.data));
    if (!('width' in info)) throw new Error('Raster image dimensions required');
    return { ...info, format: info.format.replace('image/','').replace('jpg','jpeg') };
  }
  async toBuffer(): Promise<Buffer>;
  async toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
  async toBuffer(options?: { resolveWithObject: true }): Promise<Buffer | { data: Buffer; info: { width: number; height: number } }> {
    const images = imagesBinding();
    const output = await images.input(stream(this.data)).transform(this.transform).output({ format: this.format, quality: this.quality, anim: false });
    const data = Buffer.from(await output.response().arrayBuffer());
    if (!options) return data;
    const info = await images.info(stream(data));
    if (!('width' in info)) throw new Error('Transformed image has no dimensions');
    return { data, info: { width: info.width, height: info.height } };
  }
}
export default function image(data: Uint8Array, options?: { raw?: Raw; failOn?: string }): WorkerImage {
  return new WorkerImage(options?.raw ? rawPng(data, options.raw) : data);
}
