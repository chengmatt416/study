import { HTTPException } from 'hono/http-exception';
import type { SessionUser } from '../types';
import { accessRules } from '../access';
import { canAccess } from '../../../shared/access';
import { activeClassroomTicket } from '../classroom-session';
import { signLiveAiGrant, verifyLiveAiGrant, type LiveAiGrant } from '../../../shared/live-ai-transport';
import { CONTENT_CHECK_TIMEOUT_MS, EXAM_GRADING_PROMPT, LIVE_AI_ENDPOINT, LIVE_AI_MIN_OUTPUT_TOKENS, LIVE_AI_SYSTEM_PROMPT, LIVE_AI_TIMEOUT_MS, PRACTICE_EXPLANATION_PROMPT } from '../../../shared/ai-boundary';
import { decryptLiveAiKey } from './secrets';

export interface LiveAiConfig {
  enabled: number; model: string; encrypted_key: string | null; max_output_tokens: number;
  requests_per_minute: number; requests_per_day: number; tokens_per_day: number;
  global_requests_per_day: number; global_tokens_per_day: number; max_calls_per_turn: number;
}
export type LiveAiEnv = Env & { LIVE_AI_ENCRYPTION_KEY?: string; OPENMAIC_MCP_SECRET?: string };
interface AccessRow { enabled: number; requests_per_minute: number | null; requests_per_day: number | null; tokens_per_day: number | null }
export function liveAiError(message: string, status: 400 | 401 | 403 | 409 | 413 | 429 | 500 | 502 | 503, code: string, retryAfter?: number): never {
  throw new HTTPException(status, { res: Response.json({ error: message, code, ...(retryAfter ? { retry_after: retryAfter } : {}) }, { status, headers: { 'cache-control': 'no-store', ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}) } }) });
}
export async function boundedJson(value: Pick<Request, 'body'>, limit = 262144): Promise<Record<string, unknown>> {
  const reader = value.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) liveAiError('缺少請求內容', 400, 'invalid_request');
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) { await reader.cancel(); liveAiError('提問內容過長，請縮小範圍', 413, 'context_limit'); } chunks.push(next.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const body: unknown = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); return body as Record<string, unknown>; }
  catch { liveAiError('請求內容不是合法 JSON', 400, 'invalid_request'); }
}
export async function loadLiveAiConfig(env: LiveAiEnv): Promise<LiveAiConfig> {
  const config = await env.DB.prepare('SELECT * FROM live_ai_config WHERE id=1').first<LiveAiConfig>();
  if (!config) liveAiError('課堂 AI 尚未設定', 503, 'not_configured');
  return config;
}
export async function liveAiUser(env: LiveAiEnv, userId: string): Promise<SessionUser> {
  const user = await env.DB.prepare('SELECT u.id,u.email,u.name,u.avatar_url,a.role FROM users u JOIN allowlist a ON a.email=u.email WHERE u.id=?').bind(userId).first<SessionUser>();
  if (!user) liveAiError('此帳號已不在授權名單中', 403, 'access_denied');
  if (!canAccess(await accessRules(env, user), 'ai')) liveAiError('你的群組未開放 AI 功能', 403, 'access_denied');
  return user;
}
export async function classroomIdentity(request: Request, env: LiveAiEnv): Promise<{ user: SessionUser; classroom: string; sessionHash?: string }> {
  const ticket = await activeClassroomTicket(request, env);
  if (!ticket || ticket.scope !== 'classroom' || !ticket.classroom_id) liveAiError('請從 STUDY 重新開啟課堂', 401, 'classroom_session_required');
  return { user: await liveAiUser(env, ticket.sub.slice(6)), classroom: ticket.classroom_id, sessionHash: ticket.session_hash };
}
export async function liveAiPolicy(env: LiveAiEnv, user: SessionUser, strict = true) {
  const config = await loadLiveAiConfig(env);
  const access = await env.DB.prepare('SELECT * FROM live_ai_access WHERE email=?').bind(user.email).first<AccessRow>();
  let reason: string | null = !config.encrypted_key
    ? '尚未設定課堂 AI API key；提問、討論與 AI 覆核已停用。'
    : !config.enabled ? '管理員已停用課堂 AI。'
    : !config.model ? '尚未設定課堂 AI 模型。'
    : !/^[a-f0-9]{64}$/i.test(env.LIVE_AI_ENCRYPTION_KEY ?? '') ? '課堂 AI 金鑰設定尚未完成。'
    : access && !access.enabled ? '管理員已停用你的課堂 AI 使用權限。' : null;
  if (!reason) {
    try { if (!(await decryptLiveAiKey(env, config.encrypted_key!)).trim()) reason = '課堂 AI API key 無效，請管理員重新設定。'; }
    catch { reason = '課堂 AI API key 無法讀取，請管理員重新設定。'; }
  }
  const available = reason === null;
  if (strict && !available) liveAiError(reason!, 403, 'live_ai_disabled');
  return { config, available, reason, minute: access?.requests_per_minute ?? config.requests_per_minute, day: access?.requests_per_day ?? config.requests_per_day, tokens: access?.tokens_per_day ?? config.tokens_per_day };
}
const dayStart = (now: number) => now - now % 86400000;
export const LIVE_AI_SESSION_MS = 4 * 3600000;
/** The learner opts in per classroom; every live turn requires an unexpired opt-in. */
export async function liveAiSession(env: LiveAiEnv, userId: string, classroom: string, now = Date.now()): Promise<{ enabled: boolean; expires_at: number | null }> {
  const row = await env.DB.prepare('SELECT expires_at FROM live_ai_sessions WHERE user_id=? AND classroom_id=? AND expires_at>?').bind(userId, classroom, now).first<{ expires_at: number }>();
  return { enabled: !!row, expires_at: row?.expires_at ?? null };
}
export async function setLiveAiSession(env: LiveAiEnv, user: SessionUser, classroom: string, enabled: boolean, now = Date.now()) {
  if (!enabled) { await env.DB.prepare('DELETE FROM live_ai_sessions WHERE user_id=? AND classroom_id=?').bind(user.id, classroom).run(); return { enabled: false, expires_at: null }; }
  await liveAiPolicy(env, user);
  await env.DB.prepare('INSERT INTO live_ai_sessions(user_id,classroom_id,enabled_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(user_id,classroom_id) DO UPDATE SET enabled_at=excluded.enabled_at,expires_at=excluded.expires_at')
    .bind(user.id, classroom, now, now + LIVE_AI_SESSION_MS).run();
  return { enabled: true, expires_at: now + LIVE_AI_SESSION_MS };
}
export async function admitLiveAiTurn(env: LiveAiEnv, user: SessionUser, classroom: string, purpose: LiveAiGrant['purpose'], now = Date.now()): Promise<string> {
  const policy = await liveAiPolicy(env, user); const id = crypto.randomUUID();
  if (!(await liveAiSession(env, user.id, classroom, now)).enabled) liveAiError('請先在本次課堂啟用 AI 功能', 403, 'session_not_enabled');
  const result = await env.DB.prepare(`INSERT INTO live_ai_turns(id,user_id,classroom_id,purpose,created_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM live_ai_turns WHERE user_id=? AND created_at>?)<? AND
    (SELECT COUNT(*) FROM live_ai_turns WHERE user_id=? AND created_at>=?)<? AND
    (SELECT COUNT(*) FROM live_ai_turns WHERE created_at>=?)<?`)
    .bind(id,user.id,classroom,purpose,now,now+120000,user.id,now-60000,policy.minute,user.id,dayStart(now),policy.day,dayStart(now),policy.config.global_requests_per_day).run();
  if (!result.meta.changes) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n,MIN(created_at) AS oldest FROM live_ai_turns WHERE user_id=? AND created_at>?').bind(user.id,now-60000).first<{n:number;oldest:number}>();
    const minute = (count?.n ?? 0) >= policy.minute;
    const retry = minute ? Math.max(1,Math.ceil(((count?.oldest ?? now)+60000-now)/1000)) : Math.ceil((dayStart(now)+86400000-now)/1000);
    liveAiError(minute ? '提問太密集，請稍候再試' : '已達今日課堂 AI 使用上限', 429, minute ? 'minute_limit' : 'daily_limit', retry);
  }
  return signLiveAiGrant({ sub: 'study:'+user.id,turn:id,classroom,purpose,exp:now+120000 }, env.OPENMAIC_MCP_SECRET ?? '');
}
export interface CompletionRequest { max_tokens?: number; messages: {role: 'system'|'user'|'assistant'|'tool'; content?: unknown; tool_calls?: unknown; tool_call_id?: string}[]; tools?: unknown[]; tool_choice?: unknown; response_format?: unknown }
export async function liveAiCompletion(env: LiveAiEnv, token: string, input: CompletionRequest, signal?: AbortSignal) {
  const now = Date.now(); const grant = await verifyLiveAiGrant(token, env.OPENMAIC_MCP_SECRET ?? '', now);
  if (!grant) liveAiError('無效的 AI 請求', 403, 'invalid_grant');
  const user = await liveAiUser(env, grant.sub.slice(6)); const policy = await liveAiPolicy(env, user);
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 100 || input.messages.some(message => !message || !['system','user','assistant','tool'].includes(message.role))) liveAiError('無效的對話內容', 400, 'invalid_messages');
  const serialized = JSON.stringify(input); const bytes = new TextEncoder().encode(serialized).length;
  if (grant.purpose === 'exam_grade') {
    if (bytes > 2_600_000) liveAiError('批改內容過長，請縮短作答', 413, 'context_limit');
  } else if (bytes > 131072) {
    liveAiError('課堂上下文過長，請改問較小的步驟', 413, 'context_limit');
  }
  const systemPrompt = grant.purpose === 'exam_grade' ? EXAM_GRADING_PROMPT : grant.purpose === 'practice_explain' ? PRACTICE_EXPLANATION_PROMPT : LIVE_AI_SYSTEM_PROMPT;
  const configured = Math.max(policy.config.max_output_tokens, LIVE_AI_MIN_OUTPUT_TOKENS); const outputLimit = (grant.purpose === 'route' || grant.purpose === 'coach' || grant.purpose === 'exam_grade') && input.max_tokens ? Math.min(configured, Math.max(256, input.max_tokens)) : configured; const reserved = bytes + outputLimit + 1024; const callId = crypto.randomUUID();
  const result = await env.DB.prepare(`INSERT INTO live_ai_calls(id,turn_id,user_id,created_at,reserved_tokens)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM live_ai_turns WHERE id=? AND user_id=? AND classroom_id=? AND purpose=? AND expires_at>?) AND
    (SELECT COUNT(*) FROM live_ai_calls WHERE turn_id=?)<? AND
    (SELECT COALESCE(SUM(COALESCE(actual_tokens,reserved_tokens)),0) FROM live_ai_calls WHERE user_id=? AND created_at>=?)+?<=? AND
    (SELECT COALESCE(SUM(COALESCE(actual_tokens,reserved_tokens)),0) FROM live_ai_calls WHERE created_at>=?)+?<=?`)
    .bind(callId,grant.turn,user.id,now,reserved,grant.turn,user.id,grant.classroom,grant.purpose,now,grant.turn,policy.config.max_calls_per_turn,user.id,dayStart(now),reserved,policy.tokens,dayStart(now),reserved,policy.config.global_tokens_per_day).run();
  if (!result.meta.changes) liveAiError('已達互動回合或今日 token 預算上限；請縮短問題或稍後再試', 429, 'token_or_turn_limit', Math.ceil((dayStart(now)+86400000-now)/1000));
  try {
    const key = await decryptLiveAiKey(env, policy.config.encrypted_key!);
    const response = await fetch(LIVE_AI_ENDPOINT, {
      method: 'POST', headers: { authorization: 'Bearer '+key, 'content-type': 'application/json', 'x-openrouter-title': 'STUDY Live Classroom' },
      body: JSON.stringify({ model: policy.config.model, messages: [{ role:'system',content:systemPrompt },...input.messages], ...(input.tools?.length ? {tools:input.tools,tool_choice:input.tool_choice ?? 'auto'} : {}), ...(input.response_format ? {response_format:input.response_format}:{}), max_tokens:outputLimit, temperature:0.2, stream:false, user:user.id, provider:{data_collection:'deny'} }),
      signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(LIVE_AI_TIMEOUT_MS)]) : AbortSignal.timeout(LIVE_AI_TIMEOUT_MS), redirect:'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      liveAiError(response.status === 429 ? '模型服務暫時繁忙，請稍後再試' : '課堂 AI 暫時無法回應，請稍後再試或請管理員檢查設定', response.status === 429 ? 429 : 502, 'provider_unavailable', response.status === 429 ? 60 : undefined);
    }
    const body = await boundedJson(response, 524288);
    const choices = body.choices as { message?: {content?:unknown;tool_calls?:unknown[]};finish_reason?:string }[] | undefined;
    const message = choices?.[0]?.message;
    if (!message || (typeof message.content !== 'string' && !Array.isArray(message.tool_calls))) liveAiError('模型沒有回傳可用的回應',502,'invalid_response');
    const usage = body.usage as {prompt_tokens?:unknown;completion_tokens?:unknown;cost?:unknown} | undefined;
    const total = Number(usage?.prompt_tokens) + Number(usage?.completion_tokens);
    const actual = Number.isSafeInteger(total) && total >= 0 ? total : reserved;
    const cost = typeof usage?.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
    await env.DB.prepare("UPDATE live_ai_calls SET status='completed',actual_tokens=?,cost=? WHERE id=?").bind(actual,cost,callId).run();
    return { message, usage: { inputTokens:Number(usage?.prompt_tokens)||0,outputTokens:Number(usage?.completion_tokens)||0 }, finishReason:choices?.[0]?.finish_reason };
  } catch (error) {
    await env.DB.prepare("UPDATE live_ai_calls SET status='failed' WHERE id=? AND status='pending'").bind(callId).run();
    if (error instanceof HTTPException) throw error;
    liveAiError('課堂 AI 回應中斷；未自動重送，請稍後再試',502,'provider_unavailable');
  }
}
export async function privateLiveAiGateway(request: Request, env: LiveAiEnv): Promise<Response> {
  try {
    if (request.method !== 'POST') return new Response('Not found',{status:404});
    const token = request.headers.get('x-study-live-grant') ?? '';
    const grant = await verifyLiveAiGrant(token, env.OPENMAIC_MCP_SECRET ?? '', Date.now());
    if (!grant || grant.purpose !== 'interaction') liveAiError('無效的課堂 AI 請求', 403, 'invalid_grant');
    const input = await boundedJson(request);
    const result = await liveAiCompletion(env, token, input as unknown as CompletionRequest, request.signal);
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  } catch (error) {
    if (error instanceof HTTPException) return error.getResponse();
    return Response.json({error:'課堂 AI 暫時無法使用'},{status:503,headers:{'cache-control':'no-store'}});
  }
}

