import { z } from "zod";

export const COURSE_QUALITY_POLICY = "study-monochrome/v5";

export const courseDesignBrief = {
  direction: "黑白編輯式教學介面：克制、精準、清楚、有層次；教學與可操作性優先。",
  palette: "黑、白、中性灰作為整門課程與 module 的主色；至少 90% 視覺面積保持無彩色。全課選定一致的深色或淺色基底。僅在科學語意必須時少量使用低飽和輔色，且以標籤、線型或形狀重複編碼；不要彩色漸層、霓虹主題或預設藍紫色介面。",
  glow: "可選用白色或中性灰局部光暈，使用內嵌 CSS radial-gradient 或柔和 box-shadow，低不透明度約 0.04–0.12，最多 1–2 處焦點；置於裝置/圖像後方且 pointer-events:none。不要模糊文字、降低圖表對比、遮蓋操作或製造持續閃爍。無教學或構圖必要時不加光暈。",
  typography: "同一模組內可細緻搭配本機 sans（system-ui/PingFang TC）、serif（Georgia/Noto Serif TC）與 mono（ui-monospace）字型，依概念、敘事、公式/讀值選擇，不載入外部字型。正文至少 16px、行高約 1.6–1.8；標題/引言/正文/註解用不同字級與黑白灰字色建立層次。可混合左中右對齊、上方/側邊/下方內容，但手機保持清楚閱讀順序；數字用 tabular-nums、單位緊鄰讀值，不讓大字擠壓互動區。",
  composition: "同課程共享 CSS 變數、間距節奏、字級與控制項語言；根據教學任務改變構圖。讓主要視覺化成為焦點，將控制、觀察結果與解析安排在清楚的閱讀順序；留白充足，避免每一句都塞卡片、無意義徽章或裝飾儀表板。",
  polish: "先完成可用初稿，再做一次真正的精修：刪掉模板式開場與重複文字、重新校準標題/正文/圖表/數字的比例、統一控制項與單位、修正手機斷行與長標題、讓每個圖像有清楚的解讀目的。至少記錄動態、教學內容、字體或版面三種不同的具體改進，並引用改後的 selector、step id 或文字。不能只換顏色、加陰影或把頁面填滿卡片就宣稱 polished。",
  art_direction: "互動區本身必須精修，不只宿主頁面好看：一個明確的視覺主角，精準的圖形/座標/標籤、規整留白與對齊，使用不同字級區分問題、圖形標註、讀值與操作。內部不要再重複巨大課程標題、塞滿灰色卡片、做滿版控制面板或用大段文字代替視覺。手機至少保留可操作的核心畫布，不把操作擠到長文末端；一個模組維持一致基線與 8/16/24/32px 間距節奏。",
  module_motion: "動畫要實作在 module 的 SVG/Canvas/圖解與控制項上：idle、active、settled、reset 四種狀態清楚。拖曳/輸入時同一物件連續變形或位移，圖形標籤跟隨對象；立即顯示真實值，短轉場銜接顯示，不重建整張圖造成閃動。放開後用克制的減速或阻尼收尾；新操作取消舊動畫，reset 同步復位全部標記、軌跡、控制與讀值。SVG path 可用 stroke-dashoffset 表達因果路徑，物件狀態用 transform/opacity；只有數學/物理含義需要時才持續模擬。reduced-motion 立即更新最終狀態。不得用全畫面淡入、呼吸光暈或按鈕 hover 冒充精緻的互動動畫。",
  interaction: "科學（物理、化學、生物）：畫出真實器材零件讓學習者自訂操作（拖曳、倒入、接線、放置、讀刻度），順序錯有後果，操作後把讀數記進紀錄表再檢核結果；滑桿可在連續量確實適合時使用，但不要用滑桿加讀值冒充模擬實驗。數學：講解後直接做題（數值、選擇、排序），不做實驗。控制項具 label、單位、合理初始值與範圍，操作立即反映在圖形及數值；有重設、空值/邊界處理與可理解回饋。圖像與操作要解釋概念，不是裝飾動畫。",
  progression: "主教材與模組指令都以 lesson_steps 依真實使用者事件逐步揭露，未解鎖內容保持隱藏；一次互動只推進一步。使用有層次的 opacity/transform 轉場與適當留白，變化服務理解，禁止純計時自動展開、閃爍或強迫觀看動畫。舊指令在新步驟到來時收起，已解鎖教材可保留供回顧。",
  accessibility: "檢查 360px、768px 與 1280px 版面，手機單欄且不橫向溢出；觸控目標盡量至少 44px，鍵盤能操作且 focus-visible 清楚。一般文字前景/背景對比至少 4.5:1，大字至少 3:1；用實際色碼計算或工具測量，不以光暈冒充對比。不能只靠顏色表達對錯。尊重 prefers-reduced-motion；動態裝飾僅用 transform/opacity，避免大面積反覆 blur。",
} as const;

