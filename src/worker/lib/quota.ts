// 用量守門：讓 R2 用量留在免費額度內（Workers Paid 不含 R2，超過才會計費）。
import { bad } from "./util";

export async function storageUsed(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      "SELECT (SELECT COALESCE(SUM(size_bytes),0) FROM books) + (SELECT COALESCE(SUM(size_bytes),0) FROM assets) AS used",
    )
    .first<{ used: number }>();
  return row?.used ?? 0;
}

export async function assertStorage(env: Env, incoming: number) {
  const limit = Number(env.MAX_STORAGE_BYTES || 9 * 1024 ** 3);
  const used = await storageUsed(env.DB);
  if (used + incoming > limit) {
    bad(`儲存空間不足：已用 ${(used / 1024 ** 3).toFixed(2)} GB，上限 ${(limit / 1024 ** 3).toFixed(2)} GB（避免超出 R2 免費額度）`, 413);
  }
}
