import { describe, expect, it, vi } from 'vitest';
import { proxyOpenMaic } from '../src/worker/lib/openmaic-proxy';
import { isOpenMaicPublicPath } from '../src/shared/openmaic-routing';
import { signOpenMaicTicket } from '../src/shared/openmaic-transport';

describe('同網域原生 OpenMAIC', () => {
  it('保留 STUDY API、供應商檔案與私有 MCP / scheduler 的路由', () => {
    for (const path of ['/api/openmaic/generations', '/api/documents/note', '/api/auth/google/start', '/vendor/geogebra/deployggb.js', '/vendor/pdfjs/pdf.mjs', '/api/study-mcp/tasks', '/api/study-workers/tick', '/mcp']) expect(isOpenMaicPublicPath(path)).toBe(false);
    for (const path of ['/classroom/native', '/_next/static/chunks/a.js', '/api/persistence/documents/native', '/api/access-code/status', '/api/quiz-grade', '/api/study-mcp/session', '/avatars/teacher.png', '/vendor/interactive/three/three.min.js']) expect(isOpenMaicPublicPath(path)).toBe(true);
  });
  it('串流原生課堂，僅傳課堂 cookie，保留同網域重新導向和 RSC 標頭', async () => {
    const secret = 'proxy-test-secret-'.repeat(3);
    const ticket = await signOpenMaicTicket({ sub: 'study:learner', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'native', exp: Date.now() + 60000 }, secret);
    const upstream = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://study.example/classroom/native?_rsc=1');
      expect(request.headers.get('cookie')).toBe(`study_openmaic=${ticket}; locale=zh-TW`);
      expect(request.headers.get('accept-language')).toBe('zh-TW');
      expect(request.headers.get('authorization')).toBeNull();
      expect(request.headers.get('rsc')).toBe('1');
      expect(request.headers.get('x-forwarded-host')).toBe('study.example');
      expect(request.headers.get('x-study-host')).toBe('1');
      return new Response('native-next-stream', { headers: { 'content-type': 'text/x-component', 'cache-control': 'public, max-age=600' } });
    });
    const env = { OPENMAIC_CORE: { fetch: upstream }, OPENMAIC_MCP_SECRET: secret } as unknown as Env;
    const result = await proxyOpenMaic(new Request('https://study.example/classroom/native?_rsc=1', { headers: { cookie: `__Host-sid=private-study-login; study_openmaic=${ticket}; locale=zh-TW; oauth=private`, authorization: 'Bearer private-oauth', rsc: '1' } }), env);
    expect(await result!.text()).toBe('native-next-stream');
    expect(result!.headers.get('cache-control')).toBe('private, no-store');
  });
  it('跨站寫入被擋下；同網域表單登入仍回傳原生 session cookie', async () => {
    const upstream = vi.fn(async (request: Request) => {
      expect(await request.text()).toBe('ticket=signed');
      return new Response(null, { status: 303, headers: { location: '/classroom/native', 'set-cookie': 'study_openmaic=session; Path=/; HttpOnly; Secure; SameSite=Lax' } });
    });
    const env = { OPENMAIC_CORE: { fetch: upstream } } as unknown as Env;
    const request = (origin: string) => new Request('https://study.example/api/study-mcp/session', { method: 'POST', headers: { origin }, body: 'ticket=signed' });
    expect((await proxyOpenMaic(request('https://attacker.example'), env))!.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    const result = await proxyOpenMaic(request('https://study.example'), env);
    expect(result!.status).toBe(303);
    expect(result!.headers.get('location')).toBe('/classroom/native');
    expect(result!.headers.get('set-cookie')).toContain('study_openmaic=session');
  });
  it('私人課堂圖片不沿用上游的公開快取標頭，只讓本機瀏覽器保留一小時', async () => {
    const env = { OPENMAIC_CORE: { fetch: async () => new Response('private image', { headers: { 'cache-control': 'public, max-age=86400' } }) } } as unknown as Env;
    const result = await proxyOpenMaic(new Request('https://study.example/api/classroom-media/native/private.png'), env);
    expect(result!.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(result!.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('媒體失敗、非 GET 與其他私人 API 仍然不快取', async () => {
    const missing = { OPENMAIC_CORE: { fetch: async () => new Response('missing', { status: 404 }) } } as unknown as Env;
    expect((await proxyOpenMaic(new Request('https://study.example/api/classroom-media/native/gone.png'), missing))!.headers.get('cache-control')).toBe('private, no-store');
    const ok = { OPENMAIC_CORE: { fetch: async () => new Response('x', { headers: { 'cache-control': 'public, max-age=60' } }) } } as unknown as Env;
    expect((await proxyOpenMaic(new Request('https://study.example/api/stages/native'), ok))!.headers.get('cache-control')).toBe('private, no-store');
    expect((await proxyOpenMaic(new Request('https://study.example/api/classroom-media/native/a.png', { method: 'POST', headers: { origin: 'https://study.example' } }), ok))!.headers.get('cache-control')).toBe('private, no-store');
  });
  it('沙盒互動教材可讀取公開字型，而不開放私人 API 的跨源存取', async () => {
    const env = { OPENMAIC_CORE: { fetch: async () => new Response('font', { headers: { 'cache-control': 'public, max-age=86400' } }) } } as unknown as Env;
    const result = await proxyOpenMaic(new Request('https://study.example/vendor/interactive/katex%400.16.38/dist/fonts/KaTeX_Main-Regular.woff2'), env);
    expect(result!.headers.get('access-control-allow-origin')).toBe('*');
    expect(result!.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(result!.headers.get('cache-control')).toBe('public, max-age=86400');
  });
});
