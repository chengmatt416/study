import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { bad } from '../lib/util';
import { audit } from '../lib/audit';
import { boundedJson, loadLiveAiConfig, type LiveAiEnv } from '../lib/live-ai/service';
import { encryptLiveAiKey } from '../lib/live-ai/secrets';

const routes = new Hono<AppEnv>();
const LIMITS = {
  max_output_tokens:[4096,32768], requests_per_minute:[1,60], requests_per_day:[1,10000], tokens_per_day:[1000,10000000],
  global_requests_per_day:[1,100000], global_tokens_per_day:[1000,100000000], max_calls_per_turn:[1,12],
} as const;
function integer(value: unknown, name: keyof typeof LIMITS) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < LIMITS[name][0] || value > LIMITS[name][1]) bad(`${name} 必須介於 ${LIMITS[name][0]} 與 ${LIMITS[name][1]}`);
  return value;
}
routes.use('*',async(c,next)=>{if(c.get('user').role!=='admin')bad('需要管理員權限',403);await next();});
routes.get('/',async c=>{
  const {encrypted_key,...config}=await loadLiveAiConfig(c.env);
  return c.json({config:{...config,key_configured:!!encrypted_key,encryption_ready:/^[a-f0-9]{64}$/i.test((c.env as LiveAiEnv).LIVE_AI_ENCRYPTION_KEY??'')}});
});
routes.put('/',async c=>{
  const body=await boundedJson(c.req.raw,16384),previous=await loadLiveAiConfig(c.env);
  if(typeof body.enabled!=='boolean')bad('enabled 必須是布林值');
  const model=typeof body.model==='string'?body.model.trim():'';
  if(model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{1,199}$/.test(model))bad('模型 ID 格式錯誤');
  if(body.enabled && !model)bad('請先指定 OpenRouter 模型 ID');
  const values=Object.fromEntries(Object.keys(LIMITS).map(name=>[name,integer(body[name]??previous[name as keyof typeof LIMITS],name as keyof typeof LIMITS)])) as Record<keyof typeof LIMITS,number>;
  let encrypted=previous.encrypted_key;
  if(body.clear_key===true)encrypted=null;
  if(body.api_key!==undefined && body.api_key!==''){
    if(typeof body.api_key!=='string'||body.api_key.length<16||body.api_key.length>512||/\s/.test(body.api_key))bad('API key 格式錯誤');
    try{encrypted=await encryptLiveAiKey(c.env,body.api_key);}catch{bad('伺服器尚未配置 API key 加密金鑰',503);}
  }
  await c.env.DB.prepare(`UPDATE live_ai_config SET enabled=?,model=?,encrypted_key=?,max_output_tokens=?,requests_per_minute=?,requests_per_day=?,tokens_per_day=?,global_requests_per_day=?,global_tokens_per_day=?,max_calls_per_turn=?,updated_at=?,updated_by=? WHERE id=1`)
    .bind(body.enabled?1:0,model,encrypted,values.max_output_tokens,values.requests_per_minute,values.requests_per_day,values.tokens_per_day,values.global_requests_per_day,values.global_tokens_per_day,values.max_calls_per_turn,Date.now(),c.get('user').id).run();
  await audit(c.env.DB,c.get('user').id,'live_ai.configure','live_ai',null,{enabled:body.enabled,model,key_changed:!!body.api_key||body.clear_key===true,...values});
  return c.json({ok:true});
});
routes.get('/users',async c=>{
  const {results}=await c.env.DB.prepare(`SELECT a.email,a.role,u.id AS user_id,u.name,COALESCE(p.enabled,1) AS enabled,p.requests_per_minute,p.requests_per_day,p.tokens_per_day,
    (SELECT COUNT(*) FROM live_ai_turns t WHERE t.user_id=u.id AND t.created_at>=?) AS requests_today,
    (SELECT COALESCE(SUM(COALESCE(v.actual_tokens,v.reserved_tokens)),0) FROM live_ai_calls v WHERE v.user_id=u.id AND v.created_at>=?) AS tokens_today
    FROM allowlist a LEFT JOIN users u ON u.email=a.email LEFT JOIN live_ai_access p ON p.email=a.email ORDER BY a.email`)
    .bind(Date.now()-Date.now()%86400000,Date.now()-Date.now()%86400000).all();
  return c.json({users:results});
});
routes.put('/users/:email',async c=>{
  const email=c.req.param('email').toLowerCase(),body=await boundedJson(c.req.raw,16384);
  if(!await c.env.DB.prepare('SELECT email FROM allowlist WHERE email=?').bind(email).first())bad('找不到授權帳號',404);
  if(typeof body.enabled!=='boolean')bad('enabled 必須是布林值');
  const limit=(name:'requests_per_minute'|'requests_per_day'|'tokens_per_day')=>body[name]===null||body[name]===undefined?null:integer(body[name],name);
  await c.env.DB.prepare(`INSERT INTO live_ai_access(email,enabled,requests_per_minute,requests_per_day,tokens_per_day,updated_at,updated_by) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET enabled=excluded.enabled,requests_per_minute=excluded.requests_per_minute,requests_per_day=excluded.requests_per_day,tokens_per_day=excluded.tokens_per_day,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .bind(email,body.enabled?1:0,limit('requests_per_minute'),limit('requests_per_day'),limit('tokens_per_day'),Date.now(),c.get('user').id).run();
  await audit(c.env.DB,c.get('user').id,'live_ai.access','live_ai',email,{enabled:body.enabled});
  return c.json({ok:true});
});
export default routes;
