# OpenMAIC 互動課程

新的課程生成、編譯與課堂執行改用完整官方 OpenMAIC core，模型呼叫改為可持久化、可跨對話續接的 MCP transport。完整設定、原理、官方版本與操作見 [完整 core 整合](../integrations/openmaic/README.md)。

新工作流程為 `get_openmaic_core_status → start_openmaic_classroom → get_openmaic_core_step / submit_openmaic_core_step → publish_openmaic_classroom`。STUDY 保存原生課堂指標，開課時直接進入官方完整課堂。未設定 core 時明確回報錯誤，不回退自製相容播放器。

以下保留的是歷史相容課程的資料格式及修訂規則；它不代表新的核心實作。

## 超長課程與提交前覆核

官方核心每次生成最多 100 個場景、512 KB 的 outline JSON，來源只讀前 50,000 字元。新入口會拒絕超過 45,000 字元的單冊來源，避免靜默截斷。整門大型課程使用 `create_long_course → add_long_course_part → start_long_course_part`，以既有筆記作權限入口。每冊儲存完整來源與經驗證的獨立藍圖，各自走原生官方生成、編譯、投影片檢查、藍圖對齊與發布。分冊發布不覆蓋筆記原有課堂，也不受筆記之後的修訂影響，因為分冊依自己儲存的來源生成；筆記的課程頁列出各冊並可開課。

總課程最多 10,000 冊；每冊來源上限 45,000 字元，整體可涵蓋數百萬字與數千場景，實際仍受 D1 容量與官方生成限制。來源依語意及先備順序分冊，不能用省略教材來規避限制。同 `part_key` 與相同內容的新增重試會取得原冊；不同內容回傳衝突。啟動回傳既有 `generation_id`，不重建已啟動冊。來源與藍圖儲存於逐冊資料列，清單只讀分頁摘要，全文另外分段讀取，不要求整個課程同時留在上下文。

模型回合用 `get_openmaic_core_step(summary=true)` 讀取摘要，再以 `get_openmaic_core_task_context` 按 `next_offset` 讀到 `null`，保留完整官方 prompt、工具 schema 與 response format。單次 context 最多 24 MB、每頁最多 24,000 Unicode codepoints；依伺服器回傳的 `offset_unit` 與 `next_offset` 續讀，不自行用 UTF-16 長度推算。任務與清單都按 owner 及重試 epoch 隔離；等待只讀 response，避免反覆傳輸整個 request。

新任務的 `output.verification` 必填：`request_sha256` 必須匹配任務，`checks` 對 `source_accuracy/schema/teaching/interaction/accessibility` 各提供一筆 20–2,000 字元的具體證據，`remaining_issues` 必須是空陣列。生成者先規劃、草擬、檢查並修正，再提交可查核的精簡證據；不提交內部思考、不虛報未做的瀏覽器或科學測試。伺服器額外拒絕未宣告的工具及不合法的必要 JSON；失敗不消耗 task version。既有待答與已答任務保持可續接。這是自我覆核紀錄，並非平台保證生成內容正確。

### 分冊的規模與修正

每冊的場景數由官方的 100 個上限決定。一章的教學可以分成多張（`章名｜小節`），所以一冊能放的教學頁遠多於章數；每章固定還有先測、檢核、補強、精簡四個場景。規則見 [module-kit.md](module-kit.md)。

藍圖展開後的生成需求上限是 19,800 字（官方 20,000，保留給分冊標記）。`validate_course_blueprint`、`add_long_course_part` 與 `update_long_course_part` 都用同一個 `requirementProblem` 計算，超限當場拒絕，不會等到開始生成才失敗。IB 文件清單不放進需求，文件再多也不佔預算。

分冊建立後可以修正：

