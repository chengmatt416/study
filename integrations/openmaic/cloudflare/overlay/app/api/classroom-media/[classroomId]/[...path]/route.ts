import { NextRequest } from 'next/server';
import { workersEnvironment } from '@/lib/study-workers/context';
import { isValidClassroomId, classroomMediaMimeType } from '@/lib/server/classroom-storage';
import { readStageAccessIncludingDeleted } from '@/lib/server/stage-access';
import { parseRangeHeader } from '@/lib/server/http-range';

export async function GET(request: NextRequest, { params }: { params: Promise<{ classroomId: string; path: string[] }> }) {
  const { classroomId, path } = await params;
  if (!isValidClassroomId(classroomId) || !['media', 'audio'].includes(path[0]) || path.some(part => !part || /\.\.|[\\/\0]/.test(part))) return new Response('Not found', { status: 404 });
  const access = await readStageAccessIncludingDeleted(classroomId);
  if (access?.deletedAt != null) return new Response('Not found', { status: 404 });
  const bucket = workersEnvironment().OPENMAIC_FILES, key = `openmaic/classroom-media/${classroomId}/${path.join('/')}`;
  const object = await bucket.head(key);
  if (!object) return new Response('Not found', { status: 404 });
  const range = parseRangeHeader(request.headers.get('range'), object.size);
  if (range.kind === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${object.size}` } });
  const bytes = await bucket.get(key, range.kind === 'range' ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!bytes) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'Cache-Control': 'private, max-age=300, must-revalidate', 'Accept-Ranges': 'bytes', 'Content-Type': classroomMediaMimeType('.' + path.at(-1)?.split('.').at(-1)) ?? 'application/octet-stream', 'Content-Length': String(range.kind === 'range' ? range.end - range.start + 1 : object.size), ETag: object.httpEtag });
  if (range.kind === 'range') headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
  return new Response(bytes.body as ReadableStream<Uint8Array> & typeof bytes.body, { status: range.kind === 'range' ? 206 : 200, headers });
}
