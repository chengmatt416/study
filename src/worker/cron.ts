// 每日清理過期資料並檢查 NotebookLM 匯入來源。
import { fetchNotebookLMDeck } from "../shared/notebooklm";

export async function runNotebookLMCheck(env: Env) {
  const deck = await env.DB.prepare("SELECT source_url FROM decks WHERE source_type = 'notebooklm' AND source_url IS NOT NULL ORDER BY last_synced_at DESC LIMIT 1").first<{ source_url: string }>();
  const t = Date.now();
  if (!deck) {
    await env.DB.prepare("INSERT OR REPLACE INTO system_checks (name, ok, detail, checked_at) VALUES ('notebooklm', 1, '尚無 NotebookLM 字卡組可測試', ?)").bind(t).run();
    return { ok: true, detail: "no deck" };
  }
  try {
    const parsed = await fetchNotebookLMDeck(deck.source_url);
    const ok = parsed.cards.length > 0;
    const detail = ok ? `解析成功：${parsed.cards.length} 張` : "解析到 0 張卡片";
    await env.DB.prepare("INSERT OR REPLACE INTO system_checks (name, ok, detail, checked_at) VALUES ('notebooklm', ?, ?, ?)").bind(ok ? 1 : 0, detail, t).run();
    return { ok, detail };
  } catch (e) {
    const detail = `解析失敗（Google 可能改版，請更新 src/shared/notebooklm.ts）：${(e as Error).message}`;
    await env.DB.prepare("INSERT OR REPLACE INTO system_checks (name, ok, detail, checked_at) VALUES ('notebooklm', 0, ?, ?)").bind(detail, t).run();
    return { ok: false, detail };
  }
}

export async function scheduled(env: Env) {
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM live_ai_turns WHERE created_at < ?").bind(t - 2 * 86400000),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM mcp_pdf_grants WHERE expires_at <= ?").bind(t),
    env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(t - 3600_000),
  ]);
  // 超過 24 小時未完成的分段上傳：中止並釋放 R2 空間
  const { results } = await env.DB.prepare("SELECT id, r2_key, book_id FROM uploads WHERE completed_at IS NULL AND created_at < ?")
    .bind(t - 86400_000)
    .all<{ id: string; r2_key: string; book_id: string }>();
  for (const up of results) {
    await env.BUCKET.resumeMultipartUpload(up.r2_key, up.id).abort().catch(() => undefined);
    await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(up.id).run();
    await env.DB.prepare("DELETE FROM books WHERE id = ? AND status = 'uploading'").bind(up.book_id).run();
  }
  await runNotebookLMCheck(env);
}