| 情況 | 工具 | 結果 |
|---|---|---|
| 尚未開始生成，內容要改 | `update_long_course_part` | 重新檢查藍圖後更新；已開始的冊回傳 409 |
| 順序錯了 | `move_long_course_part` | 移到指定位置，其他冊遞移，位置保持連續 |
| 生成方向錯了或卡住 | `reset_long_course_part` | 結束 run、釋放同時生成的名額、清掉它的任務；已發布的課堂在新版發布前繼續開放 |
| 課堂完成但檢查沒過 | `get_openmaic_scenes`、`update_openmaic_scene` | 只改有問題的場景，回傳還剩哪些問題 |
| 使用者明確要求刪除 | `delete_long_course_part`、`delete_long_course` | 永久刪除來源與課堂（課堂在 Core 是墓碑，不再能開啟） |

重新生成用 `generation_attempt` 組出新的分冊鍵（`<part_id>:<attempt>`），Core 每個鍵只保留一個 run，所以舊 run 不會被誤認，重試也不會重複建立。被放棄的 run 會從 `openmaic_core_runs` 移除，之後不能再發布。

部署順序：先部署 Core（路由、`DELETE /api/study-mcp/runs/:id/tasks`），再套用 `0027_long_course_part_attempts.sql`，最後部署 STUDY。STUDY 先上線時，清任務的呼叫會失敗但不影響重置，只是舊任務還留著。

## 超長模型回合與草稿預檢

模型 context 首次讀取時會一次建立 canonical JSON 的不可變分塊快取；之後每頁只讀取至多三個有索引的小塊，避免為每一頁重新序列化數 MB 的 JSONB。每塊 24,000 Unicode codepoints，任意 offset 與跨塊讀取可精確重組原文與 SHA-256。快取增加一份來源文字儲存，隨 task 刪除級聯清除；不會主動替所有舊任務回填。task cursor 保存 PostgreSQL 的微秒精度，避免毫秒截斷造成重複翻頁或無限迴圈。

新任務的逐步流程是：完整讀取 → 在心中規劃 → 草擬 → 以獨立審查者角度重新計算／核對 → 修正 → `validate_openmaic_core_step` → `submit_openmaic_core_step`。覆核仍以引用、計算、教學順序、互動邊界與手機／鍵盤等具體證據記錄，不提供內部思考過程，也不虛報未執行的測試。

預檢檢查官方 JSON response schema、工具參數 schema、允許工具與 toolChoice，以及完整自我覆核證據。它不執行工具、不增加 task version。成功才保存該草稿與 `validation_receipt`；失敗回傳可修正的錯誤，任務保持待答。提交只傳 `task_id`、`expected_version`、`validation_receipt`，省略 `output`，由伺服器原子提交儲存的同一稿，節省大型教材第二次輸出與傳輸。修改稿件／工具呼叫／覆核紀錄後必須重新預檢；舊版待答任務仍可沿用完整 output 提交。憑證與 owner、version、重試 epoch 隔離，並行預檢產生的新稿會取代上一稿憑證。

所有提交仍在核心執行工具與場景驗證之前經過這一層。schema／憑證驗證不代表科學或教學內容必然正確，後者仍須生成者獨立覆核；官方生成、編譯、投影片與藍圖發布檢查維持原有責任。

## 教材資料庫、資料夾與封存

`/content` 統一搜尋、排序、分頁瀏覽筆記／互動課堂、試卷、電子書、手冊、課綱與字卡。可建立巢狀資料夾、移動、重新命名、收藏，亦可選取多份教材批次移動或封存。封存及資料夾只影響自己的整理方式，不改變共享教材或原本權限；封存與垃圾桶分開，隨時可在「已封存」取消封存。一般教材清單隱藏自己的封存項目，直接連結仍依原本權限存取。

MCP 提供 `list_content/list_content_folders/create_content_folder/update_content_folder/delete_content_folder/organize_content`。清單只回傳中繼資料；批次每次最多 100 份，全部檢查通過才寫入。只能刪除空資料夾，教材不會跟著刪除。部署前套用 `0023_content_organization.sql`、`0024_long_courses.sql` 與 `0025_long_course_source_counts.sql`。總字數使用逐冊保存的字元計數與 covering index，不為分頁清單重讀整套教材原文。原生分冊啟動以 owner／part 的唯一索引及持久化 marker 續接，逾時或回應遺失時找回原作業。

