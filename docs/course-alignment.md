# 課程與模擬試題的對齊

目標：chatbot 透過 MCP 生成的課程和模擬試題，要對得上電子書、IB syllabus／guideline／mark scheme、學校課綱，並符合正常的學習曲線與教法。以前這只靠提示文字（「先讀 PDF」），現在由伺服器檢查。程式在 `src/shared/course-blueprint.ts`、`src/worker/lib/alignment.ts`。

## 課程：先寫藍圖，再生成，發布前比對

1. `get_openmaic_guide` 說明流程與格式。chatbot 用 `list_ib_resources`、`list_syllabi`、`list_books` 找文件，實際讀取要用的頁面，寫出 `blueprint`（schema `course-blueprint/v1`）。
2. `validate_course_blueprint` 檢查，不建立任何東西。`start_openmaic_classroom`（含別名 `start_course_generation`）**必須**附 `blueprint`，沒通過就不會開始生成（HTTP 422，附 `errors`）。
3. 通過的藍圖存進 `openmaic_core_runs.blueprint_json`，並以「課程藍圖」段落放進官方生成需求，所以官方大綱步驟看得到章節順序、每章新概念、學習目標（IB 大綱編號、指令詞、頁碼）、迷思與考試陷阱。
4. 生成完成後 `check_openmaic_alignment` 比對課堂場景和藍圖。**缺少章節教學、先測或檢核場景，或章節順序與藍圖不同，會阻擋 `publish_openmaic_classroom`**（422）。其餘只是建議，發布結果的 `alignment_warnings` 也會帶出：缺〔補強〕／〔精簡〕、先測不到 4 題、先測題沒有難度標記或沒有難題（`__d3`）、先測不在最前面、缺「課後：字卡與模考」。
5. 沒有藍圖的舊作業（在這個版本以前開始的）照原樣發布。

大綱與投影片不必等到最後才檢查：`validate_openmaic_core_step` 收到大綱草稿時用 `checkOutlineAgainstBlueprint` 比對藍圖（缺章、順序錯、走不到的場景、超過官方保留的 100 個場景），收到投影片草稿時檢查有沒有放題目，不符就回傳 `ok=false`，任務不前進，也不會產生憑證。發布前的檢查仍然保留。課堂完成後才發現問題時，用 `get_openmaic_scenes` 與 `update_openmaic_scene` 修單一場景，不必重新生成。

### 伺服器檢查的規則

- **文件是真的**：每個引用都要有 `book_id`，且是這個使用者有權限、種類相符的文件（電子書與學校課綱須屬於這個科目；IB 文件不分科目，由 chatbot 依內容挑選適用的）；IB 文件的 SL／HL 要和 `level` 一致；學校課綱只接受本學期。每個非 `note` 的來源要寫出讀過的頁碼。
- **該引用的要引用**：科目有電子書或本學期課綱就必須引用；有 IB 參考文件時至少引用一份適用的（不必三種都引用）；除非在 `source_exemptions` 寫明至少 10 字的理由。
- **學習曲線**：2 到 12 章；先備章節只能指向排在前面的章節；每章 5 到 40 分鐘、1 到 4 個新概念（一次只教一個，多了就拆章）；第一章難度不可是 3，相鄰章節難度最多升 1 級；同一章的學習目標由淺到深（Bloom：remember → create）。
- **對應大綱與 IB 指令詞**：每個目標要有大綱編號、IB 指令詞（`level` 不是 `none` 時）與支持它的頁碼。章名不可含冒號、〔〕或｜（會和場景標題規則衝突）。
- **評量計畫**：說明前測如何涵蓋基礎／核心／難題、檢核如何只考已講解的內容、題型與指令詞如何對應 mark scheme。

**限制**：伺服器能證明文件存在、你有權限、種類和層級相符，也能比對頁碼格式，但**無法證明 chatbot 真的讀過那些頁面，也無法檢查講解內容是否忠於大綱**。這一層仍靠提示規則與使用者抽查。

## 模擬試題：附對齊表

`create_exam` 的 `alignment`（schema `exam-alignment/v1`）：逐題列出大綱編號、指令詞、配分、難度（1 基礎、2 核心、3 難題），並引用讀過的 IB 文件與課本頁碼。科目有可引用的文件時**必須附**（否則 `created: false`）；沒有任何文件的科目可省略，會得到警告。`validate_exam` 附上 `subject_id` 與 `alignment` 時一併檢查。

- 每題的 `marks` 必須等於答案 JSON 的配分，每題都要有一列；指令詞用 IB 指令詞。
- 難度曲線：前三分之一的平均難度不可高於最後三分之一（要由易到難）。難度分布會警告：基礎題不到 15%、難題不到 10% 或超過 40%。
- 同樣檢查引用的文件是否真實、有權限、屬於此科目、層級相符，必須引用科目有的文件種類。
- 儲存在 `document_alignments`（migration `0020_alignment.sql`），`GET /api/exams/:slug/alignment` 讀回。