export const courseContentBrief = {
  learning_sequence: "先以 pretest 診斷先備知識，從最早缺口依序學習；每章先以 teaching_steps 小步講解與示範，explanation_md 用更細步驟與例子回應不懂，再互動練習，最後 checkpoint 全對才進下一章。減少認知負荷、提供鷹架與提取練習；不可把點過控制項當成理解。",
  teaching: "每個學習目標應有來源依據、概念講解、逐步推理、可操作探究、常見誤解與遷移應用。依學習目標選擇操控、建構、比較、除錯診斷、排序、逐層探索或解題轉換；不要把「先預測」當作每個模組的固定開場或過關門檻。只有教學目標確實需要假設檢驗時，預測才作為可選的輔助步驟，不能取代主要操作。不能只生成外觀精緻的空殼、百科摘要或展示控制項。科學章節的操作是模擬器材與實驗紀錄；數學章節的操作是由淺到深的練習題，不硬做實驗。",
  editorial: "每一步只承擔一個清楚的教學意圖：用精準標題提出問題，指令指出可操作動作、可觀察結果及為何值得觀察；正文以短段落建立因果、條件與推理，圖表的標籤/座標/單位與公式逐一對應。刪除空泛鼓勵、重複總結、沒有資訊量的徽章與裝飾數字。解析需解釋為什麼，讓學習者能把結果遷移到新情境。",
  accuracy: "核對教材中的條件、符號、公式、單位、有效數字與模型適用範圍；至少驗算初始值與兩個邊界/代表輸入。資料不足標註需查證；不得捏造引用、實驗結果或驗證紀錄。",
  assessment: "測驗覆蓋全部目標，混合概念辨識、常見誤解與應用/遷移。干擾選項應反映具體錯誤推理；analysis 解釋推理步驟及為何其他選項不成立，不能只重述正解。簡答附可比對的參考答案與檢核規準。",
  review: "逐項引用實際模組、HTML/CSS 選擇器或程式行為，以及題號，寫出檢查依據。每項 1–5 分，4=內容完整且無阻擋問題，5=完整且具體精修；任何項目不足 4 分必須先 revise_course_generation 修正，不得虛報分數過關。自我審查不等於平台執行過瀏覽器測試。",
} as const;

const dimension = z.object({
  score: z.number().int().min(4).max(5).describe("依證據評分；不足 4 分先修正，不能虛報過關"),
  evidence: z.string().trim().min(30).max(2500).describe("至少 30 字，引用具體內容、參數、色碼/CSS 或操作行為；不可只寫已確認、良好或符合規範"),
});

const detail = z.string().trim().min(30).max(2500);
export const polishPassSchema = z.object({
  refinements: z.array(z.object({
    area: z.enum(["motion", "content", "typography", "layout", "feedback", "accessibility"]),
    problem: detail.describe("初稿的具體問題，不可只寫不夠精緻"),
    change: detail.describe("實際完成的修正，引用 selector、step id、文字或排版決策"),
    evidence: detail.describe("修正後如何改善學習與操作；未實際執行瀏覽器測試時須明說是程式/內容檢閱"),
  })).min(3),
  event_choreography: z.array(z.object({
    step_id: z.string().min(1).max(100),
    control_feedback: detail.describe("觸發事件、控制項與立即回饋"),
    instruction_transition: detail.describe("舊指令如何收起、新指令如何出現，以及事件觸發點"),
    related_regions: detail.describe("同一事件如何連動圖表/數值、側欄/主教材、進度與完成狀態，說明先後節奏"),
  })).min(1),
}).superRefine((pass, ctx) => {
  const areas = new Set(pass.refinements.map((r) => r.area));
  if (!areas.has("motion") || !areas.has("content") || (!areas.has("layout") && !areas.has("typography"))) ctx.addIssue({ code: "custom", message: "精修必須涵蓋動態、教學內容及版面/字體三類具體改進" });
});
export const qualityReviewSchema = z.object({
  teaching: dimension.describe("目標、探究、誤解與遷移教學是否完整"),
  accuracy: dimension.describe("來源、公式、單位、邊界值與正解核對"),
  interaction: dimension.describe("操作是否推動理解、即時回饋與重設是否正確"),
  visual_design: dimension.describe("黑白主色、字級、留白、一致性與克制光暈"),
  accessibility: dimension.describe("對比色碼/比值、手機寬度、鍵盤與減少動態效果"),
});

const designDetail = z.string().trim().min(30).max(2500);
export const interactionDesignSchema = z.object({
  pattern: z.enum(["manipulate", "construct", "compare", "diagnose", "sequence", "inspect", "worked_transform"]),
  rationale: designDetail.describe("為何這個操作適合此概念，與相鄰模組有何不同；不要例行要求先猜測"),
  primary_control: z.string().regex(/^#[A-Za-z][\w-]*$/).describe("HTML 內主要學習控制項的實際 id selector，必須對應 lesson_steps 的事件"),
  visual_selector: z.string().regex(/^#[A-Za-z][\w-]*$/).describe("承載概念圖形或可操作構圖的 SVG、Canvas 或語意 figure id selector，不能只有文字輸出"),
  observable_response: designDetail.describe("操作會如何改變實際圖像、關係與數值；不能只有顯示下一段文字"),
  learning_evidence: designDetail.describe("學習者透過哪個可觀察動作或產出展現理解，不把隨便猜一個答案當成學習"),
  visual_hierarchy: designDetail.describe("具體構圖、字級、對齊、圖形標籤、控制區與留白決策"),
  motion_states: z.object({ idle: designDetail, active: designDetail, settled: designDetail, reset: designDetail }),
});
