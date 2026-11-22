'use client';
import { useSyncExternalStore } from 'react';
import { allowCoachToAskAgain } from './coach';
export interface StudyLiveAiStatus { available: boolean; checking: boolean; reason: string | null; providerReady: boolean; sessionEnabled: boolean }
const initial: StudyLiveAiStatus = { available:false, checking:true, reason:'正在確認課堂 AI 是否可用…', providerReady:false, sessionEnabled:false };
let status = initial;
let checkedAt = 0;
let pending: Promise<StudyLiveAiStatus> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<()=>void>();
const snapshot = () => status;
function publish(next: StudyLiveAiStatus) { status=next; checkedAt=Date.now(); for(const listener of listeners)listener(); return next; }
export function refreshStudyLiveAi(force=false): Promise<StudyLiveAiStatus> {
  if(pending)return pending;
  if(!force&&Date.now()-checkedAt<10000)return Promise.resolve(status);
  pending=(async()=>{
    try{
      const response=await fetch('/api/openmaic/live/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      const body=await response.json() as {available?:unknown;reason?:unknown;error?:unknown;session_enabled?:unknown};
      const providerReady=response.ok&&body.available===true,sessionEnabled=providerReady&&body.session_enabled===true,available=sessionEnabled;
      const reason=providerReady?(sessionEnabled?null:'尚未在本次課堂啟用 AI；啟用後才能提問、討論與 AI 覆核。'):typeof body.reason==='string'?body.reason:typeof body.error==='string'?body.error:'課堂 AI 未啟用，相關功能已停用。';
      return publish({available,checking:false,reason,providerReady,sessionEnabled});
    }catch{return publish({available:false,checking:false,reason:'無法確認課堂 AI 連線，相關功能暫時停用。',providerReady:false,sessionEnabled:false});}
    finally{pending=null;}
  })();
  return pending;
}
const refreshOnFocus=()=>{if(document.visibilityState==='visible')void refreshStudyLiveAi(true);};
function subscribe(listener:()=>void){
  listeners.add(listener);
  if(listeners.size===1){
    void refreshStudyLiveAi();
    timer=setInterval(refreshOnFocus,30000);
    window.addEventListener('focus',refreshOnFocus);document.addEventListener('visibilitychange',refreshOnFocus);
  }
  return()=>{listeners.delete(listener);if(!listeners.size){clearInterval(timer);window.removeEventListener('focus',refreshOnFocus);document.removeEventListener('visibilitychange',refreshOnFocus);}};
}
export function useStudyLiveAi(){return useSyncExternalStore(subscribe,snapshot,()=>initial);}
export async function requireStudyLiveAi(){const current=await refreshStudyLiveAi(true);if(!current.available)throw new Error(current.reason??'課堂 AI 已停用');}
export async function setStudyLiveAiSession(enabled:boolean){
  const response=await fetch('/api/openmaic/live/session',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled}),cache:'no-store'});
  if(!response.ok){const body=await response.json().catch(()=>({})) as {error?:unknown};throw new Error(typeof body.error==='string'?body.error:'無法變更課堂 AI 設定');}
  // With AI on, the coach may explain what it could only point at before.
  if(enabled)allowCoachToAskAgain();
  return refreshStudyLiveAi(true);
}
