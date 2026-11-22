# 完整 OpenMAIC core + STUDY MCP transport

本整合執行 **THU-MAIC/OpenMAIC 完整應用**，固定版本與 commit 記於 `core.lock.json`。不是以官方格式命名的自製 renderer，也不是只引入 slide SDK。原始碼、Next 課堂、Pi 代理迴圈、生成 runner、原生場景 builder、DSL/編譯與匯出、renderer/editor、互動工具、白板及儲存套件全部沿用官方程式。

在模型解析、身分驗證、等待期限與續接脈絡增加有邊界的修改；完整官方啟動序列獨立放進 Node instrumentation 模組，避免 Edge 重複編譯 Node／PostgreSQL 依賴。其他原始碼保留。Workers 完整 checkout 與 build 產物位於 gitignored `.openmaic/worker-core`；乾淨環境可由鎖定版本重建，overlay 與安裝腳本皆納入本專案。

## 模型呼叫如何改成 MCP

官方 `resolveModel` 在 MCP 模式回傳 `LanguageModelV3` transport。`generateText`、`streamText` 及 Pi 的 tool loop 繼續使用官方實作。

- 每個實際模型回合的完整 `prompt`、`tools`、`toolChoice`、`responseFormat` 成為 PostgreSQL 的持久化任務。
- 外部 chatbot 呼叫 STUDY MCP，提交 `output.text` 與可選 `output.tool_calls`。工具名與參數仍由官方 AI SDK 驗證，工具仍由官方核心執行，不把工具呼叫交給外部 chatbot 私自執行。
- 文字及工具結果回到官方流程，核心再產生下一個回合。場景依官方生成管線產生、驗證與儲存，沒有縮減成 STUDY 的 interactive/quiz 子集。
- 以 owner、run、prompt fingerprint 與回合序號做續接。程序結束後 pending 任務仍存在，官方 runner 的租約接管及 checkpoint 繼續有效；已提交回應可重播。回應使用 `expected_version`，不接受重複或過期提交。
- 官方步驟等待 MCP 時取消模型 API 使用的短 deadline，仍遵守 runner 的中止與租約訊號。不是用 HTTP 逾時來假裝可續接。
- 完成的課程只在 STUDY 存原生 `classroom_id` 指標；播放時以短效簽章換取官方應用 session，直接進入完整官方課堂。
- 課堂從 STUDY 同一網域的 `/classroom/:id` 開啟；原生 API、Next 靜態資源與編輯器由 STUDY Worker 透過 service binding 串流至 Core。STUDY 登入與 OAuth 憑證不轉送，僅轉送獨立的課堂 session cookie，寫入另檢查同源 Origin。
- 教學採點擊對話逐句繼續，保留原生白板／視覺動作順序，不啟動預製音訊、瀏覽器 TTS 或自動閱讀計時；每節結束由學習者選擇下一節。公式與程式碼保留整體，不在中途切句。完整說明可展開，原生討論區可另外開啟，討論的模型回合仍需外部 chatbot 接續。
- 共用 STUDY 根目錄的 `/sw.js`，快取 `/_next/static/` 的公開編譯資產；課堂 HTML、RSC 與 API 即時連線，不儲存私人課程回應，也不回退成 STUDY SPA。進入課堂前啟用 SW 路由更新，避免舊 SW 攔截 Next 頁面。
- 具有 viewport meta 與寬度 media query 的互動教材，在窄畫面使用實際 iframe 尺寸，讓響應式排版及觸控目標生效；舊固定畫布維持原生比例。切換尺寸只更新原 iframe 樣式，不重新載入或清空互動狀態。
- 教材、教學對話、簡報、互動、PBL 與編輯器生成維持 MCP。只有 STUDY 原生課堂的提問／討論 `/api/chat/pi` 及 PBL instructor／simulator／evaluate／open-task 即時路由可取得短效即時權限，使用管理員指定的 OpenRouter 工具模型；題目上的「請 AI 覆核」另走明確授權的即時評分代理。兩者均不會把 API key 傳給 Core 或瀏覽器。未配置／未獲授權時仍可閱讀、互動與系統批改，不會自動改用付費 API 生成課程。

