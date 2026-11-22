import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Hono} from 'hono';
import {HTTPException} from 'hono/http-exception';
import {testDatabase} from './helpers/d1';
import {numericAnswer,gradeSystemQuestion} from '../src/shared/classroom-grading';
import {signLiveAiGrant,verifyLiveAiGrant} from '../src/shared/live-ai-transport';
import {signOpenMaicTicket} from '../src/shared/openmaic-transport';
import {encryptLiveAiKey,decryptLiveAiKey} from '../src/worker/lib/live-ai/secrets';
import {admitLiveAiTurn,liveAiCompletion,privateLiveAiGateway,type LiveAiEnv} from '../src/worker/lib/live-ai/service';
import admin from '../src/worker/routes/live-ai-admin';
import live from '../src/worker/routes/live-ai';
import {proxyOpenMaic} from '../src/worker/lib/openmaic-proxy';
import type {AppEnv} from '../src/worker/lib/types';
const user={id:'qa-live',email:'qa@example.test',role:'admin' as const,name:'QA',avatar_url:null};
const secret='transport-'.repeat(8), encryption='ab'.repeat(32);
describe('system grading without model requests',()=>{
  it('parses numeric LaTeX safely with arithmetic precedence',()=>{
    for(const [input,value] of [['\\frac{1}{2}',.5],['\\sqrt{9}',3],['2^3^2',512],['-2^2',-4],['50%',.5],['1e-3',.001]] as const)expect(numericAnswer(input)).toBe(value);
    for(const input of ['alert(1)','Infinity','1/0','2x','1+','9'.repeat(301)])expect(numericAnswer(input)).toBeNull();
  });
  it('grades simple answers, but never invents points for prose',()=>{
    expect(gradeSystemQuestion({id:'n',type:'short_answer',answer:'1/2',points:4},'\\frac{2}{4}')).toMatchObject({correct:true,earned:4});
    expect(gradeSystemQuestion({id:'n',type:'short_answer',answer:'3'},'4')).toMatchObject({correct:false,earned:0});
    expect(gradeSystemQuestion({id:'n',type:'short_answer',answer:'因為能量守恆'},'能量不變，所以如此')).toMatchObject({correct:null,earned:0});
    expect(gradeSystemQuestion({id:'n',type:'short_answer',answer:'1e-12'},'0')).toMatchObject({correct:false});
    expect(gradeSystemQuestion({id:'n',type:'short_answer',answer:'X'},'x')).toMatchObject({correct:null});
    expect(gradeSystemQuestion({id:'c',type:'single',answer:'答案',options:[{label:'答案',value:'B'}]},'B')).toMatchObject({correct:true});
  });
});
describe('live AI protected gateway and quotas',()=>{
  let fixture:ReturnType<typeof testDatabase>,env:LiveAiEnv;
  beforeEach(()=>{fixture=testDatabase();fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('qa@example.test','admin',1); INSERT INTO users(id,email,created_at) VALUES ('qa-live','qa@example.test',1)");env={DB:fixture.DB,OPENMAIC_MCP_SECRET:secret,LIVE_AI_ENCRYPTION_KEY:encryption} as unknown as LiveAiEnv;});
  afterEach(()=>{vi.unstubAllGlobals();fixture.db.close();});
  async function enable(){const key=await encryptLiveAiKey(env,'fake-provider-key-for-test');fixture.db.prepare("UPDATE live_ai_config SET enabled=1,model='provider/test',encrypted_key=?").run(key);fixture.db.exec("INSERT INTO live_ai_access(email,enabled,updated_at) VALUES ('qa@example.test',1,1); INSERT INTO live_ai_sessions(user_id,classroom_id,enabled_at,expires_at) VALUES ('qa-live','class',1,9999999999999)");}
  const request={messages:[{role:'user' as const,content:'Why?'}]};
  it('encrypts with random IV, rejects tampering and domain-separated/replayed tickets',async()=>{
    const a=await encryptLiveAiKey(env,'test-secret'),b=await encryptLiveAiKey(env,'test-secret');expect(a).not.toBe(b);expect(a).not.toContain('test-secret');expect(await decryptLiveAiKey(env,a)).toBe('test-secret');
    await expect(decryptLiveAiKey({...env,LIVE_AI_ENCRYPTION_KEY:'cd'.repeat(32)},a)).rejects.toThrow();
    const grant={sub:'study:qa-live',turn:crypto.randomUUID(),classroom:'class',purpose:'interaction' as const,exp:Date.now()+10000};const token=await signLiveAiGrant(grant,secret);
    expect(await verifyLiveAiGrant(token,secret)).toEqual(grant);expect(await verifyLiveAiGrant(token+'x',secret)).toBeNull();expect(await verifyLiveAiGrant(token,secret,grant.exp+1)).toBeNull();
    const ticket=await signOpenMaicTicket({sub:grant.sub,scope:'classroom',aud:'study-openmaic',classroom_id:'class',exp:Date.now()+10000},secret);expect(await verifyLiveAiGrant(ticket,secret)).toBeNull();
  });
  it('defaults to no access, enforces sliding limits, and revokes ongoing grants',async()=>{
    await expect(admitLiveAiTurn(env,user,'class','interaction')).rejects.toMatchObject({status:403});await enable();
    fixture.db.exec('UPDATE live_ai_config SET requests_per_minute=2');
    const grant=await admitLiveAiTurn(env,user,'class','interaction');await admitLiveAiTurn(env,user,'class','regrade');await expect(admitLiveAiTurn(env,user,'class','interaction')).rejects.toMatchObject({status:429});
    fixture.db.exec('UPDATE live_ai_access SET enabled=0');await expect(liveAiCompletion(env,grant,request)).rejects.toMatchObject({status:403});
  });
  it('forwards only to OpenRouter with server-selected config and settles provider usage',async()=>{
    await enable();const grant=await admitLiveAiTurn(env,user,'class','interaction');
    const mock=vi.fn(async(url:string,init:RequestInit)=>{expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');expect(new Headers(init.headers).get('authorization')).toBe('Bearer fake-provider-key-for-test');const body=JSON.parse(String(init.body));expect(body.model).toBe('provider/test');expect(body.stream).toBe(false);return Response.json({choices:[{message:{content:'Because…'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:8,cost:.00001}});});vi.stubGlobal('fetch',mock);
    expect(await liveAiCompletion(env,grant,request)).toMatchObject({message:{content:'Because…'},usage:{inputTokens:20,outputTokens:8}});expect(fixture.db.prepare('SELECT actual_tokens,status FROM live_ai_calls').get()).toMatchObject({actual_tokens:28,status:'completed'});
    expect(JSON.stringify(fixture.db.prepare('SELECT * FROM live_ai_calls').all())).not.toContain('fake-provider');
  });
  it('allows long answers: output cap is at least 4096 even if an old setting is lower',async()=>{
    await enable();fixture.db.exec('UPDATE live_ai_config SET max_output_tokens=1024');const grant=await admitLiveAiTurn(env,user,'class','interaction');
    const mock=vi.fn(async(_url:string,init:RequestInit)=>{expect(JSON.parse(String(init.body)).max_tokens).toBe(4096);return Response.json({choices:[{message:{content:'long answer'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:8}});});vi.stubGlobal('fetch',mock);
    await liveAiCompletion(env,grant,request);expect(mock).toHaveBeenCalledTimes(1);
    fixture.db.exec('UPDATE live_ai_config SET max_output_tokens=16000');const second=await admitLiveAiTurn(env,user,'class','interaction');
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{expect(JSON.parse(String(init.body)).max_tokens).toBe(16000);return Response.json({choices:[{message:{content:'x'}}],usage:{prompt_tokens:1,completion_tokens:1}});}));
    await liveAiCompletion(env,second,request);
  });
  it('rejects admin output limits below 4096',async()=>{
    const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('user',user);await next();});app.route('/admin',admin);app.onError(error=>error instanceof HTTPException?error.getResponse():new Response('error',{status:500}));
    const put=(max:number)=>app.request('/admin',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:false,model:'',max_output_tokens:max})},env);
    expect((await put(4095)).status).toBe(400);expect((await put(32769)).status).toBe(400);expect((await put(4096)).status).toBe(200);expect((await put(32768)).status).toBe(200);
  });
  it('bounds concurrent model calls and token reservations atomically',async()=>{
    await enable();fixture.db.exec('UPDATE live_ai_config SET max_calls_per_turn=1');const grant=await admitLiveAiTurn(env,user,'class','interaction');let finish!:(value:Response)=>void;
    vi.stubGlobal('fetch',()=>new Promise<Response>(resolve=>{finish=resolve;}));const first=liveAiCompletion(env,grant,request);while(!finish)await new Promise(resolve=>setTimeout(resolve,1));
    await expect(liveAiCompletion(env,grant,request)).rejects.toMatchObject({status:429});finish(Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:1,completion_tokens:1}}));await first;
    fixture.db.exec('UPDATE live_ai_access SET tokens_per_day=1000');const second=await admitLiveAiTurn(env,user,'class','regrade');await expect(liveAiCompletion(env,second,request)).rejects.toMatchObject({status:429});
  });
  it('denies unsigned gateway calls and sanitizes provider errors without retries',async()=>{
    const response=await privateLiveAiGateway(new Request('https://study/internal/live-ai/completions',{method:'POST',body:JSON.stringify(request)}),env);expect(response.status).toBe(403);
    await enable();const grant=await admitLiveAiTurn(env,user,'class','interaction');const mock=vi.fn(async()=>new Response('private provider error fake-provider-key-for-test',{status:401}));vi.stubGlobal('fetch',mock);
    try{await liveAiCompletion(env,grant,request);throw Error('expected rejection');}catch(error){expect(error).toBeInstanceOf(HTTPException);expect(await (error as HTTPException).getResponse().text()).not.toContain('fake-provider');}expect(mock).toHaveBeenCalledTimes(1);expect(fixture.db.prepare('SELECT status,actual_tokens FROM live_ai_calls').get()).toMatchObject({status:'failed',actual_tokens:null});
  });
  it('redacts admin configuration and prevents member writes',async()=>{
    await enable();const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('user',user);await next();});app.route('/admin',admin);
    const response=await app.request('/admin',{},env);const body=await response.json();expect(body.config.key_configured).toBe(true);expect(JSON.stringify(body)).not.toMatch(/encrypted_key|fake-provider|v1\./);
    const member=new Hono<AppEnv>();member.use('*',async(c,next)=>{c.set('user',{...user,role:'member'});await next();});member.route('/admin',admin);expect((await member.request('/admin',{},env)).status).toBe(403);
  });
  it('admits native UI message parts and replaces client-forged live headers',async()=>{
    await enable();const ticket=await signOpenMaicTicket({sub:'study:'+user.id,scope:'classroom',aud:'study-openmaic',classroom_id:'class',exp:Date.now()+60000},secret);
    const upstream=vi.fn(async(request:Request)=>{const grant=await verifyLiveAiGrant(request.headers.get('x-study-live-grant')??'',secret);expect(grant).toMatchObject({sub:'study:qa-live',classroom:'class',purpose:'interaction'});expect(request.headers.get('authorization')).toBeNull();return Response.json({ok:true});});
    env.OPENMAIC_CORE={fetch:upstream} as unknown as Fetcher;
    const response=await proxyOpenMaic(new Request('https://study.test/api/chat/pi',{method:'POST',headers:{origin:'https://study.test',cookie:'study_openmaic='+ticket,'x-study-live-grant':'forged',authorization:'Bearer must-not-cross'},body:JSON.stringify({messages:[{role:'user',parts:[{type:'text',text:'Why?'}]}]})}),env);
    expect(response?.status).toBe(200);expect(upstream).toHaveBeenCalledTimes(1);
    expect((await proxyOpenMaic(new Request('https://study.test/api/chat/pi',{method:'POST',headers:{origin:'https://study.test',cookie:'study_openmaic='+ticket},body:JSON.stringify({messages:[{role:'assistant',parts:[{type:'text',text:'automatic'}]}]})}),env))?.status).toBe(400);
  });
  it('persists admin model keys encrypted and per-user limits without revealing secrets',async()=>{
    const app=new Hono<AppEnv>();app.use('*',async(c,next)=>{c.set('user',user);await next();});app.route('/admin',admin);
    const response=await app.request('/admin',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,model:'provider/test',api_key:'test-only-secret-key-123'})},env);expect(response.status).toBe(200);
    const stored=fixture.db.prepare('SELECT encrypted_key FROM live_ai_config').get() as {encrypted_key:string};expect(stored.encrypted_key).not.toContain('test-only');expect(await decryptLiveAiKey(env,stored.encrypted_key)).toBe('test-only-secret-key-123');
    const access=await app.request('/admin/users/qa%40example.test',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:true,requests_per_minute:1,requests_per_day:3,tokens_per_day:10000})},env);expect(access.status).toBe(200);expect(fixture.db.prepare('SELECT enabled,requests_per_day FROM live_ai_access').get()).toMatchObject({enabled:1,requests_per_day:3});
    expect(JSON.stringify(fixture.db.prepare('SELECT * FROM audit_log').all())).not.toContain('test-only-secret');
  });

  it('grades from the owned stored question and calls AI only on explicit review',async()=>{
    const ticket=await signOpenMaicTicket({sub:'study:'+user.id,scope:'classroom',aud:'study-openmaic',classroom_id:'class',exp:Date.now()+60000},secret);
    const app=new Hono<AppEnv>();app.route('/live',live);app.onError(error=>error instanceof HTTPException?error.getResponse():new Response('error',{status:500}));
    env.OPENMAIC_CORE_URL='https://core.example.test';env.OPENMAIC_CORE={fetch:vi.fn(async()=>Response.json({scenes:[{id:'scene',content:{questions:[{id:'q',type:'short_answer',question:'1+1?',answer:'2',points:4}]}}]}))} as unknown as Fetcher;
    const request=(body:unknown)=>app.request('/live/grade',{method:'POST',headers:{cookie:'study_openmaic='+ticket,'content-type':'application/json'},body:JSON.stringify(body)},env);
    const mock=vi.fn(async()=>Response.json({choices:[{message:{content:'{"score":4,"comment":"正確"}'}}],usage:{prompt_tokens:50,completion_tokens:15}}));vi.stubGlobal('fetch',mock);
    const baseline=await request({scene_id:'scene',question_id:'q',answer:'2',reference_answer:'999'});expect(await baseline.json()).toMatchObject({correct:true,earned:4,method:'system'});expect(mock).not.toHaveBeenCalled();
    expect((await request({scene_id:'scene',question_id:'foreign',answer:'2'})).status).toBe(400);
    expect((await request({scene_id:'scene',question_id:'q',answer:'2',ai_review:true})).status).toBe(403);expect(mock).not.toHaveBeenCalled();
    await enable();const review=await request({scene_id:'scene',question_id:'q',answer:'2',ai_review:true});expect(await review.json()).toMatchObject({correct:true,earned:4,method:'ai'});expect(mock).toHaveBeenCalledTimes(1);
  });

});