## 中斷恢復與長時間學習（2026-11-05）

預檢成功後即使對話中斷，任務摘要與 context 中繼資料仍會回傳目前待答任務的 `validation_receipt` 與 `next_action`。新代理可直接以原 task id、version、receipt 提交已儲存的同一稿，不必重寫大型教材。已答、其他 owner 或舊 retry epoch 不提供可提交憑證。新稿預檢失敗會使舊稿失效；revision 條件更新避免慢速或失敗的並行預檢覆蓋較新的審查結果。

分冊來源與任務 context 的 `offset_unit` 都是 `unicode_codepoints`，依伺服器 `next_offset` 續讀，不使用 JavaScript UTF-16 長度自行計算；即使頁面邊界遇到 emoji 也可完整還原。清單與中繼資料不攜帶已預檢草稿全文。

顯示中的課堂每五分鐘更新一次仍有效的登入，伺服器重新確認帳號權限與課堂身分；不接受已過期的票證，背景分頁不延長登入。切換頁面會取消未完成的更新。登入到期顯示返回 STUDY 的入口。學習進度的未同步變更以帳號及課堂隔離保存在本機，失敗會序列重試，重新整理後可接續；伺服器拒絕另一帳號或課堂的更新，避免多個分頁互相寫錯進度。

一般課堂與分冊共用可取消的啟動流程，包含連線、準備教材及重試狀態；取消、換分頁或離開筆記後，遲到的回應不能再次導向課堂。分冊載入失敗保留已讀清單並提供重試。桌面及手機的測驗亦補上載入重試、交卷失敗恢復、完整作答判斷及對話框鍵盤焦點管理。

重新開啟原生測驗報告會恢復「下一節」狀態，不重送先測或檢核訊號；重新答題期間清除完成標記，重試失敗才恢復原報告。

## 歷史相容資料的生成流程

以下記錄舊版本的相容草稿流程；新版 `start_course_generation` 已是官方 core 的起點別名，請使用文件開頭的新流程。

舊版本使用者在重點整理複製課程生成指令，貼到已連接 STUDY MCP 的 chatbot。MCP 逐步回傳任務、教材與 JSON Schema；chatbot 生成當前步驟的內容，再提交給 MCP。產品不提供預製範例。

1. `get_openmaic_guide` 取得工作流程，`study_overview` / `get_document` 找到筆記；不要為新主題另建重點整理，請使用者指定既有的來源筆記。
2. `start_course_generation` 建立草稿並固定來源筆記修訂與目前課程版本。
3. 按回傳的 `task` / `input_schema` 產生 `output`，以 `submit_course_generation_step` 提交最新 `expected_version`。
4. 伺服器依序要求課程規劃、逐個互動模組、至少 3 題測驗與整體審查。模組數量沒有固定上限，仍受總內容大小限制。格式錯誤不推進步驟；修正既有內容使用 `revise_course_generation`，並重新審查。
5. `step=publish` 後呼叫 `publish_course_generation`，原子寫入課程與已發布狀態，取得課程網址。

中斷後以 `list_course_generations` 找草稿，`get_course_generation_step` 恢復。草稿限建立者存取；寫入工具需要 `study:write`。來源筆記或成品版本改變時回傳衝突，須檢查最新內容再重新開始，避免覆蓋其他人的修改。

## 學習流程

新生成的課程標記 `learning_design: "mastery/v1"`，採診斷先測、認知負荷分段、示範與鷹架、提取練習及精熟學習的順序。