export class ContentCheckUnavailable extends Error {}
/** The live classroom model the content check would use, or why it cannot run. */
export async function contentCheckModel(env: LiveAiEnv): Promise<{ model: string } | { unavailable: string }> {
  const row = await env.DB.prepare('SELECT model, encrypted_key IS NOT NULL AS has_key FROM live_ai_config WHERE id=1').first<{ model: string; has_key: number }>().catch(() => null);
  if (!row?.has_key) return { unavailable: '管理員尚未在課堂 AI 設定 OpenRouter key' };
  if (!row.model?.trim()) return { unavailable: '管理員尚未在課堂 AI 設定模型' };
  return { model: row.model.trim() };
}
/**
 * The content judge's single call: the admin's OpenRouter key and the same model the admin chose for the live classroom
 * (no separate, more expensive model). It is not a learner turn, so it needs no grant. Any failure throws
 * ContentCheckUnavailable and the caller falls back to fixed rules.
 */
export async function contentCheckCompletion(env: LiveAiEnv, input: { system: string; user: string; schema: Record<string, unknown>; maxTokens: number }) {
  const row = await env.DB.prepare('SELECT encrypted_key, model FROM live_ai_config WHERE id=1').first<{ encrypted_key: string | null; model: string }>().catch(() => null);
  if (!row?.encrypted_key) throw new ContentCheckUnavailable('管理員尚未在課堂 AI 設定 OpenRouter key');
  const model = row.model?.trim();
  if (!model) throw new ContentCheckUnavailable('管理員尚未在課堂 AI 設定模型');
  let key: string;
  try { key = await decryptLiveAiKey(env, row.encrypted_key); } catch { throw new ContentCheckUnavailable('無法解開 OpenRouter key'); }
  let response: Response;
  try {
    response = await fetch(LIVE_AI_ENDPOINT, {
      method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-openrouter-title': 'STUDY Content Check' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
        response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: input.schema } },
        reasoning: { effort: 'low' }, max_tokens: input.maxTokens, stream: false,
        // The classroom model may not support strict JSON output; the reply is validated either way.
        provider: { data_collection: 'deny' },
      }),
      signal: AbortSignal.timeout(CONTENT_CHECK_TIMEOUT_MS), redirect: 'manual',
    });
  } catch { throw new ContentCheckUnavailable('連不上 OpenRouter'); }
  if (!response.ok) { await response.body?.cancel(); throw new ContentCheckUnavailable(`OpenRouter HTTP ${response.status}`); }
  const body = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
  const choice = body?.choices?.[0];
  if (!choice || typeof choice.message?.content !== 'string') throw new ContentCheckUnavailable('判斷模型沒有回傳內容');
  if (choice.finish_reason && choice.finish_reason !== 'stop') throw new ContentCheckUnavailable(`判斷模型沒有正常結束（${choice.finish_reason}）`);
  return { content: choice.message.content, model, inputTokens: Number(body?.usage?.prompt_tokens) || 0, outputTokens: Number(body?.usage?.completion_tokens) || 0 };
}

