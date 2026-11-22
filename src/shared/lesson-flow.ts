import { z } from "zod";
import { STUDY_MOTION } from "./motion";

const text = z.string().trim().min(1);
export const lessonStepSchema = z.object({
  id: text.regex(/^[a-zA-Z][\w-]*$/).max(100), title: text.max(200), instruction_md: text.max(3000),
  blocks: z.array(z.object({
    markdown: text.max(12000), font: z.enum(["sans", "serif", "mono"]).default("sans"),
    size: z.enum(["body", "lead", "display"]).default("body"),
    tone: z.enum(["primary", "secondary", "muted", "accent"]).default("primary"),
    align: z.enum(["left", "center", "right"]).default("left"),
    position: z.enum(["above", "beside", "below"]).default("below"),
  })).min(1),
  reveal_on: z.object({
    event: z.enum(["click", "input", "change", "submit", "keydown", "pointerup", "drop"]),
    selector: text.max(300).describe("目前模組 HTML 內的穩定 CSS selector；可用成功狀態屬性選擇器確保作答正確才前進"),
    value: z.string().max(500).optional().describe("選填，控制項輸入值完全相符才前進"),
    key: z.string().max(40).optional().describe("keydown 必填，例如 Enter；不可讓 Tab 移動焦點就揭露內容"),
  }).optional(),
});
export const lessonStepsSchema = z.array(lessonStepSchema).min(2).superRefine((steps, ctx) => {
  if (new Set(steps.map((s) => s.id)).size !== steps.length) ctx.addIssue({ code: "custom", message: "lesson_steps id 不可重複" });
  steps.forEach((s, i) => {
    if ((i === 0) === !!s.reveal_on) ctx.addIssue({ code: "custom", path: [i, "reveal_on"], message: i === 0 ? "第一步由開始課程揭露，不可設定 reveal_on" : "後續每一步必須由使用者互動事件 reveal_on 觸發" });
    if (s.reveal_on?.event === "keydown" && !s.reveal_on.key) ctx.addIssue({ code: "custom", path: [i, "reveal_on", "key"], message: "keydown 必須指定 key" });
  });
});
export type LessonStep = z.infer<typeof lessonStepSchema>;

// Runs only inside the opaque-origin lesson iframe. No model-generated script is evaluated by the host.
const runtime = String.raw`function(steps,channel){
let current=-1,lastTime=-Infinity,gesture=0,consumed=-1;
document.addEventListener('pointerdown',event=>{if(event.isTrusted)gesture++;},true);
document.addEventListener('keydown',event=>{if(event.isTrusted&&!event.repeat)gesture++;},true);
function show(index){current=index;document.querySelectorAll('[data-lesson-content],[data-lesson-instruction]').forEach(el=>{
const content=el.getAttribute('data-lesson-content'),id=content??el.getAttribute('data-lesson-instruction');
const i=steps.findIndex(s=>s.id===id),visible=i>=0&&(content!==null?i<=current:i===current);
const firstReveal=visible&&!el.hasAttribute('data-lesson-visible');
el.hidden=!visible;if(visible){if(firstReveal)el.style.setProperty('--study-reveal-delay',content!==null?'80ms':'0ms');el.setAttribute('data-lesson-visible','');}else el.removeAttribute('data-lesson-visible');
});}
window.addEventListener('message',event=>{const d=event.data;
if(event.source!==window.parent||d?.type!=='study:lesson-sync'||d.channel!==channel)return;
if(Number.isInteger(d.index)&&d.index>=-1&&d.index<steps.length)show(d.index);});
for(const type of ['click','input','change','submit','keydown','pointerup','drop'])document.addEventListener(type,event=>{
if(!event.isTrusted||current<0||gesture===consumed||event.timeStamp-lastTime<200)return;
const next=steps[current+1],trigger=next?.reveal_on;if(!trigger||event.type!==trigger.event||!(event.target instanceof Element))return;
const target=event.target;queueMicrotask(()=>{if(steps[current+1]!==next)return;let control;
try{control=target.closest(trigger.selector);}catch{return;}
if(!control||(trigger.value!==undefined&&control.value!==trigger.value))return;
if(trigger.event==='keydown'&&event.key!==trigger.key)return;
lastTime=event.timeStamp;consumed=gesture;show(current+1);window.parent.postMessage({type:'study:lesson-progress',channel,index:current,step_id:next.id},'*');});});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>show(current));else show(current);
}`;

export function lessonFlowPrelude(steps: LessonStep[], channel: string): string {
  const data = JSON.stringify(steps).replace(/</g, "\\u003c");
  return `<style>:root{--study-motion-feedback:${STUDY_MOTION.feedback * 1000}ms;--study-motion-instruction:${STUDY_MOTION.instruction * 1000}ms;--study-motion-reveal:${STUDY_MOTION.reveal * 1000}ms;--study-motion-ease:cubic-bezier(${STUDY_MOTION.ease.join(",")})}[data-lesson-content]:not([data-lesson-visible]),[data-lesson-instruction]:not([data-lesson-visible]){display:none!important}[data-lesson-visible]{animation:study-lesson-reveal var(--study-motion-reveal) var(--study-motion-ease) var(--study-reveal-delay,0ms) both}@keyframes study-lesson-reveal{from{opacity:0;transform:translateY(${STUDY_MOTION.travel}px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){[data-lesson-visible]{animation:none}}</style><script>(${runtime})(${data},${JSON.stringify(channel)});</script>`;
}

export function acceptsLessonProgress(data: unknown, channel: string, steps: LessonStep[], current: number): data is { index: number } {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return current + 1 < steps.length && d.type === "study:lesson-progress" && d.channel === channel && d.index === current + 1 && d.step_id === steps[current + 1].id;
}

export const lessonFlowGuide = `必須輸出 lesson_steps：第一步在學習者完成逐步教學並進入本章互動練習後出現，不設 reveal_on；後續每步以 reveal_on.event 與 selector 綁定 HTML 中的真實使用者操作，可指定 value 或 key。平台只接受真實 click/input/change/submit/keydown/pointerup/drop，合成事件、計時器、滾動與同一次拖曳不能連續跳多步。若須答對才前進，將成功狀態屬性設於控制項並以 selector 匹配；不可隨便點一下就算理解。每步有 title、instruction_md 與 blocks；blocks 的 markdown 搭配 font(sans/serif/mono)、size(body/lead/display)、tone(primary/secondary/muted/accent)、align(left/center/right)、position(above/beside/below)，讓同一模組內有精緻的字型、大小、灰階色彩與位置變化。主教材、解析、模組操作說明都必須依事件逐步揭露；未解鎖內容不得先顯示。HTML 內對應的教材容器標記 data-lesson-content=步驟id（已解鎖教材保留），操作說明容器標記 data-lesson-instruction=步驟id（只顯示目前指令）。平台會管理隱藏與柔和轉場；不得用 CSS 強行揭露未解鎖內容。互動場景可自行設計細緻狀態動畫，使用 opacity/transform 與有節奏的 200–500ms 轉場，尊重 prefers-reduced-motion。拖曳與建構可用 pointerup/drop，務必在真實事件處理時更新成功狀態，並提供 click/keydown 的等效鍵盤操作。每步操作有可見提示、鍵盤路徑、成功/錯誤回饋與重設，避免使用者無從前進。請檢查所有 reveal_on selector 都存在且事件實際可觸發。`;
