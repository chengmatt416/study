import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import type { UsageRecord } from '@/lib/server/usage-storage';

async function pool() {
  const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
  await pool.query('CREATE TABLE IF NOT EXISTS study_core_usage (event_id text PRIMARY KEY,month text NOT NULL,created_at bigint NOT NULL,payload jsonb NOT NULL)');
  return pool;
}
export async function writeWorkerUsage(record: UsageRecord): Promise<void> {
  await (await pool()).query('INSERT INTO study_core_usage VALUES ($1,$2,$3,$4::jsonb)', [crypto.randomUUID(), new Date(record.createdAt).toISOString().slice(0,7), record.createdAt, JSON.stringify(record)]);
}
export async function readWorkerUsage(months?: string[]): Promise<UsageRecord[]> {
  const result = await (await pool()).query<{ payload: UsageRecord }>(`SELECT payload FROM study_core_usage ${months?.length ? 'WHERE month=ANY($1::text[])' : ''} ORDER BY month,created_at,event_id`, months?.length ? [months] : []);
  return result.rows.map(row => row.payload);
}
