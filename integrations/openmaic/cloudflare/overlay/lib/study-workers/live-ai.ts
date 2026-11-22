import { createMcpLanguageModel } from '@/lib/study-mcp/model';
import type { ResolvedModel } from '@/lib/server/resolve-model';
import type { McpOutput } from '@/lib/study-mcp/store';
import { workersEnvironment } from './context';

type Part = { type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; output?: { value?: unknown } };
export function liveClassroomModel(grant: string): ResolvedModel {
  const model = createMcpLanguageModel(async (raw, signal): Promise<McpOutput> => {
    const request = raw as { prompt: {role:string;content:string|Part[]}[]; tools?: {type:string;name:string;description?:string;inputSchema:unknown}[]; toolChoice?: {type:string;toolName?:string}; responseFormat?: {type:string;schema?:unknown} };
    const messages: Record<string,unknown>[] = [];
    for (const entry of request.prompt) {
      if (typeof entry.content === 'string') { messages.push({role:entry.role,content:entry.content}); continue; }
      if (entry.role === 'tool') {
        for (const part of entry.content) if (part.type === 'tool-result') messages.push({role:'tool',tool_call_id:part.toolCallId,content:typeof part.output?.value === 'string' ? part.output.value : JSON.stringify(part.output?.value ?? null)});
      } else {
        const text = entry.content.filter(part=>part.type==='text').map(part=>part.text??'').join('\n');
        const calls = entry.content.filter(part=>part.type==='tool-call').map(part=>({id:part.toolCallId,type:'function',function:{name:part.toolName,arguments:JSON.stringify(part.input??{})}}));
        messages.push({role:entry.role,content:text || null,...(calls.length ? {tool_calls:calls}:{})});
      }
    }
    const tools = request.tools?.filter(tool=>tool.type==='function').map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}}));
    const choice = request.toolChoice;
    const response = await workersEnvironment().STUDY_LIVE_AI.fetch('https://study/internal/live-ai/completions', {
      method:'POST',headers:{'content-type':'application/json','x-study-live-grant':grant},
      body:JSON.stringify({messages,tools,tool_choice:choice?.type==='tool'?{type:'function',function:{name:choice.toolName}}:choice?.type??'auto',...(request.responseFormat?.type==='json'?{response_format:request.responseFormat.schema?{type:'json_schema',json_schema:{name:'classroom_response',schema:request.responseFormat.schema}}:{type:'json_object'}}:{})}), signal:signal as import('@cloudflare/workers-types').AbortSignal | undefined,
    });
    const body = await response.json() as {error?:string;message?:{content?:string;tool_calls?:{id:string;function:{name:string;arguments:string}}[]}};
    if (!response.ok || !body.message) throw new Error(body.error ?? '課堂 AI 暫時無法回應');
    const calls = body.message.tool_calls?.map(call=>({id:call.id,name:call.function.name,arguments:JSON.parse(call.function.arguments)}));
    return {text:body.message.content??'',...(calls?.length?{tool_calls:calls}:{})};
  });
  return {model:{...model,provider:'study-live',modelId:'admin-openrouter'},modelString:'study-live/admin-openrouter',providerId:'study-live',modelId:'admin-openrouter',modelInfo:{id:'admin-openrouter',name:'課堂即時 AI',capabilities:{tools:true,streaming:true,vision:false}},apiKey:'',serverManaged:true};
}
