// What a chatbot must do so slides, interactive modules and quizzes work on a phone. The classroom player reflows slides
// for phones (integrations/openmaic/cloudflare/overlay/lib/study-classroom/slide-reflow.ts), so these rules are written
// around what that reflow keeps, drops and how it orders things.

export const MOBILE_DESIGN_SECTIONS = {
  slides: `## 手機版投影片
手機閱讀器不縮小 1000×562 畫布，而是把投影片內容依閱讀順序重排成單欄。所以每張投影片要同時有桌面版面與可重排的內容：
- 一張只講一件事：標題＋最多 3 個文字區塊；每塊不超過 2 句、約 60 字。內容多就拆成兩張，不要縮字。
- 閱讀順序就是元素由上到下、同列由左到右。把先看的放上面；不要依賴位置、顏色或動畫才懂（例如「如右圖」）。
- 標題用 textType=title，副標用 subtitle。頁首、頁尾、頁碼用 header／footer／partNumber，手機會自動略過。
- 裝飾形狀、線條、背景圖與無文字的圖形在手機上會被丟掉，不可承載意義；有意義的資訊一定要有文字。
- 公式用 latex 元素，不要截圖；圖片旁放一個文字區塊說明重點，不要把文字燒進圖片；表格最多 4 欄、6 列，超過就拆分；圖表要有一句文字結論。
- 教師講述（speech）每句不超過 80 字：手機上學生逐句點擊閱讀；聚光燈與雷射指向的元素必須是會出現在重排內容裡的文字、圖片、表格或公式。
- 圖片寬度控制在 1280px 內並盡量小於 150KB，同一張圖不要重複上傳；這會直接影響手機載入速度。`,
  modules: `## 手機版互動模組
- 一律用 get_module_kit 的 <sk-*> 元件，並含 <meta name="viewport" content="width=device-width,initial-scale=1">：有它，用元件庫的模組才會以真實手機寬度顯示，而不是縮小的固定畫布（元件庫已內建手機版面，不必自己寫 @media；沒用元件庫的舊模組才需要自己寫寬度 @media）。
- 375×480 一屏：操作頁只放一個 sk-lab 實驗桌（2 到 4 個器材）與它的操作按鈕，不需捲動就能操作；實驗紀錄與練習題放另一個 sk-tab，一題一屏。器材的拖曳都有點選加按鈕的替代。
- 觸控目標至少 44×44px、字級至少 16px；不可只靠 hover、右鍵、雙擊或拖曳：拖曳要有點選或 Enter 替代（點器材再點目的地）；提示不能只在 hover 出現。
- 不用固定像素寬度，不要橫向捲動；圖形放在 sk-split 的直接子層，手機上才會置頂。
- 一定有「重設」按鈕與清楚的回饋文字；不使用外部網路、字體或圖片（沙箱不允許）。`,
  quizzes: `## 手機版測驗
- 題幹最多 2 到 3 行，每個選項不超過約 40 字；長推導放進解析（analysis），不要放題幹。
- 每題最多一張圖，寬度 1280px 內、盡量小於 150KB；圖要用課堂媒體（classroom media），不要嵌入 base64。
- 公式用 LaTeX，不用圖片；選項順序固定、不用「以上皆是」這類要往回捲動比對的選項。
- 測驗場景放在教學之後的固定位置，播放器會在學生讀前兩張時預先載入下一個測驗的作答狀態與圖片。`,
  check: `## 交付前檢查
用 375×667 檢視每一張投影片、每個互動模組與每一題：沒有橫向捲動、文字不小於 16px、可點目標不小於 44px、主要操作不需要捲動、重排後的閱讀順序合理。在 verification 的 accessibility 證據（歷史相容草稿則是 polish_pass 的版面／字體項目）寫出你實際檢查的結果，不要只寫「已支援手機」。`,
} as const;

export type MobileDesignTopic = keyof typeof MOBILE_DESIGN_SECTIONS | "all";

export function mobileDesignGuide(topic: MobileDesignTopic = "all"): string {
  if (topic !== "all") return `${MOBILE_DESIGN_SECTIONS[topic]}\n\n${MOBILE_DESIGN_SECTIONS.check}`;
  return `# 手機優先的教材設計\n手機是主要裝置。每一張投影片、每個互動模組和每個測驗都要為手機設計，再確認桌面版也成立。\n\n${Object.values(MOBILE_DESIGN_SECTIONS).join("\n\n")}`;
}
