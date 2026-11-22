import { LIVE_CLASSROOM_PATHS, isLiveClassroomInput } from '../../shared/live-classroom';
import { isOpenMaicPublicPath } from '../../shared/openmaic-routing';
import { HTTPException } from 'hono/http-exception';
import { admitLiveAiTurn, boundedJson, classroomIdentity, liveAiError } from './live-ai/service';
import type { OpenMaicCoreEnv } from './openmaic-core';
import { activeClassroomTicket, expiredClassroomResponse } from './classroom-session';

export async function proxyOpenMaic(request: Request, env: OpenMaicCoreEnv): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!isOpenMaicPublicPath(url.pathname)) return;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin !== url.origin) return Response.json({ error: '請從 STUDY 課堂操作' }, { status: 403 });
  }
  if (!env.OPENMAIC_CORE) return Response.json({ error: 'OpenMAIC 課堂尚未就緒' }, { status: 503 });
  const headers = new Headers(request.headers);
  const publicAsset = /^(?:\/_next\/static\/|\/(?:avatars|logos|vendor)\/|\/(?:openmaic-mark|logo-horizontal)\.png$)/.test(url.pathname);
  // STUDY login and OAuth credentials never cross into the classroom service.
  headers.delete('authorization');
  headers.delete('x-study-live-grant');
  headers.delete('cookie');
  const cookies = request.headers.get('cookie')?.split(';').map(value => value.trim()).filter(value => /^(?:study_openmaic|locale)=/.test(value));
  if (cookies?.length) headers.set('cookie', cookies.join('; '));
  headers.set('accept-language', 'zh-TW');
  headers.set('x-study-host', '1');
  headers.set('host', url.host);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
  try {
    if (!publicAsset && url.pathname !== '/api/study-mcp/session' && /(?:^|;\s*)study_openmaic=/.test(request.headers.get('cookie') ?? '') && !await activeClassroomTicket(request, env)) {
      return expiredClassroomResponse(request);
    }
    if (LIVE_CLASSROOM_PATHS.has(url.pathname)) {
      if (request.method !== 'POST') return Response.json({error:'Method not allowed'},{status:405,headers:{allow:'POST','cache-control':'no-store'}});
      const identity = await classroomIdentity(request, env);
      const body = await boundedJson(request.clone(), 2100000);
      if (!isLiveClassroomInput(url.pathname, body)) liveAiError('請輸入問題或選擇課堂討論', 400, 'live_input_required');
      headers.set('x-study-live-grant', await admitLiveAiTurn(env, identity.user, identity.classroom, 'interaction'));
    }
    const response = await env.OPENMAIC_CORE.fetch(new Request(request, { headers, redirect: 'manual' }));
    const result = new Response(response.body, response);
    if (publicAsset) {
      // Generated HTML keeps an opaque sandbox origin, including its fonts.
      result.headers.set('access-control-allow-origin', '*');
      result.headers.set('cross-origin-resource-policy', 'cross-origin');
    }
    // Lesson images and video do not change once generated; keeping them for an hour makes revisits and later scenes instant.
    if (request.method === 'GET' && url.pathname.startsWith('/api/classroom-media/') && result.ok) result.headers.set('cache-control', 'private, max-age=3600');
    else if (!publicAsset) result.headers.set('cache-control', 'private, no-store');
    result.headers.set('x-content-type-options', 'nosniff');
    if (result.ok && /^\/classroom(?:\/|$)/.test(url.pathname) && result.headers.get('content-type')?.includes('text/html')) {
      return new HTMLRewriter().on('head', {
        element(head) { head.append('<link rel="stylesheet" href="/openmaic-host.css">', { html: true }); },
      }).transform(result);
    }
    return result;
  } catch (error) {
    if (error instanceof HTTPException) return error.getResponse();
    console.error('OpenMAIC classroom proxy failed', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: '課堂連線暫時中斷，請重新整理後再試。' }, { status: 502 });
  }
}