1. 課程開始先逐題先測，可選「還不會」。每章的 `pretest` 在規劃時生成，只接受有正解與完整解析的單選／複選。
2. 從最早未掌握的章節開始，保留後續章節的先備順序；不以總分掩蓋弱點。全部掌握則進入最終遷移檢核，也可選擇從頭完整學習。
3. 每章先播放至少兩步 `teaching_steps`，一次只講一個概念或示範步驟。`body_md` 為主線，`explanation_md` 在點擊「不懂，拆開說明」後展開更細的推理、例子與誤解澄清；可返回上一步。
4. 完成教學後才載入隔離的互動 HTML，依真實事件推進 `lesson_steps`。
5. 完成互動後才進入獨立 `checkpoint`；所有題目答對才能進下一章。答錯顯示解析、重試與重新學習入口。先測與檢核不可使用相同題目或 id。
6. 最後以應用／遷移題檢核整體理解。簡答必須逐項比對參考答案與解析後自行確認，平台不宣稱自動評分。

播放器不提供任意跳往未完成章節的模組選單。章節與題目轉場、進度指示、詳解展開及完成符號使用一致節奏；新閱讀內容接續鍵盤焦點，減少動態偏好時立即呈現。學習進度目前只保留於本次頁面工作階段，重新整理後重新先測。

舊成品及原生離線 HTML 仍可使用舊播放器，但沒有新增教學資料，須重新生成才能啟用上述流程。缺少先測的舊草稿回到規劃；重新提交規劃會重建章節、測驗及審查。已具先測、但缺少新教學或檢核的草稿會要求修訂章節，才能發布。

## 章節與檢查

每個模組包含學習目標、依概念選擇的操控、建構、比較、診斷、排序或探索任務、可調控制項、圖像與數值回饋、重設、反思。要求生成者檢查公式、單位、邊界值、手機、鍵盤與減少動態效果。測驗包含解析；單選與複選由播放器比對正解，簡答提供參考答案供自行檢核。

每一步都回傳 `study-monochrome/v5` 的 `design_brief` 與 `content_brief`：黑白灰主色、一致排版與充足留白，可加入低強度白/灰局部光暈，避免霓虹、彩色漸層與模糊文字。同一模組可混合 sans/serif/mono 字型、字級、灰階字色、對齊與上方／側邊／下方文字位置。檢查 360/768/1280px 版面與對比，教學內容必須有來源、逐步推理、誤解說明及遷移應用。

`motion_brief` 與網站共用動態規則：控制項回饋約 160ms、指令轉場約 260ms、教材揭露約 460ms、場景切換約 380ms，交錯延遲上限 160ms。同一事件依序連動控制、指令、相關教材及進度；這些時間只影響呈現，不推進教學或阻擋操作。頁面、清單與課程切換採同一種減速節奏，不模糊文字。側欄自開場保留位置，避免新教材讓畫布忽然縮窄。

模組與最終審查都必須提交 `polish_pass`：至少記錄動態、教學內容、版面/字體三類初稿問題、具體修正與證據；每個事件驅動步驟的 `event_choreography` 描述控制回饋、指令轉換及其他區域連動。伺服器檢查欄位、類別與模組步驟覆蓋；審美、內容及動作是否恰當仍由生成者據實檢閱，不代表平台替生成內容執行過瀏覽器測試。

生成模組須包含 `lesson_steps`。第一步在使用者完成逐步教學並進入本章互動練習後顯示；其餘每步的 `reveal_on` 指定真實互動事件與 CSS selector，可增加輸入值或鍵盤按鍵條件。平台在隔離 iframe 監聽 trusted events，一次手勢只推進一步，拒絕合成事件、跳步及重播。主教材 `blocks` 隨事件逐步解鎖，只有目前的 `instruction_md` 顯示，並以尊重減少動態效果的轉場呈現。

HTML 內的教材區塊使用 `data-lesson-content="步驟id"`，操作說明使用 `data-lesson-instruction="步驟id"`；平台控制它們的隱藏與轉場。未標記的模擬畫布可保持顯示，教材與解析不得一次傾倒。發布後生成指令與匯入管理預設收起，可由「更新或管理課程」再次開啟。舊課程可繼續播放，需重新生成才具備新的事件流程。

模組與最終審查的 `quality_review` 必須對教學、正確性、互動、美學、無障礙五項各給出至少 4/5 分，並附至少 30 字的具體證據；不足先修正，不得虛報過關。最終 `objective_coverage` 必須逐一連結所有學習目標與存在的模組 id / 題號。生成的測驗解析至少 30 字，簡答必須有參考答案。舊草稿未含這套審查時會回到審查步驟，須補修模組後才能發布。

