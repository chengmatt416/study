'use client';
import { useRef } from 'react';
const keys = [ ['分數','\\frac{}{}',6],['根號','\\sqrt{}',6],['次方','^{}',2],['下標','_{}',2],['π','\\pi ',4],['×','\\times ',7],['÷','\\div ',5],['≤','\\le ',4],['≥','\\ge ',4],['括號','()',1] ] as const;
export function StudyFormulaInput({value,onChange,disabled,placeholder}:{value:string;onChange:(value:string)=>void;disabled?:boolean;placeholder?:string}) {
  const input=useRef<HTMLTextAreaElement>(null);
  return <div className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden focus-within:ring-2 focus-within:ring-violet-200">
    <textarea ref={input} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} placeholder={placeholder} aria-label="答案或 LaTeX 公式" className="w-full min-h-[100px] p-3 text-sm resize-y bg-transparent outline-none" />
    <div role="group" aria-label="簡易公式鍵盤" className="flex flex-wrap gap-1 p-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      {keys.map(([label,latex,offset])=><button type="button" key={label} disabled={disabled} aria-label={'插入'+label} className="min-h-10 min-w-10 px-2 rounded-md border border-gray-200 dark:border-gray-600 text-xs hover:bg-violet-100 dark:hover:bg-violet-900 disabled:opacity-50" onPointerDown={event=>event.preventDefault()} onClick={()=>{
        const field=input.current;if(!field)return;const start=field.selectionStart,end=field.selectionEnd;
        const selected=value.slice(start,end);const insert=selected&&latex.includes('{}')?latex.replace('{}','{'+selected+'}'):latex;
        onChange(value.slice(0,start)+insert+value.slice(end));requestAnimationFrame(()=>{field.focus();const cursor=start+(selected?insert.length:offset);field.setSelectionRange(cursor,cursor);});
      }}>{label}</button>)}
      <span className="self-center text-xs text-gray-500 px-1">也可直接輸入 LaTeX</span>
    </div>
  </div>;
}