function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return match ? match[1].trim() : trimmed;
}

/**
 * 解析模型的 JSON 回覆：供應商不支援結構化輸出時，模型可能在 JSON 前後多寫說明或包在 ``` 裡；
 * 依序嘗試整段、去掉圍欄、第一個 { 到最後一個 }。
 */
function parseModelJson(raw: string): unknown {
  const attempts = [raw.trim(), stripJsonCodeFences(raw)];
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) attempts.push(raw.slice(first, last + 1));
  for (const text of attempts) {
    try {
      return JSON.parse(text);
    } catch {
      /* 試下一種 */
    }
  }
  throw new SyntaxError('invalid model json');
}

// A request from the practice explanation button is the opt-in for that single turn.
export async function practiceExplanation(env: LiveAiEnv, user: SessionUser, context: unknown, signal: AbortSignal) {
  const timeout = 45_000;
  const grant = await admitPersonalAiTurn(env, user, 'mixed-practice', 'practice_explain', timeout, Date.now());
  const { message } = await liveAiCompletion(env, grant, {
    messages: [{ role: 'user', content: JSON.stringify(context) }],
  }, AbortSignal.any([signal, AbortSignal.timeout(timeout)]));
  const markdown = typeof message.content === 'string' ? message.content.trim() : '';
  if (!markdown) liveAiError('AI 沒有回傳解析，請重試', 502, 'invalid_response');
  return markdown;
}

