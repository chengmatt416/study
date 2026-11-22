'use client';
import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { useStudyLiveAi,requireStudyLiveAi } from '@/lib/study-classroom/live-ai';
import type { QuestionResult } from '@/lib/quiz/grading';
interface ReviewContext {review:(id:string)=>Promise<void>;busy:string|null;error:{id:string;text:string}|null;available:boolean;reason:string|null}
const Context=createContext<ReviewContext|null>(null);
export function StudyQuizReviewProvider({sceneId,answers,onReview,children}:{sceneId:string;answers:Record<string,string|string[]>;onReview:(result:QuestionResult)=>Promise<void>;children:ReactNode}){
  const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<ReviewContext['error']>(null);
  const liveAi=useStudyLiveAi();
  const pending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const review=async(id:string)=>{
    if(pending.current||!liveAi.available)return;pending.current=true;setBusy(id);setError(null);
    try{
      await requireStudyLiveAi();
      const response=await fetch('/api/openmaic/live/grade',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scene_id:sceneId,question_id:id,answer:answers[id]??'',ai_review:true})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'覆核暫時無法完成');
      if(alive.current)await onReview(body as QuestionResult);
    }catch(cause){if(alive.current)setError({id,text:cause instanceof Error?cause.message:'覆核暫時無法完成；原成績已保留'});}
    finally{pending.current=false;if(alive.current)setBusy(null);}
  };
  return <Context.Provider value={{review,busy,error,available:liveAi.available,reason:liveAi.reason}}>{children}</Context.Provider>;
}
export function StudyQuizRegrade({id,result}:{id:string;result:QuestionResult}){
  const context=useContext(Context);if(!context)return null;
  return <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3 space-y-2">
    <p className="text-xs text-gray-500">{result.correct===null?'待覆核，尚未計入總分。':result.aiComment?.startsWith('AI 覆核')?'已由 AI 覆核。':'已由系統批改，未使用 AI。'}</p>
    {result.aiComment&&<p className="text-xs text-gray-600 dark:text-gray-300">{result.aiComment}</p>}
    <button type="button" disabled={!!context.busy||!context.available} onClick={()=>void context.review(id)} className="min-h-11 rounded-lg border border-violet-200 dark:border-violet-700 px-3 text-xs text-violet-700 dark:text-violet-300 disabled:opacity-50">{context.busy===id?'AI 正在覆核…':'請 AI 覆核'}</button>
    <span className="ml-2 text-xs text-gray-500">{!context.available?context.reason:'僅點擊後使用 AI，計入用量限制'}</span>
    {context.error?.id===id&&<p role="alert" className="text-xs text-red-600">{context.error.text}；原成績已保留。</p>}
  </div>;
}
