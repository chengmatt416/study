# 學期課綱上傳

`/syllabus` 管理依學年度、學期與科目分類的 syllabus PDF。管理員可上傳、修改分類與替換 PDF；成員只能讀取自己群組開放的內容。西元起始年 `2026` 顯示為 `2026–2027` 學年度，學期為 `1`（上）、`2`（下）或 `summer`（暑期）。預設使用 UTC+8、八月起始學年：八月至次年一月為上學期，其餘月份為下學期；這是可手動覆寫的初始值，不是學校校曆推斷。

PDF 單檔上限 100MB，沿用既有 multipart 上傳、PDF 標頭驗證、R2 配額、封面與頁數分析及閱讀器。`books.kind='syllabus'` 搭配 `academic_year`／`semester` 保存，新增欄位由 migration 0009 建立，不重建或搬移既有書本。一般電子書與資料手冊清單不混入課綱。新學期應另外上傳，以保留歷年；替換檔案沿用原分類與標注，會使舊 MCP PDF 下載連結失效。

續傳 key 包含登入者、檔案、類型、目標文件、學年、學期、科目與名稱。同名檔案不會跨學期／帳號混用部分內容。舊版續傳 key 只有在伺服器上傳作業的建立者、大小、目標文件及分類均符合時才沿用。在原裝置選擇同一檔案與設定可續傳；其他裝置沒有本機續傳資料。

## 權限

`syllabi` 是獨立功能開關。個別課綱仍使用既有 `book` resource 規則，可覆寫同群組預設；跨群組拒絕優先。關閉 `ebooks` 或 `booklets` 不影響課綱。列表、閱讀器、PDF、封面、標注、上傳作業與 MCP 都共用伺服器權限控管。管理員介面自動列出新功能與各份課綱。

手機的既有主要分頁保留，其餘有權存取的入口放在「更多」；更多選單從目前有權存取的導覽項目衍生，避免新增入口後擠掉字卡或顯示被停用功能。

## API 與 MCP

- `GET /api/books?kind=syllabus` 列出課綱，可用 `academic_year`、`semester`、`subject` 篩選。
- `POST /api/books/uploads` 傳入 `kind: "syllabus"`、必填學年度／學期及既有上傳 metadata，後續使用既有 parts／complete 流程。
- `PUT /api/books/:id` 可修改課綱名稱、科目、學年度與學期，僅管理員可用；一般書本不能設定學期。
- MCP `list_syllabi` 預設找本學期，可明確指定 `academic_year`、`semester`、`subject_id`；`all_terms=true` 查歷年。
- MCP `list_books` 另回傳 `syllabi`；使用 `get_book_pdf`／PDF resource 讀原始檔案，沿用既有短效連結與權限限制。模型必須先核對學期再依課綱生成內容，不得混用歷年課綱。

只提供 PDF 上傳；本次不新增 DOCX 匯入或自動 OCR。測試涵蓋日期預設、上傳限制、歷年篩選、分類編輯、權限分離、續傳隔離與 MCP 工具鏈。

## 課表

`/syllabus` 頁面上方有「課綱／課表」分頁。課表是每個帳號自己的每週重複課程：課程名稱、星期（1=週一…7=週日）、24 小時制開始／結束、教室與科目（科目色作為卡片色條）。同一天時間重疊只提醒、不阻擋儲存。手機一次顯示一天（預設今天，以 UTC+8 判斷），桌面並列顯示整週；週末有課才出現週六、週日欄。

課表依學年度＋學期保存在 D1 `timetable_entries`（migration 0017），僅本人可讀寫，每學期最多 200 堂。權限沿用 `syllabi` 功能開關；不受共享內容寫入限制，因為這是個人資料。

- `GET /api/timetable?academic_year&semester`（省略時為本學期）、`POST /api/timetable`、`PUT /api/timetable/:id`（局部更新，`room`／`subject_id` 傳 null 清除）、`DELETE /api/timetable/:id`。
- MCP：`list_timetable` 讀取；`add_timetable_entry`、`update_timetable_entry`、`delete_timetable_entry` 需要 `study:write`。新增與修改會回傳同一天時間重疊的 `conflicts`，chatbot 應告知使用者，不自行決定。修改前先 `list_timetable` 取得 `entry_id`。

純邏輯在 `src/shared/timetable.ts`，路由在 `src/worker/routes/timetable.ts`，測試於 `tests/timetable.test.ts`、`tests/timetable-api.test.ts`。
