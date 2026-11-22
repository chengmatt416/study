import { advanceGeneration, generationCourse, type CourseGenerationState } from "../../src/shared/course-generation";

export const planOutput = {
  title: "週期與質量", description: "探究物理量的關係", objectives: ["能用公式預測變化"],
  modules: [{ id: "lab", title: "變因探究", learningObjective: "理解平方根關係", instructions: "預測後調整質量，觀察並解釋", reflection: "模型有哪些假設？", widgetType: "simulation", pretest: [{ id: "pre1", type: "single", question: "固定彈簧時，質量九倍的週期比？", options: [{ label: "三倍", value: "A" }, { label: "九倍", value: "B" }], answer: ["A"], analysis: "在彈簧常數固定時，週期與質量平方根成正比；九倍質量對應三倍週期，線性增加的想法是常見誤解。", points: 1 }] }],
};
export const qualityReview = {
  teaching: { score: 4, evidence: "由預測四倍質量的結果開始，再操作滑桿比對平方根關係，最後說明理想模型假設與控制變因。" },
  accuracy: { score: 4, evidence: "固定彈簧常數並使用週期比值，m=1 與 m=4 分別得到 1 與 2；確認圖中顯示的是無單位比值。" },
  interaction: { score: 4, evidence: "質量滑桿的 input 事件立即更新 output；reset 按鈕還原 m=1 並重算顯示，邊界範圍為 1 到 4。" },
  visual_design: { score: 4, evidence: "body 使用黑色背景與白色前景，控制項採中性灰，留白 24px 並讓讀值成為焦點；未加不必要光暈。" },
  accessibility: { score: 4, evidence: "黑色 #000 與白色 #fff 對比為 21:1；使用原生有標籤滑桿與按鈕支援鍵盤，版面依容器寬度排列。" },
};
export const polishPass = {
  refinements: [
    { area: "motion", problem: "初稿在質量控制改變時同時展開全部文字，指令與觀察結果的出現順序不清楚，容易打斷操作。", change: "將 observe 步驟綁定 #m 的 input 與值 4，使用平台短指令轉場與延後 80ms 的教材揭露。", evidence: "程式檢閱確認控制讀值先更新，再由事件 bridge 推進指令、側欄教材與進度；沒有聲稱執行瀏覽器測試。" },
    { area: "content", problem: "初稿只說週期會增加，沒有交代質量比例、平方根關係、控制變因與模型適用前提，缺乏推理。", change: "在 predict 要求預測質量比四倍，observe 比較 √4=2，反思再連結固定 k 與理想彈簧假設。", evidence: "以文字與公式檢閱確認任務有明確可觀察結果，測驗 q1 對應預測、q2 對應假設、q3 對應實驗遷移。" },
    { area: "layout", problem: "初稿側邊文字在互動後才加入網格，導致模擬畫布突然變窄，控制項位置移動且讀值層次不清。", change: "由平台依所有步驟預留側欄，初始顯示操作指令，後續加入 observe 教材；標題與數值採不同字級。", evidence: "以元件與 CSS 檢閱確認 has-side-rail 開始即存在，畫布不因新教材改變欄寬，手機仍依序單欄排列。" },
  ],
  event_choreography: [{ step_id: "observe", control_feedback: "#m 收到真實 input 且值為 4 時，先立即更新 result 週期比讀值為 2，再由 bridge 發送步驟進度。", instruction_transition: "predict 指令短淡出後由 observe 指令取代，使用相同減速曲線，不用逐字動畫也不等待動畫完成才接受操作。", related_regions: "同一事件讓側欄逐步加入平方根教材，進度條以 scaleX 更新，最後顯示完成訊息；舊教材保持可回顧且不重播。" }],
};
export const moduleOutput = {
  teaching_steps: [
    { id: "concept", title: "先理解週期與質量", body_md: "週期是完成一次往復運動的時間。固定彈簧常數時，質量增加讓慣性增大，因此週期增加，但不是線性增加。", explanation_md: "想像用同一根彈簧拉動不同質量的物體：質量越大，改變運動狀態就越慢。我們先固定彈簧常數，才能單獨研究質量的影響。週期表示一次完整往返的時間，不是走過的距離，也不是振幅。" },
    { id: "worked", title: "一步步算出週期比", body_md: "將新舊週期公式相除，固定的常數會抵消，只留下質量比的平方根。因此質量四倍時，週期比是 √4=2。", explanation_md: "先寫出兩次週期的公式，再取新週期除以原週期。兩式中的 2π 和相同的彈簧常數都抵消，因此比值只剩質量比的平方根。以質量九倍為例，√9=3，所以週期三倍，不是九倍；也不是先開根號再除以原質量。" },
  ],
  checkpoint: [{ id: "check1", type: "single", question: "質量變成十六倍，固定彈簧常數時週期變成幾倍？", options: [{ label: "四倍", value: "A" }, { label: "十六倍", value: "B" }], answer: ["A"], analysis: "將新舊週期公式相除，常數與相同的彈簧常數抵消，得到質量比的平方根 √16=4；十六倍是誤用線性比例。", points: 1 }],
  interaction_design: {
    pattern: "manipulate" as const,
    rationale: "這個模組以連續控制質量直接比較平方根關係，讓圓形半徑與週期比同時改變，無須先猜答案作為進入操作的門檻。",
    primary_control: "#m", visual_selector: "#visual",
    observable_response: "質量滑桿 input 同步改變週期比 output 與 SVG 圓形半徑，參照起始形狀比較變化，並保留單位與量的清楚標註。",
    learning_evidence: "使用者將質量由一調至四，觀察圖像與週期只增為兩倍，能依控制後的關係與公式說明平方根而非線性變化。",
    visual_hierarchy: "以黑底白色的 SVG 圓形為主要視覺，質量控制放在圖形旁，週期讀值以等寬數字呈現，標籤與說明保留清楚留白。",
    motion_states: {
      idle: "初始質量與週期比均為一，圖形半徑十單位，所有標籤靜止並保留足夠對比，未使用任何持續裝飾或呼吸效果。",
      active: "操作滑桿時立即更新週期比及圓形大小，固定 SVG 畫布與控制項位置，避免重建圖形或讓文字造成版面位移。",
      settled: "停止輸入後保持最後的準確圖形與數值，沒有持續晃動，也不把裝飾動畫當成課程解鎖條件或阻擋下一次操作。",
      reset: "重設按鈕同時還原控制、週期比與圓形半徑，沒有殘留的軌跡或標註，讓後續操作從相同且可重現的初始狀態開始。",
    },
  },
  html: '<!doctype html><html lang="zh-Hant"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#000;color:#fff;font:16px/1.6 system-ui}label{display:block}input{max-width:100%;accent-color:#fff}button{min-height:44px;background:#fff;color:#000}output{display:block;font-variant-numeric:tabular-nums}</style></head><body><label>質量比<input id="m" type="range" min="1" max="4" value="1"></label><output id="result">1</output><svg id="visual" viewBox="0 0 100 100"><circle id="mass-dot" cx="50" cy="50" r="10" fill="white"/></svg><button id="reset">重設</button><script>const m=document.getElementById("m"),r=document.getElementById("result");m.oninput=()=>(r.textContent=Math.sqrt(Number(m.value)),document.getElementById("mass-dot").setAttribute("r",String(10*Math.sqrt(Number(m.value)))));document.getElementById("reset").onclick=()=>{m.value="1";m.oninput()}</script></body></html>',
  checks: { controls_work: true, reset_works: true, units_verified: true, keyboard_mobile: true, self_contained: true }, verification_notes: "以公式檢查 m=1 與 m=4，檢閱輸入與重設事件。",
  quality_review: qualityReview,
  polish_pass: polishPass,
  lesson_steps: [
    { id: "predict", title: "先預測", instruction_md: "預測質量比變成 4 時的週期比，再將質量調到 4。", blocks: [{ markdown: "週期與質量的關係", font: "serif", size: "lead", tone: "primary", align: "center", position: "above" }] },
    { id: "observe", title: "觀察與解釋", instruction_md: "比較週期比與你的預測，再使用重設按鈕回到初始狀態。", blocks: [{ markdown: "質量比為 4 時，週期比為 $\\sqrt{4}=2$。", font: "mono", size: "body", tone: "secondary", align: "left", position: "beside" }], reveal_on: { event: "input", selector: "#m", value: "4" } },
  ],
};
export const quizOutput = {
  title: "理解檢查", questions: [
    { id: "q1", type: "single", question: "質量四倍，週期為幾倍？", options: [{ label: "二倍", value: "A" }, { label: "四倍", value: "B" }], answer: ["A"], analysis: "固定 k 時，T 與質量的平方根成正比，因此 √4=2；選四倍是把平方根關係誤當成線性關係。", points: 1 },
    { id: "q2", type: "multiple", question: "選出正確假設", options: [{ label: "無阻尼", value: "A" }, { label: "線性彈簧", value: "B" }, { label: "振幅無限大", value: "C" }], answer: ["A", "B"], analysis: "週期公式假設無阻尼且回復力線性；振幅無限大會超出真實彈簧的線性範圍，不能當作模型成立條件。", points: 2 },
    { id: "q3", type: "short_answer", question: "如何驗證模型？", answer: ["控制 k，改變 m，畫 T² 對 m 的圖。"], analysis: "檢核是否固定同一彈簧以控制 k，改變 m 並重複測量週期；使用 T² 對 m 作圖，確認接近通過原點的直線。", points: 1 },
  ],
};
export const reviewOutput = {
  checks: { source_fidelity: true, scientific_accuracy: true, interactive_behavior: true, accessibility: true, quiz_answers: true },
  verification_notes: "已逐項檢閱教材、公式、互動事件與測驗答案；未聲稱執行瀏覽器測試。",
  quality_review: qualityReview,
  polish_pass: polishPass,
  objective_coverage: [{ objective: "能用公式預測變化", module_ids: ["lab"], question_ids: ["q1", "q2", "q3"], evidence: "lab 以參數控制展示平方根關係；q1 測預測結果，q2 檢核模型假設，q3 將公式遷移為可操作的實驗設計。" }],
};
export const initialState = (): CourseGenerationState => ({ topic: "週期與質量", source_revision_id: "revision-1", expected_course_version: 0, plan: null, modules: [], module_checks: [], quiz: null, review: null });
export function completedState() {
  return [planOutput, moduleOutput, quizOutput, reviewOutput].reduce((state, output) => advanceGeneration(state, output), initialState());
}
export const generatedCourse = () => generationCourse(completedState());
