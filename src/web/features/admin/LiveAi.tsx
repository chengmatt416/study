import { useEffect,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api,errorMessage } from '../../lib/api';
import { Button,Card,fieldCls,inputCls,Loading,toast } from '../../components/ui';
interface Config {
  enabled:number;model:string;key_configured:boolean;encryption_ready:boolean;max_output_tokens:number;requests_per_minute:number;requests_per_day:number;tokens_per_day:number;global_requests_per_day:number;global_tokens_per_day:number;max_calls_per_turn:number;
}
interface User {email:string;name:string|null;enabled:number;requests_per_minute:number|null;requests_per_day:number|null;tokens_per_day:number|null;requests_today:number;tokens_today:number}
const fields:{key:keyof Pick<Config,'max_output_tokens'|'requests_per_minute'|'requests_per_day'|'tokens_per_day'|'global_requests_per_day'|'global_tokens_per_day'|'max_calls_per_turn'>;label:string;min:number;max:number}[]=[
  {key:'max_output_tokens',label:'每次模型回應最多 token（至少 4096）',min:4096,max:32768},{key:'max_calls_per_turn',label:'每次提問最多模型呼叫',min:1,max:12},{key:'requests_per_minute',label:'每人每分鐘提問',min:1,max:60},{key:'requests_per_day',label:'每人每日提問',min:1,max:10000},{key:'tokens_per_day',label:'每人每日 token 預算',min:1000,max:10000000},{key:'global_requests_per_day',label:'全站每日提問',min:1,max:100000},{key:'global_tokens_per_day',label:'全站每日 token 預算',min:1000,max:100000000},
];
export function LiveAi(){
  const config=useQuery({queryKey:['admin-live-ai'],queryFn:()=>api.get<{config:Config}>('/api/admin/live-ai')});
  const users=useQuery({queryKey:['admin-live-ai-users'],queryFn:()=>api.get<{users:User[]}>('/api/admin/live-ai/users')});
  const [form,setForm]=useState<Config|null>(null),[key,setKey]=useState(''),[clear,setClear]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{if(config.data)setForm(config.data.config);},[config.data]);
  if(config.error||users.error)return <Card className="p-5"><p role="alert">{errorMessage(config.error??users.error)}</p></Card>;
  if(!form)return <Loading/>;
  const save=async()=>{setSaving(true);try{await api.put('/api/admin/live-ai',{...form,enabled:!!form.enabled,api_key:key.trim()||undefined,clear_key:clear});setKey('');setClear(false);await config.refetch();toast('課堂 AI 設定已儲存');}catch(error){toast(errorMessage(error),'err');}finally{setSaving(false);}};
  return <div className="space-y-5">
    <Card className="p-5"><h2 className="text-lg font-semibold">課堂即時 AI</h2><p className="mt-2 max-w-3xl text-sm text-slate-500">教材、投影片、互動與教學對話由 chatbot MCP 預先生成。OpenRouter 只用於學生主動提問與要求重新評分；不會用 API 自動製作課程。</p>
      <label className="mt-5 flex items-center gap-3"><input type="checkbox" checked={!!form.enabled} onChange={event=>setForm({...form,enabled:event.target.checked?1:0})}/>開放課堂即時 AI（學生須在課堂手動啟用）</label>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm"><span>OpenRouter 模型 ID</span><input className={inputCls} value={form.model} onChange={event=>setForm({...form,model:event.target.value})} placeholder="provider/model-id"/><a className="block text-xs underline" href="https://openrouter.ai/models?order=pricing-low-to-high" target="_blank" rel="noreferrer">查看模型與價格；課堂互動需要支援工具呼叫的文字模型</a></label>
      <label className="space-y-1 text-sm md:col-span-2"><span>API key · {form.key_configured?'已儲存，留空保留原 key':'尚未設定'}</span><input className={inputCls} type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={event=>setKey(event.target.value)} placeholder="只在新增或更換時輸入"/><span className="block text-xs text-slate-500">加密儲存，僅伺服器呼叫 OpenRouter；不會回傳到課堂或設定讀取 API。</span></label></div>
      {!form.encryption_ready&&<p role="alert" className="mt-3 text-sm text-rose-600">伺服器尚未配置金鑰加密，暫時不能儲存 API key。</p>}
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={clear} onChange={event=>setClear(event.target.checked)}/>清除已儲存的 key</label>
      <h3 className="mt-6 font-semibold">用量與費用保護</h3><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(field=><label key={field.key} className="space-y-1 text-sm"><span>{field.label}</span><input type="number" className={inputCls} min={field.min} max={field.max} value={form[field.key]} onChange={event=>setForm({...form,[field.key]:Number(event.target.value)})}/></label>)}</div>
      <p className="mt-4 max-w-3xl text-xs leading-6 text-slate-500">每日額度於台灣時間 08:00 重置。每次提問可能包含教師與同學的多個模型回合，另有回合呼叫上限及全站 token 預算。成功回應依供應商 token 用量結算；無法確認用量的請求保留預留額度。也可在 OpenRouter 為此 key 設定信用額度上限。</p>
      <Button className="mt-4" variant="primary" onClick={save} disabled={saving}>{saving?'儲存中…':'儲存設定'}</Button>
    </Card>
    <Card className="p-5"><h2 className="font-semibold">逐人 API 權限（預設允許，取消勾選即停用）</h2><p className="mt-2 text-sm text-slate-500">新帳號預設不開放。停用後，既有互動回合的下一次模型呼叫也會被拒絕；不影響閱讀教材與系統批改。</p><div className="mt-4 divide-y divide-slate-100 dark:divide-white/10">{users.data?.users.map(user=><UserRow key={user.email} user={user} refresh={()=>{void users.refetch();}}/>)}</div></Card>
  </div>;
}
function UserRow({user,refresh}:{user:User;refresh:()=>void}){
  const [enabled,setEnabled]=useState(!!user.enabled),[minute,setMinute]=useState(user.requests_per_minute?.toString()??''),[day,setDay]=useState(user.requests_per_day?.toString()??''),[tokens,setTokens]=useState(user.tokens_per_day?.toString()??''),[saving,setSaving]=useState(false);
  useEffect(()=>{setEnabled(!!user.enabled);setMinute(user.requests_per_minute?.toString()??'');setDay(user.requests_per_day?.toString()??'');setTokens(user.tokens_per_day?.toString()??'');},[user]);
  const save=async()=>{setSaving(true);try{await api.put('/api/admin/live-ai/users/'+encodeURIComponent(user.email),{enabled,requests_per_minute:minute?Number(minute):null,requests_per_day:day?Number(day):null,tokens_per_day:tokens?Number(tokens):null});refresh();toast('使用權限已更新');}catch(error){toast(errorMessage(error),'err');}finally{setSaving(false);}};
  return <div className="flex flex-wrap items-end gap-3 py-4"><div className="min-w-48 flex-1"><p className="text-sm font-medium">{user.name??user.email}</p><p className="text-xs text-slate-500">{user.email}</p><p className="mt-1 text-xs text-slate-500">今日 {user.requests_today??0} 次 · {user.tokens_today??0} token</p></div><label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>允許 API</label>{[['每分鐘',minute,setMinute],['每日次數',day,setDay],['每日 token',tokens,setTokens]].map(([label,value,set])=><label className="w-28 space-y-1 text-xs" key={label as string}><span>{label as string}</span><input type="number" min="1" placeholder="依全站預設" className={fieldCls+' w-full'} value={value as string} onChange={event=>(set as (value:string)=>void)(event.target.value)}/></label>)}<Button size="sm" onClick={save} disabled={saving}>{saving?'儲存中':'更新'}</Button></div>;
}
