// Keep each official generation below its 50,000-character source and 100-scene outline limits.
export const LONG_COURSE_SOURCE_CHARS = 45_000;
export const LONG_COURSE_MAX_PARTS = 10_000;
export const LONG_COURSE_GUIDE = `超長課程使用分冊工作流程，不把數百萬字塞進單一模型回合。官方每冊最多 100 個場景，來源只讀前 50,000 字元；平台每冊限制 45,000 字元，拒絕超限，絕不默默截斷。
先 create_long_course（指定既有 note_slug）建立總課程；依來源章節與先備關係，將完整教材分成有意義、可獨立學習的冊。每冊保留完整原文、頁碼與引用，製作 2–12 章的 blueprint（每章最多四個新概念），場景數加總不超過 100，預留先測、補強、精簡、檢核與收尾的場景數。不要為了縮小輸入而刪掉推導、例題或來源。
逐冊 add_long_course_part（穩定 part_key、title、source_md、blueprint），同 key 同內容重試不重複；key 與內容不同回傳衝突。最多 10,000 冊，總來源可超過數百萬字；清單只回傳一頁摘要，原文另外分段讀取。先讀來源、確認涵蓋範圍與先備知識，再生成本冊。
start_long_course_part → get_openmaic_core_step（summary=true）→ get_openmaic_core_task_context 依 next_offset 讀完完整任務（直到 next_offset=null）。先在心中釐清當前來源範圍、學習目標、先備概念、場景預算與驗收方式，草擬後再以獨立審查者角度重新計算答案（不沿用初稿結論）、逐項檢查引用、公式、單位、邊界值、教學順序、題目答案、工具 schema、手機和鍵盤操作；修正後先 validate_openmaic_core_step；依 errors 修正並再次驗證，ok=true 才將 task_id、expected_version、validation_receipt 交給 submit_openmaic_core_step（省略 output，直接提交已儲存的同一稿，避免重寫大型教材）。修改內容或覆核紀錄後必須重新驗證，不能挪用上一稿的憑證。只提交精簡、具體、可查核的 verification 證據，不提交內部思考過程；不能把自我評分當作實際測試。沒有執行的瀏覽器檢查必須明說。
大綱草稿在預檢時就比對藍圖：每章的場景標題要照規則，一章要分多張教學時，後續場景標題用「章名｜小節」，依序放在「章名」之後、「檢核：章名」之前，放在兩章之間的無標題場景會被拒絕。投影片草稿在預檢時檢查有沒有放題目。
官方 succeeded 後先 check_openmaic_slides / check_openmaic_alignment，再 publish_openmaic_classroom；分冊會加入總課程，不覆蓋筆記原有課堂。筆記之後被修訂不影響分冊發布，分冊依自己儲存的來源。
分冊可以修正：未開始生成的冊用 update_long_course_part 修改；順序錯了用 move_long_course_part；生成卡住或方向錯了用 reset_long_course_part 放棄後再修改、重新 start_long_course_part（已發布的課堂在新版發布前繼續開放）；已完成只是檢查沒過時，用 get_openmaic_scenes 與 update_openmaic_scene 修單一場景，不要重生整冊。delete_long_course_part 與 delete_long_course 會永久刪除，只在使用者明確要求時呼叫。
每冊完成才繼續下一冊；中斷用 list_long_courses / get_long_course 恢復並查現有 generation_id，勿重建已完成冊。若 get_openmaic_core_step 摘要或任務內容回傳 validation_receipt，表示覆核稿已儲存，依 next_action 只提交 task_id、expected_version、validation_receipt 即可，勿重新產生或重傳大型教材；沒有憑證才依完整閱讀、草擬、獨立覆核與驗證流程繼續。全部來源必須逐冊涵蓋，最後檢查來源頁碼／章節是否缺漏與跨冊先備關係。平台驗證結構與發布條件，科學與教學正確性由生成者據實覆核。`;
