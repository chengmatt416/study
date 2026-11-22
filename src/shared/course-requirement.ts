// The text the official generation run receives. It has a hard limit, so every step that accepts a plan measures it the same way.
import { blueprintRequirement, type CourseBlueprint } from './course-blueprint';
import { IB_REFERENCE_INSTRUCTIONS } from './ib-resources';
import { CHAPTER_FLOW, COURSE_CLOSING, POINTING_RULES, PRETEST_RULES, ROUTING_CONVENTION, SLIDE_QUESTION_RULE, TEACH_FIRST_RULE } from './module-kit-guide';

/** The official limit is 20,000; the rest is kept for the long-course part marker. */
export const MAX_COURSE_REQUIREMENT_CHARS = 19_800;
/** Room a plan leaves for its topic, which is not known yet while a plan is only being checked. A long-course topic never needs more. */
const TOPIC_RESERVE_CHARS = 500;

export function courseRequirement(topic: string, blueprint: CourseBlueprint): string {
  const requirement = `為「${topic}」建立繁體中文的完整 OpenMAIC 互動課堂，IB 術語附英文，以來源教材為依據。先以診斷測驗定位先備知識，再按章節先逐步教學、後互動、再獨立檢核。每個小步只教一個概念或示範推理，遇到不懂可請教師以更小步驟、圖解與例子說明。必須使用真正的 slide / quiz / interactive / pbl 場景及官方動作、白板與師生角色，不堆疊無目的 module。圖形、互動控制、字幕與重點指示要連動，動畫與轉場精修，支援鍵盤、手機與減少動態效果。黑白灰編輯式排版。這是 MCP 模式：所有模型回合交由外部 chatbot 提交，不要求模型 API key；優先使用自足 HTML/SVG 與已提供的教材資產。`;
  return `${requirement}\n教學使用學習者點擊才繼續的文字對話，不生成語音，也不依賴音訊時序。每個 speech action 聚焦一個小步驟；公式使用可讀的 LaTeX，保留完整推理。視覺提示、原生白板與互動操作依動作順序連動。互動 HTML 需適配手機與桌面，包含 viewport meta 與寬度 media query，使用彈性排版，控制項有明確標籤，詳解可展開，不把所有教學塞入同一個 HTML 頁面。互動模組使用平台預先設計的 <sk-*> 元件（完整規格由 get_module_kit 取得），不要自寫 CSS 與腳本樣板。科學章節使用元件庫內建的虛擬器材 <sk-lab>（拖曳、倒入、接線、讀刻度，邏輯與動畫已內建，不要自己畫 SVG）加實驗紀錄與檢核，不用一堆滑桿；數學章節講解後直接做題，不做實驗。\n${CHAPTER_FLOW}\n${POINTING_RULES}\n${COURSE_CLOSING}\n${ROUTING_CONVENTION}\n${PRETEST_RULES}\n${TEACH_FIRST_RULE}\n${SLIDE_QUESTION_RULE}\n${blueprintRequirement(blueprint)}\n${IB_REFERENCE_INSTRUCTIONS}`;
}

/** Why a plan cannot start, measured with the longest topic it may be given, or null when it fits. */
export function requirementProblem(blueprint: CourseBlueprint): string | null {
  const size = courseRequirement('字'.repeat(TOPIC_RESERVE_CHARS), blueprint).length;
  return size > MAX_COURSE_REQUIREMENT_CHARS ? `藍圖展開後的生成需求約 ${size} 字，超過官方單冊上限 ${MAX_COURSE_REQUIREMENT_CHARS} 字：拆成更小的分冊或精簡章節摘要（保留完整來源）` : null;
}