伺服器驗證結構、步驟順序、版本、大小與答案一致性。生成者提交的 `checks` 是自我審查紀錄，並非平台執行過瀏覽器或科學正確性測試。

HTML 在僅授予 `allow-scripts` 的 iframe 執行，不授予 `allow-same-origin`；CSP 禁止網路連線與外部資源。所有程式、樣式與圖像須內嵌。草稿／課程 JSON 上限 950 KB（UTF-8），單一 HTML 上限 800,000 字元；過大應拆課。

也可匯入 OpenMAIC 的單檔離線 HTML，或只含自足 `interactive` / `quiz` 的原生 `manifest.json`。原生 `slide` / `pbl` 須先在 OpenMAIC 匯出成離線 HTML；線上多代理對話與語音服務仍由 OpenMAIC 自身的模型設定提供。歷史播放器本身不包含官方伺服器；新整合改為獨立運行完整 core。

## 資料庫與驗證

新增 `0004_note_courses.sql` 與 `0005_course_generations.sql`，分別儲存成品與可續接草稿。均跟隨筆記永久刪除而級聯清除。

本機套用 `npm run db:migrate:local`；正式環境須在部署前執行 `npm run db:migrate:remote`。現有 OAuth、D1 與 Worker 設定即可，不需新增 binding 或依賴。

驗證使用 `npm test`、`npm run typecheck` 與 `npm run build`。測試涵蓋狀態機、SQLite 遷移／路由、權限與衝突，以及經 MCP 協定完成從規劃到發布的整條工具鏈。

新版不再把預測設為固定流程。每個模組須提交 interaction_design：真實主要控制、SVG/Canvas/語意 figure 概念圖、可觀察學習產出、構圖層次及 idle/active/settled/reset 四態動畫。驗證會核對控制與圖形 id、事件綁定；教學與視覺品質仍須生成者據實檢閱。既有課程不會被自動改寫，重新生成或修訂才套用新版規範。

## 原生課堂即時互動

