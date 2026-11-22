import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { testDatabase } from './helpers/d1';
import { liveAiPolicy,admitLiveAiTurn,liveAiCompletion,type LiveAiEnv } from '../src/worker/lib/live-ai/service';
import { signLiveAiGrant } from '../src/shared/live-ai-transport';
import { isLiveClassroomInput,LIVE_CLASSROOM_PATHS,LIVE_CLASSROOM_STAGES } from '../src/shared/live-classroom';
const user={id:'disabled-user',email:'disabled@example.test',name:'Disabled',avatar_url:null,role:'admin' as const};
describe('real disabled configuration, without model responses',()=>{
  let fixture:ReturnType<typeof testDatabase>,env:LiveAiEnv;
  beforeEach(()=>{fixture=testDatabase();fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('disabled@example.test','admin',1); INSERT INTO users(id,email,created_at) VALUES ('disabled-user','disabled@example.test',1); INSERT INTO live_ai_access(email,enabled,updated_at) VALUES ('disabled@example.test',1,1); UPDATE live_ai_config SET enabled=1,model='provider/model'");env={DB:fixture.DB,OPENMAIC_MCP_SECRET:'signing-secret-'.repeat(4),LIVE_AI_ENCRYPTION_KEY:'ab'.repeat(32)} as unknown as LiveAiEnv;});
  afterEach(()=>fixture.db.close());
  it('fails closed without a key even when all switches are enabled',async()=>{
    expect(await liveAiPolicy(env,user,false)).toMatchObject({available:false,reason:expect.stringContaining('API key')});
    await expect(admitLiveAiTurn(env,user,'class','interaction')).rejects.toMatchObject({status:403});
    await expect(admitLiveAiTurn(env,user,'class','regrade')).rejects.toMatchObject({status:403});
    const grant=await signLiveAiGrant({sub:'study:'+user.id,turn:crypto.randomUUID(),classroom:'class',purpose:'interaction',exp:Date.now()+30000},env.OPENMAIC_MCP_SECRET!);
    await expect(liveAiCompletion(env,grant,{messages:[{role:'user',content:'Start a discussion'}]})).rejects.toMatchObject({status:403});
    expect(fixture.db.prepare('SELECT COUNT(*) AS n FROM live_ai_turns').get()).toMatchObject({n:0});expect(fixture.db.prepare('SELECT COUNT(*) AS n FROM live_ai_calls').get()).toMatchObject({n:0});
  });
  it('disables unreadable stored keys instead of advertising available AI',async()=>{
    fixture.db.exec("UPDATE live_ai_config SET encrypted_key='invalid-ciphertext'");
    expect(await liveAiPolicy(env,user,false)).toMatchObject({available:false,reason:expect.stringContaining('無法讀取')});
    await expect(admitLiveAiTurn(env,user,'class','interaction')).rejects.toMatchObject({status:403});
  });
});
describe('native discussion input and API-only runtime boundary',()=>{
  it('accepts agent-first discussions without requiring a fabricated learner message',()=>{
    expect(isLiveClassroomInput('/api/chat/pi',{messages:[],config:{sessionType:'discussion',discussionTopic:'質量與週期'}})).toBe(true);
    expect(isLiveClassroomInput('/api/chat/pi',{messages:[],config:{sessionType:'qa'}})).toBe(false);
    expect(isLiveClassroomInput('/api/chat/pi',{messages:[],config:{sessionType:'discussion',discussionTopic:' '}})).toBe(false);
    expect(isLiveClassroomInput('/api/chat/pi',{messages:[{role:'user',parts:[{type:'text',text:'為什麼？'}]}]})).toBe(true);
  });
  it('only marks classroom and PBL runtime as live; generation stays on MCP',()=>{
    for(const endpoint of ['instructor','simulator','evaluate','open-task'])expect(LIVE_CLASSROOM_PATHS.has('/api/pbl/v2/'+endpoint)).toBe(true);
    for(const stage of ['outline','scene','agent-runtime','pbl-v2:planner'])expect(LIVE_CLASSROOM_STAGES.has(stage)).toBe(false);
    expect(LIVE_CLASSROOM_PATHS.has('/api/generate-classroom')).toBe(false);
  });
});
