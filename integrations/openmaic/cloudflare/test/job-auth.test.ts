import { test, expect } from 'vitest';
import { signOpenMaicTicket } from '@/lib/study-mcp/protocol';
import { isCoreJobRequest, CORE_JOB_OWNER } from '@/lib/study-workers/job-auth';

test('only signed coordinator API tickets can execute private core ticks', async () => {
  const secret = 'worker-contract-secret-with-at-least-32-characters';
  const make = async (sub: string, scope: 'api' | 'classroom', exp = Date.now() + 60_000, method = 'POST', path = '/api/study-workers/tick') => new Request('https://core' + path, { method, headers: { authorization: 'Bearer ' + await signOpenMaicTicket({ sub, scope, aud: 'study-openmaic', exp }, secret) } });
  expect(await isCoreJobRequest(await make(CORE_JOB_OWNER, 'api'), secret)).toBe(true);
  expect(await isCoreJobRequest(await make('study:another-user', 'api'), secret)).toBe(false);
  expect(await isCoreJobRequest(await make(CORE_JOB_OWNER, 'classroom'), secret)).toBe(false);
  expect(await isCoreJobRequest(await make(CORE_JOB_OWNER, 'api', Date.now() - 1000), secret)).toBe(false);
  expect(await isCoreJobRequest(await make(CORE_JOB_OWNER, 'api', Date.now() + 60_000, 'GET'), secret)).toBe(false);
  expect(await isCoreJobRequest(await make(CORE_JOB_OWNER, 'api', Date.now() + 60_000, 'POST', '/api/stages'), secret)).toBe(false);
  expect(await isCoreJobRequest(new Request('https://core/api/study-workers/tick', { method: 'POST' }), secret)).toBe(false);
});