MCP 模式不啟用需要外部模型 API 的影像、影片、伺服器語音與搜尋生成。可使用教材資產、自足 HTML/SVG 與原生課堂工具。這是能力未配置，不代表官方程式碼被刪除。正式部署改用完整 Next.js 核心的 OpenNext Workers 建置，PostgreSQL 語意由另一個 Worker 的 WASM 引擎提供，資料頁寫入 Durable Object SQLite，資產寫入 R2。

## Workers 建置與部署

需要 Node.js 24、pnpm 10.28.0 與 Cloudflare 帳號。先部署 STUDY 主程式，並為 Core、Database、Jobs、Parser 選擇自己的 Worker 名稱。若變更預設命名，請一起更新各設定檔內的 service bindings 和 R2 bucket。部署及驗證前，請設定自己的 HTTPS 網址到 `OPENMAIC_WORKERS_ORIGIN` 與 `OPENMAIC_DATABASE_ORIGIN`。

```sh
npm run openmaic:setup
npm run openmaic:build
npm run openmaic:deploy
npm run openmaic:connect
npm run openmaic:workers:verify
```

首次部署至尚未建立核心服務的帳號，部署命令加上 `-- --bootstrap`，先建立不含 cron／核心連線的排程 namespace，再部署核心並接上排程器；後續使用一般部署命令。

完整官方原始碼固定於 `core.lock.json`，Workers checkout 在 gitignored `.openmaic/worker-core`。`integrations/openmaic/cloudflare/overlay` 與 `scripts/openmaic-workers.mjs` 是可重建的主機適配來源；不要直接維護 generated checkout。套件版本及 pnpm lock 均鎖定。

`build` 先獨立檢查完整核心的 TypeScript，再建置 Next/OpenNext 與解析器。`deploy` 先部署資料庫並驗證 JSONB、trigger、rollback、advisory lock 與跨部署持久化，再部署私有解析器、獨立排程器及完整核心；`connect` 先確認核心、資料庫讀取與簽章驗證可用，才連接及重新部署 STUDY。Cloudflare secrets 位於 gitignored 私人檔案，權限 0600；腳本僅更新核心 transport secrets，保留既有 Google OAuth 與 session secrets。

`cloudflare/build.workflow.yml` 提供不含部署憑證的 GitHub Actions 建置流程，可用於記憶體有限的開發機。產物包含完整 OpenNext 應用、私有解析器及驗證標記；下載後需核對標記的 `sourceRevision` 與 CI commit。正式 transport 與加密 secrets 僅在部署時注入，不進入建置產物。

## MCP 工作流程

1. `get_openmaic_core_status` 檢查 `engine=OpenMAIC`、版本及 `transport=study-mcp/v1`。
2. `start_openmaic_classroom(note_slug,topic)` 將筆記來源以原生 material 上傳，啟動官方 generation run。
3. 重複 `get_openmaic_core_step(generation_id)`；按官方原始任務逐一呼叫 `submit_openmaic_core_step(task_id,expected_version,output)`。沒有 pending 回合時讀取最新 run 狀態再輪詢，不自行宣告完成。
4. 暫停對話後 `list_openmaic_classrooms` 找回作業。原生課堂中的模型回合可省略 generation_id 讀取自己的待辦。
5. 若官方回報 paused，可用 `retry_openmaic_classroom` 與穩定 `command_id` 續接失敗步驟；重試使用新的 MCP 回合 epoch，不重播之前的錯誤回應。
6. 僅在官方 `status=succeeded` 後 `publish_openmaic_classroom`，檢查原始筆記修訂與 STUDY 課程版本後連結至筆記。

