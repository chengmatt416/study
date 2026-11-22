import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import live from '../src/worker/routes/live-ai';
import { signOpenMaicTicket, verifyOpenMaicTicket } from '../src/shared/openmaic-transport';
import { testDatabase } from './helpers/d1';
import { devLogin, logout } from '../src/worker/lib/auth';
import { proxyOpenMaic } from '../src/worker/lib/openmaic-proxy';

describe('long classroom session renewal', () => {
  let fixture: ReturnType<typeof testDatabase>;
  afterEach(() => fixture?.db.close());
  it('renews only the current valid classroom and rechecks account access', async () => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('session-user','session@test.example',1); INSERT INTO allowlist(email,role,created_at) VALUES ('session@test.example','member',1)");
    const secret = 'session-test-secret-'.repeat(3), now = Date.now();
    const sessionHash = 'a'.repeat(64);
    fixture.db.prepare("INSERT INTO sessions(id_hash,user_id,expires_at,created_at) VALUES (?,'session-user',?,1)").run(sessionHash, now + 3600000);
    const token = await signOpenMaicTicket({ sub: 'study:session-user', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'lesson', session_hash: sessionHash, exp: now + 60000 }, secret);
    const env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: secret } as unknown as Env;
    const app = new Hono(); app.route('/live', live); app.onError(error => error instanceof HTTPException ? error.getResponse() : new Response('error', { status: 500 }));
    const request = (ticket: string, classroom = 'lesson') => app.request('https://study.test/live/session/refresh', { method: 'POST', headers: { cookie: 'study_openmaic=' + ticket, 'content-type': 'application/json' }, body: JSON.stringify({ classroom_id: classroom }) }, env);
    const response = await request(token);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly; SameSite=Lax; Max-Age=900; Secure');
    const renewed = await verifyOpenMaicTicket(cookie.split(';')[0].slice('study_openmaic='.length), secret);
    expect(renewed).toMatchObject({ sub: 'study:session-user', scope: 'classroom', classroom_id: 'lesson', session_hash: sessionHash });
    expect(renewed!.exp).toBeGreaterThan(now + 14 * 60_000);
    expect((await request(token, 'other-lesson')).status).toBe(409);
    const expired = await signOpenMaicTicket({ sub: 'study:session-user', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'lesson', exp: now - 1 }, secret);
    expect((await request(expired)).status).toBe(401);
    fixture.db.exec("DELETE FROM allowlist WHERE email='session@test.example'");
    expect((await request(token)).status).toBe(401);
  });

  it('binds legacy renewal to the signed-in learner, and revokes both classroom APIs and proxy access on logout', async () => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('session-user','session@test.example',1); INSERT INTO allowlist(email,role,created_at) VALUES ('session@test.example','member',1)");
    const secret = 'session-test-secret-'.repeat(3), env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: secret, DEV_LOGIN: '1', SESSION_PEPPER: 'test-pepper' } as unknown as Env;
    const app = new Hono(); app.get('/auth/dev', devLogin); app.post('/auth/logout', logout); app.route('/live', live); app.onError(error => error instanceof HTTPException ? error.getResponse() : new Response('error', { status: 500 }));
    const login = await app.request('http://localhost/auth/dev?email=session@test.example', { headers: { cookie: 'study_openmaic=old-native' } }, env);
    expect(login.headers.getSetCookie().some(value => value.startsWith('study_openmaic=;'))).toBe(true);
    const rootCookie = login.headers.getSetCookie().find(value => value.startsWith('__Host-sid='))!.split(';')[0];
    const legacy = await signOpenMaicTicket({ sub: 'study:session-user', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'lesson', exp: Date.now() + 60000 }, secret);
    const renew = (cookie: string) => app.request('http://localhost/live/session/refresh', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ classroom_id: 'lesson' }) }, env);
    expect((await renew('study_openmaic=' + legacy)).status).toBe(401);
    const refreshed = await renew(rootCookie + '; study_openmaic=' + legacy);
    expect(refreshed.status).toBe(200);
    const nativeCookie = refreshed.headers.getSetCookie()[0].split(';')[0];
    const ticket = await verifyOpenMaicTicket(nativeCookie.slice('study_openmaic='.length), secret);
    expect(ticket?.session_hash).toMatch(/^[a-f0-9]{64}$/);
    const out = await app.request('http://localhost/auth/logout', { method: 'POST', headers: { cookie: rootCookie + '; ' + nativeCookie } }, env);
    expect(out.headers.getSetCookie().some(value => value.startsWith('study_openmaic=;'))).toBe(true);
    expect(fixture.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect((await renew(nativeCookie)).status).toBe(401);
    expect((await app.request('http://localhost/live/progress', { headers: { cookie: nativeCookie } }, env)).status).toBe(401);
    const upstream = vi.fn(async () => new Response('should not load'));
    const response = await proxyOpenMaic(new Request('https://study.test/classroom/lesson', { headers: { cookie: nativeCookie, accept: 'text/html' } }), { ...env, OPENMAIC_CORE: { fetch: upstream } } as unknown as Env);
    expect(response?.status).toBe(401); expect(response?.headers.get('content-type')).toContain('text/html'); expect(await response?.text()).toContain('返回 STUDY'); expect(upstream).not.toHaveBeenCalled();
  });

  it('replacing the browser login revokes its previous classroom binding', async () => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('first','first@test.example',1),('second','second@test.example',1); INSERT INTO allowlist(email,role,created_at) VALUES ('first@test.example','member',1),('second@test.example','member',1)");
    const secret = 'session-test-secret-'.repeat(3), env = { DB: fixture.DB, OPENMAIC_MCP_SECRET: secret, DEV_LOGIN: '1', SESSION_PEPPER: 'test-pepper' } as unknown as Env;
    const app = new Hono(); app.get('/auth/dev', devLogin); app.route('/live', live);
    const firstLogin = await app.request('http://localhost/auth/dev?email=first@test.example', {}, env);
    const firstCookie = firstLogin.headers.getSetCookie().find(value => value.startsWith('__Host-sid='))!.split(';')[0];
    const row = fixture.db.prepare("SELECT id_hash FROM sessions WHERE user_id='first'").get()!;
    const token = await signOpenMaicTicket({ sub: 'study:first', aud: 'study-openmaic', scope: 'classroom', classroom_id: 'lesson', session_hash: String(row.id_hash), exp: Date.now() + 60000 }, secret);
    expect((await app.request('http://localhost/live/progress', { headers: { cookie: 'study_openmaic=' + token } }, env)).status).toBe(200);
    const secondLogin = await app.request('http://localhost/auth/dev?email=second@test.example', { headers: { cookie: firstCookie + '; study_openmaic=' + token } }, env);
    expect(secondLogin.headers.getSetCookie().some(value => value.startsWith('study_openmaic=;'))).toBe(true);
    expect(fixture.db.prepare('SELECT user_id FROM sessions').all()).toEqual([{ user_id: 'second' }]);
    expect((await app.request('http://localhost/live/progress', { headers: { cookie: 'study_openmaic=' + token } }, env)).status).toBe(401);
  });
});
