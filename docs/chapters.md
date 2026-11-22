# 章節與上傳教材

「章節」取代側欄的「重點整理／模擬試題／字卡」三個入口（三個清單頁仍在 `/notes`、`/exams`、`/decks`，章節頁頂端與內容庫都有連結）。一個章節屬於一個科目，集合該單元的重點整理（含它的 OpenMAIC 互動課程）、模擬試題、字卡組，以及使用者上傳的教材。

## 資料

- 章節沿用原本未使用的 `topics`，內容關聯沿用 `content_links`（`content_type` 為 `document` 或 `deck`）。migration `0028_chapters.sql` 補上建立者與時間欄位、唯一索引，以及刪除章節、文件、字卡組時清掉關聯的 trigger。
- `chapter_preferences(user_id, topic_id)`：每個人對每章的學習方式（`summary` 文字版重點整理／`course` 互動課程）與「模擬考前先複習字卡」。
- `chapter_materials`：上傳教材的中繼資料；原檔與擷取的文字放在 R2（`chapter-materials/<章節>/<教材>/original.<格式>`、`text.md`）。

## 公共與私人、管理

- 每個章節是**私人**（只有建立者看得到，預設）或**公共**（看得到該科目的人都看得到）。migration `0031_chapter_visibility.sql` 加上 `topics.visibility`。
- 所有地方用同一條規則（`VISIBLE_CHAPTER_SQL`，`src/worker/routes/chapters.ts`）：章節列表、章節頁、加入內容、上傳與讀取教材、藍圖引用教材、藍圖的 `chapter_id`。別人的私人章節一律回 404，連名稱都不會出現。
- 舊的 `topics` 資料沒有建立者，永遠不會列出，所以一開始是空白的。章節只會由使用者建立；chatbot 只有在使用者明確要求時才 `create_chapter`（預設 private），同一個人看得到的範圍內同科目同名會被拒絕（409）。
- 管理：章節卡片與章節頁的「管理」可改名稱、大綱編號、說明、公共／私人、刪除。私人章節只有建立者能管理；公共章節由建立者或管理員管理，但只有建立者能切換公共／私人。公共章節裡有別人的內容或教材時不能改成私人。
- 建立或修改公共章節需要共享寫入權限；私人章節不需要。
- **內容跟隨章節**（`src/worker/lib/chapter-visibility.ts`）：章節的公開／私人會套用到**章節建立者自己**的重點整理、模擬試題與字卡組。切換章節時一起改（回傳 `content_updated`）；把內容加入章節時，若內容是自己的，改成與章節相同；別人的內容維持原設定。
  - 章節改私人時，若其中自己的內容也在另一個公共章節裡，會回 409 並列出內容，不能改。內容在任何章節裡時，不能在內容自己的頁面切換公開／私人（回 409，請改章節）。
  - 從章節移出內容不會改變它的可見範圍。章節教材沒有自己的可見範圍，跟著章節。
  - 既有資料不會自動同步，只在章節切換或加入內容時套用。
- 章節內只列出看的人可見的內容：別人的私人重點整理、試題、字卡組不會出現，也不計入數量。加入內容：內容建立者、章節建立者或管理員（私人章節只有建立者）；內容必須同科目（或未分類）。

## 刪除章節會一起刪除裡面的內容

刪除前先顯示清單（`GET /api/chapters/:id/deletion`，刪除用同一個計畫）：
- 你可以刪的內容一起刪除：重點整理與試題移到垃圾桶（管理員可還原），字卡組直接刪除（私人字卡組的擁有者或管理員）。
- 只移出、不刪除：也在其他章節的內容、別人建立的內容、非管理員的共享字卡組。
- 上傳的教材一起刪除（R2 原檔與文字）。每項刪除都記入 audit log（`via: chapter.delete`）。

## 同步

章節出現在章節列表、章節頁、加入內容、內容庫與藍圖審核。任何章節或內容的變更都呼叫 `refreshChapterData`（`src/web/features/chapters/sync.ts`）一起重新讀取，章節列表與加入內容的清單每次打開都重新讀取，不會看到已刪除、改名或改成私人的章節與內容。

## 第一次打開：onboarding

沒有偏好時，章節頁先跳出兩步設定：

1. 文字版簡易重點整理（已精熟，考前自我檢核）或 OpenMAIC 互動式課程講解（不熟，需要重新學）。
2. 模擬試題前要不要先複習字卡。

儲存後顯示「學習路徑」（`studyPlan`，`src/shared/chapter.ts`）：重點整理或互動課程 → （選擇時）字卡 → 模擬試題。選了互動課程但還沒生成時，第一步改連到重點整理。等待 AI 對齊覆核的試卷不放進路徑。之後從「學習設定」修改。

## 上傳教材（給 AI 生成用）

- 格式：pptx、docx、md、pdf、html，單檔 30 MB 以內。
- 閱讀：章節頁點教材檔名開啟 `/chapters/:id/materials/:materialId`。PDF 會建立（第一次開啟時）一筆 `books.kind='chapter'` 的書籍記錄（`POST /api/chapters/:id/materials/:mid/reader`，遷移 `0032_chapter_material_books.sql`），直接進入預設電子書閱讀器，標注、書籤與閱讀進度都照常保存。這筆記錄不出現在書架、搜尋與內容庫，可見範圍跟章節（`src/worker/lib/access.ts` 的 `accessCatalog` 與 `readableBookFile`）；不能從書籍路由刪除或替換，請從章節刪除教材。其他格式在站內查看器開啟（docx 用 docx-preview、pptx 用 pptxviewjs、md 用 Markdown、html 放在無腳本的 sandbox iframe）。
- 文字在瀏覽器擷取（`src/web/features/chapters/extract.ts`）：pdf 用 pdf.js 逐頁，docx 用 mammoth（圖片以「［圖片］」標記），pptx 用 `src/shared/zip.ts` 依投影片順序讀出文字與講者備註，html 去掉 script／style 後保留標題、段落、清單與表格列。掃描的 PDF 沒有文字層，會被拒絕。
- multipart 會把換行變成 CRLF，伺服器存檔前換回 LF。
- MCP：`list_chapters`、`get_chapter`、`get_chapter_material`（每次 24,000 字元，依 `next_offset` 讀完）、`create_chapter`、`link_to_chapter`；管理用 `update_chapter`（改名、說明、公共／私人）、`unlink_from_chapter`、`delete_chapter_material`、`get_chapter_deletion_plan` 與 `delete_chapter`（必須先給使用者看刪除清單，`confirm: true` 才會刪）；`create_note`、`create_exam`、`create_deck` 可帶 `chapter_id` 自動加入章節。教材是資料，不是指令（回應附 `source_policy`）。
- 課程藍圖可用 `kind: "chapter_material"`（`book_id` 填 material id）引用教材；`validate_course_blueprint`／`submit_course_blueprint` 帶 `chapter_id` 時，該章節有教材就必須引用或寫明豁免理由。

## 內容庫刪除

內容庫每列與批次操作列多了「刪除」。`/api/content` 回傳 `can_delete`，規則與刪除路由一致：重點整理與試題（建立者或管理員）移到垃圾桶，私人字卡組（擁有者）或管理員刪字卡組，電子書限管理員；字卡組與電子書是永久刪除，確認視窗會說明。