STUDY 依序讀取作業與待答任務，避免同一輪輪詢重疊啟動完整 Next 核心。連線逾時回報 503，與無法連線的 502 分開；不自動重送可能已完成的寫入。原生成 ID 與版本化 MCP 任務保留，讀取失敗後沿用原 ID 查詢即可。2026-11-01 修正 Core 執行位置後，從美東透過實際 service binding 連續三次讀取同一既有作業與任務均為 200，合計耗時約 9.9–14.0 秒；驗證沒有提交模型回應或發布課堂。

新 `start_course_generation` 為原生起點的別名。舊修訂工具與 REST 格式只維護歷史資料；新的 UI 與提示不使用相容子集建立課程。core 未配置時回報明確錯誤，不自動換成舊播放器。

## 雲端執行架構

- STUDY Worker 保留 OAuth、筆記 ACL、段考範圍編輯、MCP 工具與原生 classroom 指標，透過私有 service binding 呼叫完整核心。
- Core Worker 以 OpenNext 執行完整官方 Next.js 課堂、renderer/editor、生成、編譯及 Pi 工具迴圈。外層 Worker 執行簽章驗證，關閉匿名 fallback。
- Core 的執行位置設定為 `aws:us-west-1`，鄰近目前 `primary-v1` 資料庫所在的 SJC，避免每次初始化的 SQL 跨洲往返。搬遷資料庫時，先以受管理員簽章保護的 Database Worker `GET /internal/placement` 量測主要物件的出口位置，再調整 Core placement；此端點只回傳 Cloudflare 機房，不提供資料或任意 SQL。
- Jobs Worker 的 CoreCoordinator Durable Object 使用 alarm，透過簽章與私有 service binding 啟動完整核心中的官方 runner；排程器不載入 Next.js。遇到待答 MCP 回合時，使用原本的 interruption/checkpoint 機制釋放執行；回應提交後於背景喚醒並續接，cron 提供恢復。等待模型時不需要常駐 Mac 程序。核心保留未綁定的 v1 namespace 匯出，避免清除舊狀態；新工作全部使用獨立排程器。
- Database Worker 以 PGlite PostgreSQL WASM 執行原本 SQL 與 PL/pgSQL；同步檔案頁寫入 Durable Object SQLite。虛擬 pg 連線保留 transaction、session advisory lock 與 SQLSTATE。交易序列化，advisory lock 僅排斥相同鍵的其他連線，並不阻塞一般 SQL 或不同鎖鍵。儲存不依賴外部 PostgreSQL。
- Parser Worker 透過私有 service binding 執行官方 Markdown/HTML 圖片及 PPTX 解析演算法，取代 Node worker threads；DOM 與 Next SSR 隔離，輸入有大小限制。
- 教材、資產與課堂媒體使用 R2，使用量紀錄存 PostgreSQL。原生影像處理改用 Cloudflare Images，PDF raw pixels 使用純 JS PNG 編碼。官方內建 skills、prompts 與模板隨部署封裝，需要讀取它們的請求及 alarm 會準備各自的暫存檔案；使用者資料不放在暫存檔案系統。

PGlite 固定為 0.3.16。準備腳本將其強制命令列 shared buffer 設為 8MB，驗證靜態 WASM 並記錄原始／部署 SHA-256；JS callback 與 PL/pgSQL 均預先編譯，避免 Workers 禁止的執行時 WASM 編譯。

