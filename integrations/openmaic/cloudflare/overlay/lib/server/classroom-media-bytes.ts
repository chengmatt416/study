import { createHash } from 'node:crypto';
import { workersEnvironment } from '@/lib/study-workers/context';

function extensionForMime(mime: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' } as Record<string,string>)[mime] ?? 'bin';
}
export async function persistClassroomMediaBytes(input: { stageId: string; bytes: Buffer | Uint8Array; mime: string; prefix?: string; signal?: AbortSignal }): Promise<string> {
  input.signal?.throwIfAborted();
  const hash = createHash('sha256').update(input.bytes).digest('hex');
  const filename = `${input.prefix ?? 'generated'}-${hash}.${extensionForMime(input.mime)}`;
  await workersEnvironment().OPENMAIC_FILES.put(`openmaic/classroom-media/${input.stageId}/media/${filename}`, input.bytes, { httpMetadata: { contentType: input.mime } });
  input.signal?.throwIfAborted();
  return `/api/classroom-media/${input.stageId}/media/${filename}`;
}
