import {expect,test} from 'vitest';
import {workersScope} from '@/lib/study-workers/context';
import {resolveMcpModel} from '@/lib/study-mcp/model';
import {signLiveAiGrant,verifyLiveAiGrant} from '@/lib/study-workers/live-ai-transport';
import {LIVE_CLASSROOM_STAGES} from '@/lib/study-workers/live-classroom';

test('classroom runtime requires a live grant and never falls back to MCP',async()=>{
  await workersScope.run({env:{},context:{waitUntil:()=>{}}} as Parameters<typeof workersScope.run>[0],async()=>{
    for(const stage of LIVE_CLASSROOM_STAGES)expect(()=>resolveMcpModel({workspaceId:'study:qa',stage})).toThrow('不會改用 MCP');
    for(const stage of ['outline','scene','classroom','quiz-grade'])expect(resolveMcpModel({workspaceId:'study:qa',stage}).providerId).toBe('study-mcp');
  });
});
test('verified interaction scope selects the actual live transport without generating an AI reply',async()=>{
  const secret='test-transport-secret-'.repeat(3);
  const token=await signLiveAiGrant({sub:'study:qa',turn:crypto.randomUUID(),classroom:'class',purpose:'interaction',exp:Date.now()+30000},secret);
  expect(await verifyLiveAiGrant(token,secret)).not.toBeNull();
  await workersScope.run({env:{},context:{waitUntil:()=>{}},liveGrant:token} as Parameters<typeof workersScope.run>[0],async()=>{
    for(const stage of LIVE_CLASSROOM_STAGES)expect(resolveMcpModel({workspaceId:'study:qa',stage}).providerId).toBe('study-live');
    expect(resolveMcpModel({workspaceId:'study:qa',stage:'outline'}).providerId).toBe('study-mcp');
  });
});
