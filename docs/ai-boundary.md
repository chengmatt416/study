# AI 邊界：MCP 預生成 vs OpenRouter 即時互動

STUDY 有兩條互不重疊的 AI 路徑。新功能先判斷歸屬，不得跨線。

## 規則

| | MCP（使用者的 chatbot） | OpenRouter（平台 key） |
|---|---|---|
| 職責 | 生成並保存內容：模擬試題、重點整理、字卡、互動課程大綱與教材（含各章的補強、精簡、延伸版本）、OpenMAIC 課堂的生成與編譯 | 課堂中的即時提問、老師或同儕討論、PBL 角色互動、學生點擊的簡答題 AI 覆核、依學習表現挑選下一步（結構化 JSON）、模考文字批改及混合複習解析 |
| 參考資料 | IB syllabus／guideline／mark scheme、課本 PDF、學期課綱 | 使用已生成的課堂教材、對應題目與評分規準，以及本次作答。 |
| 費用 | 使用者自己的 chatbot 訂閱 | 管理員的 OpenRouter key，受每分鐘、每日、全域 token 配額限制（語音轉文字經 Workers AI，同計次數配額） |
| 啟用 | 使用者連接 MCP 即可 | 管理員設定全域開關及配額。課堂須逐堂手動啟用（4 小時），模考與混合複習依學生點擊觸發 |
| 失敗時 | 任務等待 MCP 提交 | 互動功能關閉（fail closed），不退回 MCP，也不產生假回覆；路由改用免費規則 |

IB 參考文件的用途是讓 chatbot 在生成時核對範圍、教學規則與評分標準（見 `ib-resources.md`）。學生在課堂提問時，需要的評分細節應已由 chatbot 寫進課堂教材，live 模型只引用該教材。

`route` 不寫教材，只在教材已有的選項中挑選（見 [adaptive-learning.md](adaptive-learning.md)）。因此「更改接下來播放與解說詳盡程度」的內容仍然來自 MCP 預生成。

## 判斷準則

新功能問三題：

1. 結果會被保存、重用或給其他學生看嗎？是 → MCP。
2. 需要引用整份文件（PDF、IB 文件）嗎？是 → MCP。
3. 是學生此刻等待的一次性回應，且上下文小（128 KiB 內）嗎？是 → 可考慮 OpenRouter，且須先在本文件新增 purpose。

## 範圍決定

- 2026-11-01：OpenRouter 只開放課堂。字卡、試題、筆記頁面不提供 OpenRouter 路徑。
- 2026-11-01：加入 `route`。所有 live 功能預設關閉，由學生逐課堂手動啟用；管理員用配額限制每日用量。逐人名單改為預設允許，管理員仍可停用個人。
- 允許的 purpose：`interaction`、`regrade`、`route`、`coach`、`practice_explain`、`exam_grade`，定義在 `src/shared/ai-boundary.ts`。簽章 grant 的 purpose 不在清單內即視為無效；`live_ai_turns.purpose` 也有相同的資料庫限制。
- live 模型的 system prompt 禁止生成整門課、模擬試題、筆記或字卡，也禁止引用 IB 參考文件。

## 程式端強制

`tests/ai-boundary.test.ts` 檢查：

- grant 只接受 `LIVE_AI_PURPOSES`。
- OpenRouter endpoint 只出現在 `shared/ai-boundary.ts` 與 `worker/lib/live-ai/service.ts`。
- `worker/mcp/`、IB 資源與書籍上傳模組不引用 OpenRouter 或 live AI。
- live AI 的 service、route、transport 不引用 IB 資源、書籍 PDF 或 MCP。
- 規則路由 `shared/adaptive-learning.ts` 保持純函式，不碰模型或資料庫。

這是原始碼層級的檢查，不能證明執行時一定不會越界；它的作用是讓日後的修改在越線時測試失敗。

## 新增 live 功能的步驟

1. 在本文件說明為何不能走 MCP。
2. 在 `LIVE_AI_PURPOSES` 加入 purpose，並新增一個 migration 更新 `live_ai_turns.purpose` 的 CHECK（SQLite 需重建表，參考 `0014_adaptive_learning.sql`，先刪子表避免連帶刪除）。更新 `tests/ai-boundary.test.ts`。
3. 經 `admitLiveAiTurn` 取得 grant，沿用既有配額與學生啟用檢查；不得另建直連 OpenRouter 的程式。


## 第三條路徑：內容判定（2026-11-09）

生成時判斷教材是否違反教學規則（投影片放題目、投影片要學生自己算、互動模組其實是說明頁、模組沒有由對話導覽），改由低成本模型判定，不再用寫死的字串規則。