## 教法規則（提示層）

`TEACH_FIRST_RULE` 加了兩條：先具體例子再抽象公式，例題示範 → 帶著做 → 獨立做；每章檢核放一題複習前面章節（間隔與交錯練習）。和前測、先講解再實作的規則一起，出現在 `get_openmaic_guide`、`get_module_kit`、官方大綱／投影片／測驗範本。這些是給 chatbot 的指示，沒有程式檢查。

## 部署

先套用 migration `0020_alignment.sql`（新增 `openmaic_core_runs.blueprint_json` 與 `document_alignments`），再部署 STUDY Worker，再重建 Core（範本有更新）。已經在 chatbot 裡的舊工具定義需要重新載入，因為 `start_openmaic_classroom` 與 `start_course_generation` 多了必填的 `blueprint`。

## 藍圖審核、yolo 與完成後覆核（2026-11-09）

- 開始生成前，chatbot 對藍圖做詳細自我審查（`blueprint-self-review/v1`，`src/shared/generation-review.ts`）：逐項對照課本、IB／學校大綱、章節教材與使用者要求的課綱（`user_outline`），每章檢查內容、順序與層級。有缺口、`verdict` 不是 pass、漏章、引用的來源種類沒有逐項對照，`submit_course_blueprint` 都會退回，什麼都不存。
- 通過後存成 `course_blueprint_drafts`。`mode: "review"`（預設）時藍圖在 App「AI 生成 → 互動課程」視覺化（學習曲線、章節、新概念、目標、自我審查對照表、來源、評量計畫），使用者核准或寫下修改要求；chatbot 用 `get_course_blueprint_review` 讀結果，修改後以 `replaces_draft_id` 重送（舊版變 superseded）。`mode: "yolo"` 只在使用者明確要求不必詢問時使用，自我審查通過即核准。
- `start_openmaic_classroom` 改成只收 `blueprint_draft_id`，狀態必須是 approved；直接傳 blueprint 會被拒絕（422）。超長課程分冊仍用自己的藍圖。
- 完成後：`check_openmaic_modules`（`src/shared/module-rules.ts`）擋住沒有可操作元件的模組（說明投影片轉成的模組）、沒有 speech 對話導覽的模組、不是 quiz 的「檢核：」；沒有指出操作目標只是建議。`課後：` 收尾場景不檢查。投影片檢查另外擋「試著算算看／換你算」這類要學生自己算的句子，逐步講解的例題照常通過。
- 發布前必須 `submit_classroom_review`（`classroom-review/v1`）：逐章說明每個新概念在哪些投影片、怎麼講解，每個目標在哪個測驗考到，每個模組讓學生做什麼、是否有對話導覽，並確認規則；伺服器比對真實場景標題與類型。從審核過的藍圖開始的生成，沒有通過覆核就不能發布。
- 規則同時寫進 `SLIDE_QUESTION_RULE`，所以會進到 Core 的 outline／slide 模板（需要 Core 重新建置）、生成需求與 `get_openmaic_guide`。

## 模擬試題建立後的 IB 對齊覆核（2026-11-09）

`create_exam` 之後試卷標示「待 AI 對齊覆核」（`exam_reviews.status = pending`）。chatbot 必須 `submit_exam_review`（`exam-review/v1`，`src/shared/exam-review.ts`）：逐題回答範圍、指令詞、配分是否符合 mark scheme、答案是否重算正確，列出大綱涵蓋與缺漏、難度曲線與時間。全部通過才能 `verdict: "pass"`；不完整時 `verdict: "incomplete"` 並選 `decision: "redo"`（刪掉重出）或 `"edit"`（`update_document`／`set_exam_answers`／新工具 `update_exam_alignment` 修改後再覆核）。題號必須與答案 JSON 完全一致；與對齊表不同的大綱編號或指令詞列為警告。試卷頁顯示覆核狀態，章節學習路徑不推薦待覆核的試卷。

## 每個模型回合的草稿檢查與「先讀完、先想清楚」（2026-11-16）

稽核發現的問題：只有大綱與投影片草稿在提交前被檢查，測驗、互動模組與講述要等整門課生成完才檢查，其中先測與檢核的題數與難度標記從來不擋；草稿只要包在說明文字或多一層 code fence 裡，STUDY 讀不出來就直接放行，但官方解析器讀得出來；任務的 `request_sha256` 在摘要就拿得到，所以不讀任務內容也能通過預檢；五項覆核證據可以貼同一句話。

現在 `validate_openmaic_core_step`（與舊任務的完整提交）依回合的階段檢查，程式在 `src/shared/draft-checks.ts` 與 `src/worker/routes/openmaic-core.ts` 的 `draftProblems`。只有有藍圖的生成才套用新增的檢查，舊作業照原樣。