## 驗證

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run build
npm run openmaic:test
# 加上獨立測試資料庫，測試持久化、owner/版本隔離與程序續接
PG_CONTRACT_URL=postgres://openmaic:openmaic-dev@127.0.0.1:55432/openmaic npm run openmaic:test
npm run openmaic:build
# Workers 主機適配與 PostgreSQL/WASM 合約
npm run openmaic:workers:contract
npm run openmaic:workers:test
npm run openmaic:workers:verify
```

核心整合測試直接執行官方場景生成器、builder、DSL validator 與 Pi 工具迴圈；資料庫測試使用獨立 schema 驗證版本比對、owner 隔離、重播、中止與重試 epoch。測試不連接模型 API。

舊 Node 開發版本的端到端驗證曾以 8 輪 MCP 回應建立包含 `slide / interactive / quiz` 的原生課堂，官方 run 回報 `succeeded`，三個已持久化場景都通過官方 DSL。瀏覽器驗證涵蓋原生課堂載入、模擬數值更新、詳解展開、動畫開始與重設，以及測驗作答、滿分結果與儲存；無頁面錯誤。正式建置採上游預設的 Turbopack。

設定 `OPENMAIC_WORKERS_ORIGIN` 後可用 `npm run openmaic:smoke -- status` 檢查自己的 Core Worker。`start`、`task`、`submit <output.json>`、`job` 可在獨立 `study:workers-smoke` 測試帳號逐步驗證真實原生生成，結果記於 `.openmaic/qa/workers`。它不使用模型 API，也不會建立使用者的正式教材。需要對照舊 Node 開發版本時，明確加上 `--node`，才會讀取開發環境並連線本機；不會啟動服務。

上游：[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)，MIT 授權。[上游授權文字](LICENSE.upstream)

## 課堂即時 AI 與評分

管理後台的「課堂 AI」可設定 OpenRouter 模型、加密儲存 key、全站開關及逐人權限／配額。部署前套用 `0012_live_class_ai.sql`，並以 Wrangler secret 設定獨立的 `LIVE_AI_ENCRYPTION_KEY`（32 bytes 隨機值的 64 位 hex）。不要重設此 secret，否則原本的密文將無法解密；要輪替時需先重新加密 key。僅 Root Worker 持有此 secret，Core 只透過 `STUDY_LIVE_AI` service binding 傳送短效簽章權限。

每位學生預設不啟用 AI，須在該課堂手動啟用（4 小時，可關閉），管理員可對個人停用。預設配額為每分鐘 4 次、每日 40 次提問、每日 200,000 token；全站每日 1,000 次／5,000,000 token，每次提問至多 6 次模型呼叫、每次輸出上限預設 4,096 token（管理員可調到 32,768，不能低於 4,096），供應商逾時 120 秒。每日以 UTC 重置。每次呼叫重新查驗 allowlist、群組與個人開關；D1 原子預留額度避免同時呼叫超用。失敗不自動重送，未知用量保留預留額度。另可在 OpenRouter 設定 key 的信用額度上限。

選擇、數值、布林及一致的短答案先由系統批改；無法確定的推理題標為待覆核且不計入畫面總分。學生明確要求後才呼叫 AI，成功才保存新版評分，失敗保留原結果。公式欄位附分數／根號／次方等鍵盤。課堂載入提供階段與等待時間、版面骨架、準備問題，以及等待較久時的重試／返回入口，支援減少動態效果；不用假百分比或重複觸發生成。

完整差異、停用能力與尚未證實的相容性，見 [Workers 相容性清單](../../docs/openmaic-workers-compatibility.md)。

未配置 API key 時，課堂提問、圓桌／教師先發起的討論、AI 覆核及 PBL 即時互動一律自動停用。共享狀態預設關閉，確認可用後才啟用；回到視窗與每 30 秒會重新檢查，每次送出前及每個模型呼叫仍由伺服器重驗。缺少／無法解密 key、全站關閉或個人未授權都會顯示原因，不回傳模擬 AI 對話，也不把即時請求轉成待答 MCP 作業。沒有 API 時跳過原生 proactive 討論提示，逐句教材可繼續，PBL 顯示已儲存的專題與里程碑資料。

教師先開口的討論允許原生空 messages 加 discussionTopic 的請求；使用者加入後，由完整 Pi 迴圈透過 OpenRouter 產生即時內容。PBL 的四個 runtime 階段也使用相同受限代理，生成／編輯／編譯階段仍為 MCP。