新版課堂以 MCP 預先生成教材與呈現，只在學生主動提問或要求 AI 覆核時使用管理員設定的 OpenRouter 代理。管理後台提供模型、加密 key、逐人停用與配額設定；預設關閉，學生須在課堂手動啟用該次 AI。自適應路由見 [adaptive-learning.md](adaptive-learning.md)。簡單題系統批改、推理題標為待覆核，公式欄位附簡易鍵盤。詳見 [完整整合說明](../integrations/openmaic/README.md#課堂即時-ai-與評分) 與 [Workers 相容性清單](openmaic-workers-compatibility.md)。

## MCP 段考範圍

`list_assessments` 讀取段考及各科範圍，`study_overview` 亦回傳相同資料。`update_assessment_scope` 需要 OAuth `study:write` 及管理員身分，並透過既有內部 API 與群組寫入限制執行。

傳入 `assessment_id`、`subject_id` 及至少一個 `coverage_md`／`has_exam`／`exam_date`。使用 `PUT /api/assessments/:id/scope/:subjectId` 原子更新單科，不取代其他科目或段考本身。省略的欄位保留，`coverage_md: ""` 清空範圍，`exam_date: null` 清空本科日期；科目尚未列入段考時新增。驗證科目／段考存在、範圍長度、日期與欄位型別。沒有新增 OAuth scope、資料庫遷移或依賴。

## 手機「提問與討論」

手機（寬度 700px 以下，或矮螢幕觸控）上，提問與討論是底部面板。官方圓桌的頭像欄在面板內被隱藏，所以文字輸入框改為常駐（`useStudyPhone` 判斷，送出後自動重新展開），不必先點頭像或訊息圖示才能輸入；語音按鈕在學習者版本本來就移除。答案泡泡不再被調暗，高度可到 40dvh 並可捲動；建議回覆在輸入框開啟時仍會顯示。面板用 `visualViewport` 量出鍵盤高度（`--study-kb`），升到鍵盤上方，輸入框不被遮住；進入面板時不自動彈出鍵盤，避免一開始就蓋住內容。工具列可橫向捲動，「停止討論」維持可點。桌面版維持官方版面。 手機面板沒有聚光效果：背後的遮罩只負責接收點擊（收起面板），不調暗、不模糊；輸入框與建議回覆不加光暈或陰影，也沒有模糊進場。

規則在 `patch-classroom.mjs`（Roundtable 補丁）、`overlay/lib/study-classroom/phone.ts` 與 `classroom.css`，測試在 `tests/classroom-mobile.test.ts`；Core 補丁已在原始碼上試跑通過，但尚未在真實手機上操作過完整課堂。

## 課堂測驗載入與快取

測驗開啟前原本要先讀一次學習者的作答狀態（經伺服器的 runtime store，含舊資料遷移與排隊中的寫入），期間只看得到載入畫面。現在 `StudyScenePrefetch` 在學生閱讀目前場景時，對接下來 3 個場景內的測驗預先讀取作答狀態並預載題目裡的圖片（`quiz-warm.ts`；`warm.ts` 的單次使用快取，2 分鐘過期、失敗不保留、同一測驗只讀一次）；`QuizView` 掛載時取用已暖好的結果，沒有才照常讀取，所以重做、返回或另一分頁寫入後都會讀到最新狀態。投影片圖片仍預載接下來 2 張。

圖片另外存進 Service Worker 的 `classroom-media` 快取（`/api/classroom-media/` 的 png／jpg／webp／gif／svg／avif，stale-while-revalidate，最多 300 張、7 天），重新進入課堂時先顯示已存的版本再於背景更新；成功回應才會存入。登出時會清掉這份快取。不快取影片與音訊（需要 Range 請求）。

測量：沒有在真實課堂量過前後秒數；已測的是快取語意、圖片探索與補丁套用。

## 手機優先的教材設計（給 chatbot）

`get_mobile_design_guide`（`src/shared/mobile-design-guide.ts`）告訴 chatbot 如何為手機設計：投影片會被手機閱讀器依閱讀順序重排成單欄（一張一件事、文字區塊短、有意義的資訊不放在裝飾元素、教師講述每句 80 字內、圖片 1280px 內且盡量小）、互動模組 375×480 一屏（3 到 4 個控制項、44px 觸控目標、不靠 hover／拖曳）、測驗題幹短、每題最多一張圖，以及交付前用 375×667 自查並在 `polish_pass` 寫出實際結果。MCP 說明、`get_openmaic_guide`、課程提示與模組元件庫指南都要求先讀它。這是對 chatbot 的要求，伺服器不會自動驗證或退回不合格的教材。

## 精簡版的「不懂這一步」

在〔精簡〕版場景按「不懂這一步」，不展開說明，而是前往同一章的標準教學場景（`quickDetourTarget`），把基礎觀念學完；標準教學結束後，主按鈕改成「回到精簡版」，按下（或按空白鍵）回到剛才的精簡場景再繼續，之後照原本的路由進入檢核。中途自己跳去別章，這個返回記錄就作廢。回到精簡版時該場景從頭開始，不保留原本的句子位置。這一步仍會記一次「提示」訊號，讓路由知道這章需要較多支援。

## 朗讀（瀏覽器 TTS，2026-11-09）

課堂下方的「朗讀」用瀏覽器內建的 speechSynthesis（不經伺服器、不用模型）。開啟後可選聲音（台灣中文優先）與速度，設定存在本機 `localStorage`。投影片上每句讀完自動接下一句，但讀完整頁不會自動換頁；互動模組與測驗只朗讀，要手動繼續。數學式轉成可唸的文字（`speakableText`）。程式在 `overlay/lib/study-classroom/tts.ts` 與 `StudyLessonDock.tsx`，需要 Core 重新建置。Core 的伺服器端語音合成維持停用。
