import { test, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PostgresEngine } from '../src/postgres-engine';
import { workersScope } from '@/lib/study-workers/context';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { createGenerationRun } from '@/lib/server/generation/run/store';
import { withMcpScope } from '@/lib/study-mcp/context';
import { requestMcpOutput, submitTask } from '@/lib/study-mcp/store';
import { tick } from '@/lib/study-workers/tick';
import { rawPng } from '@/lib/study-workers/images';
import { installBuiltinSkills } from '@/lib/study-workers/skills';
import { crc32, inflateSync } from 'node:zlib';

test('raw PDF image encoding preserves pixels, PNG colour types, and CRCs', () => {
  for (const channels of [1, 2, 3, 4]) {
    const pixels = Uint8Array.from({ length: 4 * channels }, (_, index) => index * 11);
    const png = rawPng(pixels, { width: 2, height: 2, channels });
    expect([...png.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
    const compressed: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
      const data = png.subarray(offset + 8, offset + 8 + size);
      expect(crc32(png.subarray(offset + 4, offset + 8 + size))).toBe(png.readUInt32BE(offset + 8 + size));
      if (type === 'IHDR') { expect(data.readUInt32BE(0)).toBe(2); expect(data.readUInt32BE(4)).toBe(2); expect(data[9]).toBe([0,0,4,2,6][channels]); }
      if (type === 'IDAT') compressed.push(data);
      offset += size + 12;
    }
    expect(inflateSync(Buffer.concat(compressed))).toEqual(Buffer.concat([Buffer.from([0]), pixels.subarray(0,2 * channels), Buffer.from([0]), pixels.subarray(2 * channels)]));
  }
  expect(() => rawPng(new Uint8Array(1), { width: 2, height: 2, channels: 4 })).toThrow('Invalid');
});

test('official schemas and durable MCP replay operate through Worker pg RPC', async () => {
  process.env.OPENMAIC_WORKERS = '1';
  process.env.OPENMAIC_MCP_MODE = '1';
  process.env.DATABASE_URL = 'postgres://workers/contract';
  installBuiltinSkills();
  const pg = new PGlite({ parsers: { 20: value => value, 1700: value => value } });
  await pg.waitReady;
  const database = new PostgresEngine(pg, async () => {});
  const pending: Promise<unknown>[] = [];
  const scope = { env: { OPENMAIC_DATABASE: { getByName: () => database } }, context: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) }, alarm: true };
  try {
    await workersScope.run(scope as Parameters<typeof workersScope.run>[0], async () => {
      const provider = await getServerPersistenceProvider(process.env.DATABASE_URL!);
      await getAgentSessionStore();
      const run = await createGenerationRun('study:worker-contract', {
        requirement: '理想彈簧週期', materialIds: [], interactive: true, taskEngine: false,
        agents: { mode: 'auto' }, outlineReview: 'auto',
      }, { maxActiveRunsPerOwner: 2, maxWaitingRunsPerOwner: 2 });
      const input = { prompt: [{ role: 'user', content: 'Explain the period' }], tools: [] };
      await expect(workersScope.run({ ...workersScope.getStore()!, suspend: () => { throw new DOMException('MCP wait', 'AbortError'); } }, () => withMcpScope(run.id, () => requestMcpOutput('study:worker-contract', 'outline', input)))).rejects.toMatchObject({ name: 'AbortError' });
      const tasks = await provider.pool.query('SELECT * FROM study_mcp_tasks WHERE run_id=$1', [run.id]);
      expect(tasks.rows).toHaveLength(1);
      const task = tasks.rows[0];
      expect(await submitTask(provider.pool, 'study:wrong-owner', task.id, task.version, { text: 'wrong' })).toBeNull();
      expect(await submitTask(provider.pool, 'study:worker-contract', task.id, task.version, { text: 'external reply' })).toMatchObject({ status: 'answered' });
      expect(await withMcpScope(run.id, () => requestMcpOutput('study:worker-contract', 'outline', input))).toEqual({ text: 'external reply' });
      expect((await provider.pool.query('SELECT count(*) AS n FROM study_mcp_tasks WHERE run_id=$1', [run.id])).rows[0].n).toBe('1');
      expect(await tick()).toMatchObject({ worked: true });
      const waiting = await provider.pool.query("SELECT * FROM study_mcp_tasks WHERE run_id=$1 AND status='pending'", [run.id]);
      expect(waiting.rows).toHaveLength(1);
      expect(await tick()).toMatchObject({ worked: false });
      expect((await provider.pool.query("SELECT count(*) AS n FROM study_mcp_tasks WHERE run_id=$1 AND status='pending'", [run.id])).rows[0].n).toBe('1');
    });
  } finally { await Promise.all(pending); await pg.close(); }
});