async function admitPersonalAiTurn(env: LiveAiEnv, user: SessionUser, scopeId: string, purpose: 'exam_grade' | 'practice_explain', timeoutMs: number, now: number): Promise<string> {
  const policy = await liveAiPolicy(env, user);
  const id = crypto.randomUUID();
  const ttlMs = Math.max(120_000, timeoutMs + 30_000);
  const result = await env.DB.prepare(`INSERT INTO live_ai_turns(id,user_id,classroom_id,purpose,created_at,expires_at)
    SELECT ?,?,?,?,?,? WHERE
    (SELECT COUNT(*) FROM live_ai_turns WHERE user_id=? AND created_at>?)<? AND
    (SELECT COUNT(*) FROM live_ai_turns WHERE user_id=? AND created_at>=?)<? AND
    (SELECT COUNT(*) FROM live_ai_turns WHERE created_at>=?)<?`)
    .bind(id, user.id, scopeId, purpose, now, now + ttlMs, user.id, now - 60000, policy.minute, user.id, dayStart(now), policy.day, dayStart(now), policy.config.global_requests_per_day).run();
  if (!result.meta.changes) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n,MIN(created_at) AS oldest FROM live_ai_turns WHERE user_id=? AND created_at>?').bind(user.id, now - 60000).first<{ n: number; oldest: number }>();
    const minute = (count?.n ?? 0) >= policy.minute;
    const retry = minute ? Math.max(1, Math.ceil(((count?.oldest ?? now) + 60000 - now) / 1000)) : Math.ceil((dayStart(now) + 86400000 - now) / 1000);
    liveAiError(minute ? '操作太密集，請稍候再試' : '已達今日 AI 使用上限', 429, minute ? 'minute_limit' : 'daily_limit', retry);
  }
  return signLiveAiGrant({ sub: 'study:' + user.id, turn: id, classroom: scopeId, purpose, exp: now + ttlMs }, env.OPENMAIC_MCP_SECRET ?? '');
}

export async function examGrading(env: LiveAiEnv, userId: string, attemptId: string, context: unknown, schema: Record<string, unknown>, signal: AbortSignal) {
  const timeout = 60_000;
  const user = await liveAiUser(env, userId);
  const token = await admitPersonalAiTurn(env, user, attemptId, 'exam_grade', timeout, Date.now());
  const { message, finishReason } = await liveAiCompletion(env, token, {
    messages: [{ role: 'user', content: JSON.stringify(context) }],
    response_format: { type: 'json_schema', json_schema: { name: 'exam_instant_marks', strict: true, schema } },
    max_tokens: 2048,
  }, AbortSignal.any([signal, AbortSignal.timeout(timeout)]));
  if (finishReason && finishReason !== 'stop') liveAiError('AI 沒有回傳完整的批改，請重試', 502, 'invalid_grade');
  try {
    return parseModelJson(typeof message.content === 'string' ? message.content : '');
  } catch {
    liveAiError('AI 沒有回傳完整的批改，請重試', 502, 'invalid_grade');
  }
}
