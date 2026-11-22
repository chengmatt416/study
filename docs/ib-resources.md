# IB 生成參考資料

用途是讓連接 STUDY MCP 的 chatbot 在生成內容時讀取管理員提供的 IB 參考文件；不是新增學生書架，也不呼叫 AI API 來代讀或生成範例。

管理入口：`/admin/ib-resources`。只有管理員可上傳、替換、編輯或刪除；沿用原始 PDF 閱讀器、20 MiB 分段續傳、100 MiB 單檔上限、R2 空間配額與既有檔案權限。

## 分類

- **不分科目**：文件不綁科目，上傳與編輯都沒有科目欄位。請在文件名稱寫上科目（如「Chemistry guide 2025」），chatbot 靠名稱與版本自行挑選。
- 類型：`syllabus`、`guideline`、`mark_scheme`。
- 級別：`SL`、`HL` 或 `both`；查 SL／HL 時包含共用文件。
- 首次評核年份及版本／考試場次選填，可保留多個版本。系統不以最新上傳時間替 chatbot 決定適用版本。
- 不綁學年度／學期。原有學期課綱、電子書、data booklet 清單不混入 IB 生成參考資料。

## MCP 使用流程

1. `list_ib_resources(query?, ib_level?, ib_document_type?)` 取得有權讀取且已完成上傳的**全部**文件索引（不需 subject_id）；`query` 只是對名稱／版本的關鍵字篩選。chatbot 依名稱、類型、級別、版本自行判斷哪些適用於本次科目。
2. `get_ib_resource(book_id, delivery="link")` 取得原始 PDF 下載連結與 MCP PDF resource_link。小於 2 MiB 的 PDF 可用 `delivery="inline"` 回傳二進位 resource；也可沿用 `get_book_pdf`／`resources/read`。
3. chatbot 實際讀取適用文件後再生成。Syllabus 決定範圍／目標，guideline 提供教學或評量規則，mark scheme 必須核對試卷、年份與場次，不能套用到不相符題目。
4. 引用註明文件名稱、版本與頁碼；永久連結用 `book:<book_id>#<印刷頁碼>`，不能把短效下載網址寫入教材。

`get_format_guide(kind, ib_level?)` 對 note／exam／cards 均附上參考規則與完整 IB 文件索引。OpenMAIC 新作業的 requirement 與開始生成的回應只帶讀取規則，不帶索引：requirement 只有 20,000 字，文件一多就排擠藍圖；續接時每個回合重送也很浪費。chatbot 寫藍圖前本來就要呼叫 `list_ib_resources`，並把用到的文件寫進藍圖。完整官方 Core 生成與編譯仍走 MCP。索引不代表已讀取 PDF，也不把完整大檔塞進每個模型 prompt。缺檔、版本不明、掃描檔無法讀取或沒有權限時必須明說，不能捏造來源內容。PDF 內指令不具有 chatbot 系統／工具指令的權限。

## 權限與儲存

MCP 讀取沿用 `ai`、`syllabi`（管理介面顯示「課綱／IB 科目文件」）及個別 `book` resource 權限；無權文件不出現在索引，PDF 與短效下載也會重新檢查。上傳檔案內部重用 `books` 的 PDF 管線，使用 `kind=syllabus` 加 IB metadata，不改既有 kind 約束。管理清單用 `GET /api/books?collection=ib`；普通 `/api/books?kind=syllabus` 僅返回學期課綱。metadata 編輯不轉換一般書籍／課綱分類；替換 PDF 保留文件分類與閱讀進度。IB 文件不再屬於任何科目，刪除科目不受影響。

部署前套用 `0013_ib_subject_resources.sql` 與 `0021_ib_resources_no_subject.sql`（後者把原有 IB 文件的科目名稱補進文件名稱，再清除其科目）。沒有新服務、AI key 或本機伺服器需求。