| 回合 | 會退回（`ok=false`，任務不前進） | 只提醒（`warnings`） |
|---|---|---|
| 大綱 | 原有的缺章、順序、走不到的場景、超過 100 場景；**新增**：缺〔補強〕或〔精簡〕、缺「課後：字卡與模考」、藍圖以外的章節、先測不在最前面、場景標題重複、〔補強〕〔精簡〕裡用 quiz 場景、先測的 `quizConfig.questionCount` 不是 5 或 6、檢核不是 3 到 5 | |
| 投影片 | 放了題目或要學生自己算（不變） | |
| 測驗 | 沒有題目、id 重複、沒有題幹、沒有解析、沒有正解、正解不是選項的 `value`、單選多個正解、複選只有一個正解、選項重複、自己加「我不會」、`__m_` 格式錯。**先測**：不是 5 到 6 題、題目沒有 `__d1／__d2／__d3`、沒有基礎題、核心或難題不到 2 題。**檢核**：不是 3 到 5 題、沒有 `__d3` | 題幹超過 160 字、選項超過 60 字、先測或檢核用簡答題 |
| 互動模組 | 沒有用 `<sk-*>` 元件庫、沒有可操作的元件（只是說明頁）、缺 viewport meta | 沒有即時檢核、錯誤選項沒有標 `misconception` |
| 講述 | 模組沒有 speech、模組沒有任何指示動作（`widget_highlight` 等）、投影片沒有 speech、投影片講述要學生作答（固定規則，不呼叫模型） | 單句超過 80 字 |

大綱、投影片、測驗回合的草稿讀不出 JSON 時直接退回，不再放行。草稿的讀法與官方解析器一致（完整 JSON、code fence、說明文字裡的第一個 JSON 結構）。

先測的難度標記為什麼要擋：沒有任何 `__d` 標記的先測全對時，路由會當成「已熟練」讓學生跳過正課看〔精簡〕版（`src/shared/adaptive-learning.ts` 對未標記課程的相容行為）。

Core 端（`integrations/openmaic/overlay/lib/study-mcp`）：

- **先讀完才能預檢**：`get_openmaic_core_task_context` 從 offset 0 連續讀到 `next_offset=null` 才算讀完（只讀最後一頁、跳頁都不算；完整列出任務的舊讀法算讀完）。沒讀完時 `validate_openmaic_core_step` 回傳錯誤並說明已讀字數。STUDY 自己為了檢查而讀任務時帶 `peek=1`，不算 chatbot 讀過。
- **覆核證據要是這一回合的**：五項證據不可互相重複，也不可與同一個生成作業上一個已提交回合的五項完全相同。
- 任務裡的工作流程說明加上「動筆前先想清楚」要想的內容：這一回合教什麼、對應藍圖哪一章的目標與新概念、依據哪些頁碼、學生最可能卡在哪。

其他：

- 藍圖的 `misconceptions` 不是 id、`new_concepts` 缺 `name` 或 `kind` 時回傳錯誤，以前是不說一聲就丟掉。
- 完成的課堂裡，沒有任何題目的先測或檢核會阻擋發布；檢核沒有 `__d3`、檢核與先測用同一個題目 id 是建議。
- `update_openmaic_scene` 修改場景後，先前通過的 `submit_classroom_review` 失效（回傳 `review_required`），要重新覆核才能發布。
- 手機：用元件庫的模組只要有 viewport meta 就以真實手機寬度顯示（`viewport.ts`）。以前還要求頁面自己寫寬度 `@media`，但元件庫指南要求不要自己寫 CSS，照指南與範例寫的模組在手機上會被縮成固定畫布。
- 給 chatbot 的說明：MCP 的總說明原本把舊相容流程的 `polish_pass`、`teaching_steps`、`design_brief` 當成所有課程的要求，官方 core 的回合沒有這些欄位，已改成只適用舊草稿；手機檢查結果改寫在 `verification` 的 accessibility 證據。場景命名規則寫明〔補強〕的加強練習與復測、〔精簡〕的難題練習要用 interactive 場景，並要求場景標題不重複、大綱寫出先測與檢核的題數。

**仍然做不到**：伺服器看不到 chatbot 的思考，也不能證明它讀懂了任務、頁碼真的讀過、答案算對、講解忠於來源。上面的檢查擋的是可以用規則判斷的錯誤，並讓「沒讀就寫」「證據照抄」這兩種偷懶走不通。超長課程分冊沒有藍圖審核與發布前的逐章覆核（`blueprint_draft_id` 才要求），這一點沒有改。

部署：這些修改還沒部署。先部署 Core（新增兩個欄位用 `ADD COLUMN IF NOT EXISTS`，啟動時自動加上；範本有更新所以要重新建置），再部署 STUDY。STUDY 先上線也不會壞（舊 Core 忽略 `peek`），只是「先讀完」還不會生效。Core 上線時仍在待答的任務要重新讀一次內容才能預檢；已經拿到憑證的任務可以直接提交。場景命名規則多了約 330 字，會計入生成需求的 19,800 字上限。