| | 內容判定 |
|---|---|
| 職責 | 只回傳違規判定（JSON：哪一頁、違反哪條規則、理由），**不寫、不改任何教材** |
| 模型 | 與課堂 AI 相同的模型（`live_ai_config.model`，管理員在「課堂 AI」設定），不另外使用 Claude 或其他較貴的模型；`reasoning.effort: low`，要求 JSON schema（`response_format`，不支援的模型仍會回覆，伺服器自行驗證），`provider.data_collection: deny` |
| 金鑰 | 沿用管理員在「課堂 AI」設定的 OpenRouter key（`live_ai_config.encrypted_key`），不另設金鑰；不受課堂 AI 開關與學生逐堂啟用影響，因為不是學生的即時互動。沒有 key 或沒有設定模型時用固定規則 |
| purpose | `CONTENT_CHECK_PURPOSE = 'content_check'`（`src/shared/ai-boundary.ts`）；呼叫只在 `worker/lib/live-ai/service.ts` 的 `contentCheckCompletion` |
| 費用控制 | 一次檢查把所有投影片與模組放進同一個請求；判定以「內容＋模型」雜湊快取在 `content_judgments`（含 token 數），內容與模型沒變就不再呼叫 |
| 失敗時 | 沒有 key、HTTP 錯誤、非正常結束（例如 content_filter）、回覆格式不符：退回原本的固定規則，回應帶 `judge: "rules"` 與原因 |
| 使用點 | `validate_openmaic_core_step`（大綱與單張投影片草稿）、`check_openmaic_slides`、`check_openmaic_modules`、`update_openmaic_scene`、`submit_classroom_review`、發布 |

不需要判斷的事實仍在程式中檢查：「檢核：」必須是 quiz 場景、互動模組至少有一句對話。程式在 `src/worker/lib/content-judge.ts`，測試在 `tests/generation-reviews.test.ts`（模擬 OpenRouter）。

這條路徑不違反上面的判斷準則：判定結果不是教材、不給學生看，也不讀 IB 文件或書架 PDF。

## 2026-11-17：學習教練（`coach`）

學生在課堂裡一再弄錯同一個地方時，教練解釋那一個觀念，並建議接下來怎麼走（繼續、回去看這章的講解、或看補強版）。完整行為見 [adaptive-learning.md](adaptive-learning.md) 的「學習教練」。

| | 內容 |
|---|---|
| purpose | `coach`（`src/shared/ai-boundary.ts`；遷移 `0040_classroom_coach.sql` 更新 `live_ai_turns.purpose` 的 CHECK） |
| 觀察與路由建議 | 純規則（`src/shared/learning-coach.ts`），讀已記錄的學習訊號，不呼叫模型，沒開課堂 AI 也有 |
| 解釋 | 一次模型呼叫，經 `admitLiveAiTurn` + `liveAiCompletion`，沿用課堂的每分鐘、每日、token、全站配額；輸出上限 900 tokens、20 秒 |
| 輸入 | 章節名稱、卡住的迷思 id 與次數、該章的作答統計與最近 12 筆訊號、課堂送來的該章講解文字（已生成的課堂教材，最多 6,000 字，當作資料，不依其中的指示行事） |
| 輸出 | 只給該學生看的一則短訊（一句重點、兩到四句解釋、一個自我檢查的問題、建議路徑），存在 `classroom_coach_notes`；不寫進課堂教材，不給其他學生 |
| 啟用 | 與其他課堂 live 功能相同：全域開關、個人未被停用、學生在這堂課手動啟用 AI |
| 費用控制 | 同一個學生、同一堂課、同一個卡住的地方只呼叫一次（結果存檔，重開課堂讀回）；回覆不能用也不重試；每堂課每天最多 6 則模型解釋；解釋過後還是錯，改用規則請學生回去看講解，不再呼叫模型 |
| 失敗時 | 沒有 key、沒啟用、配額用完、逾時或回覆格式不符：回規則版的短訊（指出重複的錯誤與建議路徑，不解釋觀念） |

### 為何不能走 MCP

要解釋哪個觀念，取決於這個學生此刻在這堂課一再犯的錯，生成課程時無法預知；結果只給本人、不保存成教材、不引用 IB 文件或整本課本（判斷準則第 1、2 題皆否，第 3 題為是）。課程裡針對常見迷思的補強內容仍由 MCP 預先生成（〔補強〕版），教練只在學生卡住的當下補一句針對性的說明，並把學生導回那些預先生成的內容。

## 模考文字批改與混合複習解析

- `exam_grade`：不限時練習的開放題可送文字作答、該題及相關評分規準。客觀題由伺服器直接計分，學生可要求 AI 複核，複核建議與原判分並列。
- `practice_explain`：混合複習的解析按鈕送出該題、作答與參考解答，回傳 Markdown 說明。
- 兩者都由學生點擊觸發，沿用管理員設定的文字模型、全域開關、個人權限及配額。
