import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { signOpenMaicTicket } from '../../../../src/shared/openmaic-transport.ts';
const file = process.env.OPENMAIC_DATABASE_SECRETS ?? '.openmaic/cloudflare-db/secrets.json';
const { DATABASE_ADMIN_SECRET: secret } = JSON.parse(await readFile(file, 'utf8'));
const ticket = await signOpenMaicTicket({ sub: 'study:database-contract', aud: 'study-openmaic', scope: 'api', exp: Date.now() + 60_000 }, secret);
const origin = process.env.OPENMAIC_DATABASE_ORIGIN;
if (!origin) throw new Error('Set OPENMAIC_DATABASE_ORIGIN to your own HTTPS Worker origin.');
const response = await fetch(new URL('/internal/contract', origin), { headers: { authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(60_000) });
const result = await response.json();
assert.equal(response.status, 200, JSON.stringify(result));
assert.deepEqual(result.persisted.rows, [{ payload: { correct: true, trigger: true } }]);
assert.equal(result.rolledBack, true);
assert.equal(result.persisted.rowCount, 1);
assert.equal(result.eventWakeup, true);
assert.equal(result.advisoryIsolation, true);
const baselineFile = '.openmaic/cloudflare-db/persistence-probes.json';
let baselines;
try { baselines = JSON.parse(await readFile(baselineFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; baselines = {}; }
assert.equal(typeof result.nonce, 'string');
if (baselines[origin]) assert.equal(result.nonce, baselines[origin], 'Cloud PostgreSQL lost data across cold starts/deployments');
else { baselines[origin] = result.nonce; await writeFile(baselineFile, JSON.stringify(baselines), { mode: 0o600 }); }
console.log('Cloud PostgreSQL: JSONB persistence, PL/pgSQL trigger, rollback, row counts, advisory isolation, and durable event wakeup passed.');
