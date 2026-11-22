import {afterEach,beforeEach,expect,test} from 'vitest';
import {callLLM} from '@/lib/ai/llm';
import {createMcpLanguageModel} from '@/lib/study-mcp/model';

const previous=process.env.OPENMAIC_MCP_MODE;
beforeEach(()=>{process.env.OPENMAIC_MCP_MODE='1';});
afterEach(()=>{if(previous===undefined)delete process.env.OPENMAIC_MCP_MODE;else process.env.OPENMAIC_MCP_MODE=previous;});
const reply=(provider:string)=>({...createMcpLanguageModel(async()=>({text:'答案'})),provider,modelId:'qa'});

test('MCP mode lets the live classroom model answer in-class questions',async()=>{
  const result=await callLLM({model:reply('study-live'),prompt:'問題'} as Parameters<typeof callLLM>[0],'qa');
  expect(result.text).toBe('答案');
});
test('MCP mode still refuses any other remote model transport',async()=>{
  await expect(callLLM({model:reply('openai'),prompt:'問題'} as Parameters<typeof callLLM>[0],'qa')).rejects.toThrow('MCP mode refuses remote model transports');
});
