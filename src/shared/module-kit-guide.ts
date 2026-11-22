// What the chatbot reads before generating interactive modules. Spec: docs/module-kit.md.
// Keep MODULE_KIT_PROMPT short: it is appended to the official interactive generation prompts.
// Import-free on purpose: scripts/openmaic patch tooling loads this file directly with Node.
const VERSION = 'study-kit/v1';

/** Scene-title conventions the player uses to route learners. Visible text on purpose: the DSL has no field for it. */
export const ROUTING_CONVENTION = `課堂路由命名規則（播放器依場景標題辨識，標題必須照寫）：
- 先測場景（quiz）：「先測：章名」。每章 5 到 6 題，由易到難涵蓋基礎、核心、難題三個難度（規則見前測規則）。所有先測集中放在課程最前面（播放器會在學生進入每一章之前才播放該章的先測，不會一次考完）。
- 標準教學場景：「章名」。內容順序固定：講解 → 操作 → 紀錄與自我檢核（見章節流程）。教學要分多張時，後續場景標題用「章名｜小節」，依序放在「章名」之後、「檢核：章名」之前，播放器會逐張播完才進檢核。
- 檢核場景（quiz）：「檢核：章名」，是這章的覆核，放在該章教學之後，題目與先測不同。
- 補強版：「章名〔補強〕」，覆核沒通過的學生看：針對答錯的迷思用更小步驟、更多新例子重教，做加強練習，最後以「復測」頁收尾。每章都要備。多張時後續標題用「章名〔補強〕｜小節」。
- 精簡版：「章名〔精簡〕」，先測（含難題）全對的學生看：不重新教，先用一頁「重點回顧」列出公式、適用條件與符號單位，再放「考試陷阱提醒」與「難題練習＋解析」。每章都要備。多張時後續標題用「章名〔精簡〕｜小節」。
- 延伸版：「章名〔延伸〕」，可選。
- 〔補強〕〔精簡〕〔延伸〕裡的場景只能是 slide（講解、重點回顧、考試陷阱提醒、附完整解答的例題）或 interactive（要學生作答的加強練習、復測、難題練習，用 <sk-*> 題型並附 sk-explain 解析）。不可用 quiz 場景（quiz 只用於「先測：章名」與「檢核：章名」），也不可把要學生作答的題目放進 slide。例：「章名〔補強〕」(slide) →「章名〔補強〕｜加強練習」(interactive) →「章名〔補強〕｜復測」(interactive)；「章名〔精簡〕」(slide，重點回顧與考試陷阱) →「章名〔精簡〕｜難題練習」(interactive)。
- 每個場景標題都不同；大綱裡先測的 quizConfig.questionCount 填 5 或 6，檢核填 3 到 5。
- 沒有以上標題的場景照原順序播放：開頭的簡介，以及最後一個「課後：字卡與模考」。放在兩章之間的無標題場景學生走不到，大綱驗證會拒絕。
- 測驗題的 id 以 __m_<迷思id> 結尾，代表此題探測的迷思，例如 q2__m_forgot-double-angle。迷思 id 只用英文小寫、數字與連字號，同一個迷思在整門課使用同一個 id。
- 前測與檢核題的 id 在 __m_ 之前加 __d1（基礎）、__d2（核心）或 __d3（難題）標示難度，例如 q4__d3__m_forgot-sign、q1__d1。播放器靠它判斷學生是基礎不足、核心沒懂，還是只差難題；沒有標記的題目一律當作核心題。`;

/** How a pretest finds out what the learner really knows. Appended to the quiz generation prompt, the course requirement and the MCP guide. */
export const PRETEST_RULES = `## STUDY 前測規則（強制；適用標題為「先測：章名」的測驗場景）
前測的目的是精準看出學生程度，不是暖身，也不是複習：
1. 每章 5 到 6 題，由易到難，涵蓋三個難度，題目 id 用 __d1／__d2／__d3 標示（放在 __m_ 之前，例如 q4__d3__m_forgot-sign）：
   - __d1 基礎（1 到 2 題）：這章需要的先備知識（前面章節或前一個單元）。沒有它就學不會這章。
   - __d2 核心（2 題）：這章要教的主要概念與公式，要理解或推一步，不是背誦定義。
   - __d3 難題（2 題）：考試等級的難題（IB Paper 2 或段考最難的幾題）：多步驟、要整合兩個概念、藏有單位／符號／條件的陷阱，或把觀念用到陌生情境。只背公式的學生答不出來。
2. 難題要能區分程度：每個錯誤選項對應一個真實的常見錯誤並帶 __m_ 迷思；不能靠刪去法、字面線索或題幹洩漏答案。難在思考，不在算很久；數字簡單，推理要完整。
3. 每題單獨可作答，不使用這章尚未講解的記號；題幹短，手機一屏讀完。系統會自動加上「我不會」選項，不要自己加。
4. 為什麼三個難度都要有：全部答對（含難題）才算真正熟練，會直接看〔精簡〕版；只錯難題的學生不是基礎不好，會看標準教學並加強難題；錯基礎或核心題的學生同樣看標準教學，但解說會放慢、更詳細；先測、隨堂測驗答錯都不會進〔補強〕，只有「檢核：章名」沒通過才會。沒有難題，系統就無法分辨「真的會」和「只會簡單題」。
5. 前測不給提示、不講解（講解放到教學場景）。檢核題也要標示難度，並至少一題 __d3 遷移題。`;

/** Explain first, practise after. Appended to the outline, slide and quiz prompts, the course requirement and the MCP guide. */
export const TEACH_FIRST_RULE = `## STUDY 教學順序規則（強制）：先講解，再實作
所有公式、觀念與推理邏輯都要先講解，之後才可以拿來實作：
1. 任何公式、定義、符號、單位、定理、解題步驟或推理規則，必須先在講解場景（slide）講清楚：是什麼、為什麼成立（來源或直覺）、符號與單位、適用條件，並附一個有完整解答的例題。之後才可以出現在檢核題、〔補強〕練習、復測與〔精簡〕難題裡。
2. 檢核（「檢核：章名」）、〔補強〕與〔精簡〕的題目，只能考同一章已講解過、或前面章節已教過的內容；不可讓學生第一次在題目裡遇到新公式、新術語或新方法。
3. 一次只引入一個新公式或觀念：講解 → 示範 → 才進下一個。兩個以上的新東西不可擠在同一頁，也不可把推導整段省略。
4. 〔精簡〕版不重教，但開頭要有一頁「重點回顧」（公式、適用條件、符號單位，不重新推導），再放考試陷阱與難題。
5. 教法：先具體例子再抽象公式；例題示範 → 帶著做（有提示）→ 獨立做（逐步撤掉提示）；用學生已經知道的東西當橋樑，再引入新名詞，IB 術語附英文。
6. 複習：每章檢核放一題複習前面章節的核心觀念（間隔與交錯練習）；答錯時指回對應的講解場景，不直接給答案了事。
7. 例外：先測（本來就是在教學前診斷學生會什麼）與互動模組（讓學生先動手操作、探索並得到即時回饋）不受「先講解」的限制；其餘場景一律先講解再實作。`;

/** Where questions may go. Appended to the official outline and slide prompts, the course requirement and the MCP guide; publishing checks it. */
export const SLIDE_QUESTION_RULE = `## STUDY 題目位置規則（強制；違反的課程無法發布）
投影片（slide）只用來講解：定義、原理、推導、圖解，以及已經附完整解答的例題。**絕對不可以把要學生作答的題目放進投影片**：選擇題、是非題、填空、計算題、簡答、「想一想／試試看／練習」這類要學生回答的提問，以及 (A)(B)(C)(D) 選項，一律不行。
要學生作答的題目只能放在這三處：
1. 前測：quiz 場景，標題「先測：章名」，放在課程最前面。
2. 中測（檢核）：quiz 場景，標題「檢核：章名」，放在該章教學之後。
3. 互動模組：interactive 場景裡的 <sk-choice>、<sk-numeric>、<sk-order>、<sk-match>、<sk-sort>、<sk-fill>、<sk-balance> 等，講解後讓學生動手作答，並有即時回饋。
大綱規劃時，不要有「練習」性質的 slide；需要練習就另外安排 quiz 或 interactive 場景。投影片想帶學生思考時，改成陳述句，或寫「接下來進入檢核／互動模組」；教師口白也不要要求學生在投影片這一頁作答。發布前用 check_openmaic_slides 檢查。
投影片可以一步步講解例題（每一步附答案與理由），但不可停下來要學生自己算（「試著算算看」「換你算」也不行）。互動模組只用於互動：一定要有可操作元件，不可把說明投影片轉成模組；模組由對話一步步導覽操作（先 widget_highlight／spotlight／laser 指出目標再講），不可讓學生完全自行探索。課間檢核「檢核：章名」一律用 quiz 場景。`;

export const CHAPTER_FLOW = `章節流程（每一章都照這個順序，播放器依場景標題與學生表現自動分流）：
1. 先測：章名（5 到 6 題，含基礎、核心與難題三個難度，id 標 __d1／__d2／__d3；見前測規則）。不確定的題目學生可選「我不會」。
2. 先測全部答對（含難題）→ 跳過正課，播放「章名〔精簡〕」：不重新教，先一頁「重點回顧」（公式、適用條件、符號單位），再放
   - 考試陷阱提醒：這章最常失分的 3 到 5 個陷阱（單位與符號、指令詞、近似與有效位數、IB 給分踩點），每個一句話加一個錯誤對照；
   - 難題練習與解析：2 到 3 題考試等級難題，一題一頁，先作答，再看逐步解析並對照常見錯法。
3. 其他學生看「章名」，順序固定：先講解、再操作、最後紀錄與自我檢核；所有公式、觀念與推理都先講解再實作（先測與互動模組除外，見教學順序規則）。投影片只講解，所有要學生作答的題目只放先測、檢核或互動模組，絕不放進投影片。講解每步只講一個概念，先說原因再示範，IB 術語附英文；操作依科目而定（見互動規則）。
4. 「檢核：章名」是覆核，3 到 5 題含一題遷移，題目不可和先測重複。
5. 覆核沒通過 → 「章名〔補強〕」：依答錯的迷思拆成更小步驟、換新例子，做加強練習，最後一頁「復測」用全新題目（不同於先測與檢核），全部答對才算完成。播放器接著讓學生再做一次覆核。
6. 全部章節完成 → 播放最後一個沒有標籤的場景「課後：字卡與模考」。`;

export const INTERACTION_RULES = `互動規則（先判斷科目，再決定模組長什麼樣子；不要每章套同一個版型）：
A. 滑桿不是預設控制項：先想真實實驗會怎麼動手，再決定用什麼控制。真實器材本來就是連續調整的量（可變電阻、旋鈕、改變角度），或滑桿確實是最清楚的方式時可以用，數量不設硬性上限；但不要把「幾個滑桿加數值讀出」當成模擬實驗，也不要為了湊互動而放滑桿。
B. 科學（物理、化學、生物）＝操作內建的虛擬器材。不要自己畫器材 SVG，也不要自己寫拖曳、倒液、物理或動畫：用 <sk-lab> 放 <sk-item kind="…">，器材的外觀、操作邏輯與動畫都已內建（器材清單見下）。
   - 一張實驗桌放 2 到 4 個器材；電路板、光學桌、斜面各自獨佔一張桌。實驗要貼近真實流程：例如先把錐形瓶拖到滴定管下、加指示劑、再控制旋塞，操作順序錯有後果（液體滴到桌面、電流計接成並聯會燒斷、燈泡電壓過高會燒壞）。
   - 初始狀態用屬性設定（例如 liquid="NaOH:0.100:50"；未知濃度的溶液標籤只寫「未知」，不要把答案寫進 label）。學生不是看答案，而是操作後讀儀器。
   - 讀值自動發佈為「器材id.讀值名」（例如 bur.reading、bal.mass），可給 sk-record、sk-observe 的 of 使用。
   - 紀錄：sk-record 的 sk-col name 填上述讀值；玻璃器皿刻度、滴定管、彈簧尺這類要「自己讀」的欄位加 manual（學生輸入讀到的值，超出 tol 判為讀不準）；數位儀器（天平、溫度計、pH 計、碼錶）不加 manual，直接記錄螢幕讀數。每欄可設 low／high 合理範圍與 misconception。至少 3 筆，每筆改變一次條件。
   - 檢核：紀錄完成後，用 sk-numeric 檢核由紀錄算出的結果（單位、有效位數、誤差來源），用 sk-choice 檢核結論；StudyKit.records('id') 取得記錄列。
   - 只有清單裡真的沒有的器材，才退一步用 sk-figure 自己畫，而且要有點選替代、不堆滑桿。
C. 數學＝做題，不做實驗。講解後直接給題目，由淺到深 4 到 6 題，一題一個 sk-tab，用 sk-numeric、sk-choice、sk-order（步驟排序）、sk-match、sk-graph（在座標圖上標點或畫直線）、sk-table（完成數值表）。第一題用「帶著做」：<sk-steps gated> 一步一小題，答對（或看過解答）才開下一步，之後的題目才讓學生獨立做。最多一張示意圖（sk-figure 或 sk-plot），不放控制項。每題有 sk-hints、對應常見計算錯誤的 sk-wrong，以及逐步解析的 sk-explain。
D. 非實驗的科學互動（概念、現象、機制、化學式、圖解）不要全是選擇題。同一章至少用 3 種不同題型，依概念挑最貼切的：
   - sk-sort 分類（把物質、現象、例子拖進分類）；sk-match 配對（名詞與定義、儀器與用途、公式與意義）；sk-order 排序（實驗步驟、反應或生理歷程、因果鏈）；
   - sk-label 圖解標示（把名稱放到圖上的位置）與 sk-pick 點選圖上的部位（圖要自己畫或用簡單 SVG，部位加 data-part）；
   - sk-fill 填空（詞庫）；sk-balance 配平化學式（調整係數，兩邊原子數即時顯示）；
   - sk-knob 旋鈕加 sk-tune 調數值（把變因調到目標結果，例如調電壓與電阻讓電流剛好 2 A）；sk-numeric 數值計算；
   - sk-table 完成表格（實驗數據、ICE 表、真值表）；sk-graph 把數據點標到圖上或畫出關係直線；sk-mark 在一段文字或一份解題過程裡點出指定的片段（找出錯誤的步驟、找證據、找關鍵詞）；sk-reflect 先用自己的話寫下解釋，再對照參考說法逐項勾選重點。
   每一題都要有 misconception 與 feedback；題目難度由淺到深，一題一個 sk-tab。
E. 人文、語言等其他科目：用分類、排序、配對、填空、情境判斷等題型，加上 sk-mark（在文本裡點出論點、證據、修辭或文法錯誤）與 sk-reflect（寫下自己的詮釋再對照重點），不做模擬。
F. 術語：每章最多一組 <sk-flashcards>（5 到 8 張，正面英文術語，背面中文與一句用法），放在題目之後當回想練習；學生先回想再翻面，不熟的會再出現。`;

export const COURSE_CLOSING = `課程收尾（最後一個沒有標籤的場景，標題「課後：字卡與模考」）：
1. 一兩句總結學會了什麼；有建議複習的章節就列出。
2. 邀請學生回到 STUDY App 的「字卡」頁（/decks），找到本課牌組做複習，對應本課的英文術語。
3. 字卡複習完，到「模擬試題」頁（/exams）進行模考，看錯題解析後再回來補弱點。
4. 生成時先用 list_decks 與 list_documents（kind=exam）找對應的牌組與試卷；沒有就用 create_deck＋add_cards（正面英文術語，背面中文與一句用法）與 create_exam 建立，並在這個場景寫出它們的實際名稱。只寫文字路徑，不放外部連結。`;

export const POINTING_RULES = `講解與指示規則（讓學生知道現在要看哪裡、要動手哪裡）：
1. 每一句講到畫面上的東西，就在這句 speech 之前放一個指示動作，先指再講。投影片用 spotlight（要看的整塊區域）或 laser（具體的文字、數字、圖形點）；互動模組用 widget_highlight，target 是 CSS selector，content 是 15 字內的動作，例如「把錐形瓶拖到滴定管下方」。一句提到幾個東西就指幾次，不要整段講完才指一次，也不要讓聚光燈或雷射停在已經講完的東西上。
2. 輪到學生動手的那一句，一定要有 widget_highlight 指向要操作的器材或控制項，而且一句只講一個動作。模組會用聚光燈、雷射點與「換你操作」標籤標示目標，學生操作該目標後標示自動消失；下方講解列也會同步顯示「換你操作」。先講原因與示範，再指示動手，動手後再講觀察重點。
3. 器材的 selector：整個器材 [data-id="id"]；滴定管旋塞 [data-id="bur"] [data-hot="cock"]；滴瓶 [data-id="ind"] [data-hot="squeeze"]；天平歸零 [data-id="bal"] [data-hot="tare"]；加熱板旋鈕 [data-id="hp"] [data-hot="knob"]；碼錶 [data-id="sw"] [data-hot="start"]；電路接點 [data-id="ck"] [data-hot="t:元件序:0"]（元件序從 0 起算、0 左 1 右）、開關 [data-id="ck"] [data-hot="sw:元件序"]；實驗紀錄 #rec；題目用它的 id，例如 #q-vol。
4. 提問與討論面板只留給學生發問，以及學生主動找虛擬同學討論；老師的講解句子只出現在下方講解列，不要為了討論面板另外重複一遍。`;

export const LAB_CATALOG = `虛擬器材清單（<sk-lab heading="…"> 裡放 <sk-item kind="…" id="…" label="…">）：
化學與通用：
- beaker／flask／cylinder／testtube：liquid="物質:濃度M:體積mL;…"（例 HCl:0.10:25;water:0:50）、cap、temp、indicator（phenolphthalein／methylorange／bromothymolblue）。拖曳到另一容器上方會自動傾倒並按時間流出，也可選取後按「倒入」。讀值 id.volume、id.temp。固體可放進去（排開液體）。
- burette：liquid、start（起始讀數）。放大鏡顯示 0.1 mL 刻度；旋塞輕點一滴（0.05 mL）、按住連續放液；容器拖到下方會自動對位。讀值 id.reading。
- pipette cap="25"：拖到容器上，選取後「吸取至刻度」「放出」。讀值 id.volume。
- bottle liquid="phenolphthalein"（或 HCl:1:500）：拖到容器上方後按壓滴入。
- balance（resolution）：放上容器或固體，按 TARE 歸零，讀值 id.mass。thermometer：放進容器，讀值 id.temp。heater（power）：放上容器並開關，實驗桌會出現「時間 ×10」。stopwatch：讀值 id.time。phmeter：把探頭拖進溶液，讀值 id.ph。solid（volume、mass）、mass（grams）：可放上天平、放進量筒、掛在彈簧上。
- 物質：water、HCl、HNO3、H2SO4、CH3COOH、NaOH、KOH、NaCl、CuSO4、KMnO4；pH 與指示劑顏色由酸鹼平衡自動計算。
物理：
- spring（k、hanger）：把 mass 掛上去，會依牛頓定律伸長並阻尼振盪，旁有直尺。讀值 id.extension（cm，平衡位置）、id.load（g）。
- pendulum（length，單位 m）：拖曳擺錘到角度後放開，旁有直尺與計次器；可加長或縮短擺長。讀值 id.length、id.angle、id.count。與 stopwatch 並用量週期。
- ramp（blocks、friction）：斜面加墊塊、放開小車通過兩個光閘，數據記錄器顯示 t、v。讀值 id.height、t1、t2、v1、v2、dt。
- circuit（parts="cell:6;switch;resistor:10;bulb:6;rheostat:20;ammeter;voltmeter"）：點接點接線、點導線拆除、點開關、拖變阻器旋鈕；以節點電壓法即時求解，燈泡亮度、電表讀數與電流流動會跟著變。讀值 id.A1、id.V1、id.Rh1、id.B1。
- optics（focal，單位 cm；lens、screen 起始位置）：拖曳透鏡與螢幕（或按住按鈕微調），螢幕上的像依薄透鏡公式清晰或模糊。讀值 id.lens、id.screen、id.sharp。
生物：
- microscope（specimen="onion" 或 "cheek"）：切換 ×4／×10／×40 物鏡、拖曳調焦旋鈕與玻片，視野依對焦程度模糊，附比例尺。讀值 id.mag、id.objective、id.focus、id.sharp、id.barum（比例尺 μm）。
所有器材都能用鍵盤與按鈕操作，手機上以點選加按鈕替代拖曳。`;

export const FEEDBACK_RULES = `回饋規則（讓路由知道學生怎麼學；每個互動模組都要做到）：
1. 每個錯誤選項寫 misconception="迷思id"，並用 feedback 一句話指出錯在哪；sk-card、sk-term、sk-blank、sk-pair 也一樣。sk-balance 會自動回報 unbalanced-equation 與 not-lowest-terms。數值題用 <sk-wrong value="常見錯誤值" misconception="…" feedback="…"> 列出常見錯誤。
2. 器材操作至少放一個 <sk-observe of="器材id.讀值" min max tag kind="evidence">，代表學生做到能展現理解的操作（例如液面進入目標範圍、顯微鏡對焦清楚 sharp=1）；操作順序或讀數錯誤等迷思用 sk-record 的 misconception，或 StudyKit.emit('observe',{tag:'迷思id',observed:'misconception'}) 回報。數學題靠 sk-wrong 的 misconception，不需要 observe。
3. 提供 <sk-hints>（2 到 3 層由淺到深）或 <sk-reveal>，提示與詳解的使用會被記錄。不要自己寫 postMessage 或 localStorage 計數，kit 自動回報 answer、hint、retry、step、observe、summary。
4. 一個模組至少有一個即時檢核（sk-choice 或 sk-numeric），並有 explain 說明為何正確。實驗模組另外用 sk-record 留下紀錄再檢核。
5. 每一題都要有 <sk-explain>，而且完整到學生只看它就能懂（步驟、原因、常見錯在哪）：同一題答錯兩次，元件會自動出現「看解答」，按下後顯示正解與這段解析，並記為一次提示，學生不會卡在題目上。`;

export const MODULE_KIT_PROMPT = `## STUDY 模組元件庫（${VERSION}）
互動模組用預先設計好的 <sk-*> 元件組裝，不要自己寫 CSS、控制項、postMessage 監聽或動畫；platform 自動注入樣式與腳本，輸出只需要標記加上最少的領域邏輯。仍須保留完整 HTML 文件與官方要求的 widget-config JSON，並引用 <meta viewport>。
${CHAPTER_FLOW}
${INTERACTION_RULES}
${POINTING_RULES}
器材 kind：beaker、flask、cylinder、testtube、burette、pipette、bottle、balance、thermometer、heater、stopwatch、phmeter、solid、mass、spring、pendulum、ramp、circuit、optics、microscope（屬性與讀值見 get_module_kit）。
${FEEDBACK_RULES}
元件：sk-module(heading,goal)；sk-split／sk-stack／sk-controls 版面；sk-lab(heading)+sk-item(kind,id,label,…) 虛擬實驗桌；sk-figure(label,caption) 內放 <svg>（只在器材清單沒有時）；sk-plot(id,heading,xmin,xmax,ymin,ymax,xlabel,ylabel)；sk-record(id,heading,min)+sk-col(name,label,unit,digits,low,high,misconception,feedback)；sk-readout(of 或 compute,label,unit,digits)；sk-tabs+sk-tab(heading)；sk-steps+sk-step(heading)；sk-reveal(label)；sk-hints+sk-hint；sk-choice(id,question,type)+sk-option(value,correct,misconception,feedback)+sk-explain；sk-numeric(id,question,answer,tolerance,unit)+sk-wrong；sk-order(id,question)+sk-item（可拖曳）；sk-match(id,question)+sk-pair(left,right)（點左再點右）；sk-sort(id,question)+sk-bucket(name,label)+sk-card(bucket,misconception,feedback)；sk-label(id,question)+<svg 部位加 data-part>+sk-term(part)；sk-pick(id,question,answer=部位名|部位名)+<svg>+sk-wrong(part)；sk-fill(id,question,distractors=詞|詞)+sk-text 內放 sk-blank(answer)；sk-balance(id,question,equation="H2 + O2 -> H2O")；sk-knob(name,label,min,max,step,value,unit)；sk-tune(id,question,compute,target,tolerance,unit,label)（內放 sk-knob 或 sk-slider）；sk-graph(id,question,points="x,y;x,y" 或 line="斜率,截距",xmin,xmax,ymin,ymax,step)+sk-wrong(points 或 line)；sk-table(id,question,rowhead)+sk-tr(head)（一列一個 sk-tr，格子用 | 分隔，[答案] 是學生要填的格）+sk-wrong(value)；sk-mark(id,question)+sk-text 內放 sk-hit（該選）與 sk-miss(misconception,feedback)（不該選）；sk-reflect(id,question,misconception)+sk-point（重點）+sk-explain（參考說法）；sk-flashcards(heading)+sk-flash(term)（內文是背面）；sk-steps 加 gated＝帶著做；sk-callout(kind,heading)；sk-progress；sk-observe(of,min,max,tag,kind)；sk-slider／sk-segmented／sk-toggle 視需要使用，不是預設。
手機一屏原則（畫面約 375×480，學生不該為了操作而一直捲動）：sk-lab 本身已為手機設計；實驗桌與紀錄表放不同的 <sk-tab>，題目也一題一個 <sk-tab heading="題 1">；不寫固定像素寬度、不橫向捲動、不自行 position:fixed。
設計：黑白灰與暖灰，只用元件內建 token，不加彩色、漸層或陰影。
${COURSE_CLOSING}`;

export const MODULE_KIT_EXAMPLE = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="application/json" id="widget-config">{"type":"simulation","concept":"water_displacement","description":"排水法量石塊體積","variables":[]}</script></head><body>
<sk-module heading="排水法量體積" goal="把石塊放進量筒，讀出水位，算出石塊體積。">
<sk-tabs>
<sk-tab heading="實驗桌"><sk-lab heading="排水法">
<sk-item kind="cylinder" id="cy" cap="100" liquid="water:0:50" label="量筒"></sk-item>
<sk-item kind="solid" id="st" volume="18" mass="48.6" label="石塊"></sk-item>
<sk-item kind="balance" id="bal"></sk-item>
</sk-lab><sk-hints><sk-hint>先讀放入前的水位，再把石塊拖進量筒。</sk-hint><sk-hint>讀刻度時視線與彎月面最低點同高。</sk-hint></sk-hints></sk-tab>
<sk-tab heading="紀錄"><sk-record id="rec" heading="實驗紀錄" min="2"><sk-col name="cy.volume" label="量筒水位" unit="mL" manual tol="1" low="40" high="100" misconception="read-wrong-scale" feedback="水位應在 50 到 100 mL 之間，再看一次刻度。"></sk-col></sk-record></sk-tab>
<sk-tab heading="檢核"><sk-numeric id="q-vol" question="依你的紀錄，石塊體積是多少？" answer="18" tolerance="1" unit="mL"><sk-wrong value="68" misconception="level-not-volume" feedback="68 是放入後的水位，不是石塊體積。"></sk-wrong><sk-explain>V = 68 − 50 = 18 mL。</sk-explain></sk-numeric></sk-tab>
</sk-tabs>
<sk-observe of="cy.volume" min="60" max="80" tag="dropped-stone"></sk-observe>
</sk-module></body></html>`;

export const MODULE_KIT_GUIDE = `# STUDY 模組元件庫與設計語言（${VERSION}）

## 為什麼用元件庫
每個互動模組由 <sk-*> 標記與少量領域腳本組成。樣式、控制項、鍵盤與觸控、動畫、老師操作（SET_WIDGET_STATE、HIGHLIGHT_ELEMENT、ANNOTATE_ELEMENT、REVEAL_ELEMENT）與學習回饋都由平台注入的 kit 處理，所以不要自己寫這些。輸出越短越省 token，視覺與互動也一致。

## 章節流程
${CHAPTER_FLOW}

${PRETEST_RULES}

${TEACH_FIRST_RULE}

${SLIDE_QUESTION_RULE}

## 互動規則
${INTERACTION_RULES}

## 虛擬器材
${LAB_CATALOG}

## 講解與指示
${POINTING_RULES}

${COURSE_CLOSING}

## 設計語言
- 與 STUDY 主程式同一套：中性黑白灰（背景 #fafafa、卡片白色 90%、hairline 邊線 slate-900/6%、墨色 #0f172a），主色是 #0a0a0a→#3f3f46 的漸層（深色模式反相）。不用彩色，只在對錯回饋用綠與玫瑰紅。
- 光影：卡片用 soft 陰影加頂部高光，懸浮用 lift，主要按鈕用 glow 與頂部 15% 白色高光；背景頂部有極淡光暈。不要自訂陰影。
- 字體 Geist／Inter／Noto Sans TC，標題用 Fraunces／Noto Serif TC，正文 16px、行高 1.7，數值 tabular-nums。圓角：按鈕與輸入 16px、卡片 24px（手機 20px），手機單欄，觸控目標至少 40px。
- 對與錯不只靠顏色：一律有 ✓／✗ 與文字。有可見的 focus 外框，鍵盤可操作，狀態變化會以 aria-live 唸出。

## 動態
- 控制回饋 160ms，指令轉換 260ms，教材揭露 460ms，場景切換 380ms，交錯最多 160ms。曲線 cubic-bezier(.22,1,.36,1)（先快後慢，與主程式的彈簧同節奏）。
- 按壓：按鈕縮到 0.97、卡片與選項縮到 0.99；桌機 hover 時選項上浮 1px 並加深陰影。分頁的白色指示塊會滑到選取的分頁。
- 事件依序連動：控制項 → 圖形與數值 → 教材區塊 → 進度。拖曳時圖形連續變化，不重新整頁。
- 減少動態偏好下動畫縮到 1ms，內容照常顯示。
- 動畫不推進教學，也不擋住操作。

## 元件參考
| 元件 | 用途與屬性 |
|---|---|
| sk-module | 根容器。heading、goal |
| sk-split / sk-stack / sk-controls | 兩欄（手機單欄）／垂直間距／控制面板 |
| sk-slider | 真實器材的連續量或確有必要時使用，不是預設。name、label、min、max、step、value、unit、digits。id 為 {name}-slider |
| sk-segmented + sk-option | 互斥選項。name、label；option 的 value |
| sk-toggle | 開關。name、label、checked |
| sk-readout | 即時數值。of=控制項名，或 compute=StudyKit.compute 的名稱；label、unit、digits。id 為 {名稱}-display |
| sk-lab + sk-item | 虛擬實驗桌（桌面 360×224 單位）與器材。sk-item：kind、id（讀值前綴）、label，其餘屬性依 kind（見虛擬器材）。器材的拖曳、物理與動畫都內建 |
| sk-figure | 一般圖解容器，內放 <svg viewBox>，label、caption。只在器材清單沒有時才自己畫，用 StudyKit.render 更新屬性 |
| sk-record + sk-col | 實驗紀錄表。sk-record：id、heading、min（至少幾筆）、max-rows（正整數，預設12）；sk-col：name（器材讀值，如 bur.reading，也接受數值分段選項）、label、unit、digits、low、high（合理範圍）、misconception、feedback、manual（學生自己輸入讀到的值，與器材真值差超過 tol 判為讀不準）。按「記錄這一筆」寫入，超出範圍標 ✗ 並回報答錯；StudyKit.records(id) 取得記錄列。已記錄數值與檢核狀態會隨模組進度還原，不重複回報作答 |
| sk-plot | 函式圖。id、heading、xmin/xmax/ymin/ymax、xlabel/ylabel；StudyKit.plot(id, [{fn:(x,v)=>y}] 或 {points:v=>[[x,y]]}) |
| sk-tabs + sk-tab | 分頁，heading；每頁維持一屏，探索與每一題各一頁。回報 step |
| sk-steps + sk-step | 逐步揭露，heading。回報 step。加 gated 屬性成為「帶著做」的例題：每個 sk-step 放一小題，答對或看過解答才能按下一步 |
| sk-reveal | 「不懂，拆開說明」展開詳解。label。回報 hint |
| sk-hints + sk-hint | 分層提示。回報 hint 與層級 |
| sk-choice + sk-option + sk-explain | 單選／複選（type）。option：value、correct、misconception、feedback。回報 answer、retry |
| sk-numeric + sk-wrong | 數值題。answer、tolerance、unit；sk-wrong：value、tolerance、misconception、feedback |
| sk-order + sk-item | 排序題，依正確順序書寫。可拖曳列，或點一列再點目標列，或用 ↑↓ 按鈕。可用 misconception、feedback |
| sk-match + sk-pair | 配對題，left、right，可加 misconception、feedback。點左邊再點右邊配對，已配對兩側出現相同編號，再點一次取消 |
| sk-sort + sk-bucket + sk-card | 分類題。sk-bucket：name、label；sk-card：bucket（正確分類 name）、misconception、feedback。拖曳卡片進分類，或點卡片再點分類。檢查後每張卡片標 ✓／✗ |
| sk-label + sk-term | 圖解標示。內放 <svg>，要標示的部位加 data-part="名稱"（圖上會自動出現編號圓點）；sk-term：part（正確部位）、misconception、feedback，可多放干擾名稱（不填 part 以外的對應就會錯）。拖曳名稱到圓點，或點名稱再點圓點 |
| sk-pick | 點選圖上的部位。內放 <svg>，部位加 data-part（可加 data-label 當無障礙名稱）；answer="a|b" 多選；sk-wrong：part、misconception、feedback；sk-explain |
| sk-fill + sk-text + sk-blank | 填空。sk-text 內的 sk-blank：answer、misconception、feedback；distractors="詞|詞" 增加干擾詞。拖曳或點詞填入空格 |
| sk-balance | 配平化學式。equation="H2 + O2 -> H2O"（支援括號，不支援電荷）；學生調整每個物質的係數，兩邊各元素原子數即時顯示 ✓／✗；要平衡且係數為最簡整數比才算對；sk-explain 顯示解說 |
| sk-knob | 旋鈕。name、label、min、max、step、value、unit、digits；拖曳旋轉、點 −／＋ 或用方向鍵調整，值寫入 StudyKit.values[name]，與 sk-slider 一樣可給 sk-readout、sk-observe、sk-tune 使用 |
| sk-tune | 調數值題。compute：StudyKit.compute 註冊的名稱（由目前所有控制項算出結果）；target、tolerance、unit、label；sk-wrong（value 為常見錯誤的結果）與 sk-explain；內放 sk-knob 或 sk-slider。即時顯示「目前結果」，按檢查比對 |
| sk-graph + sk-wrong | 座標圖作答。xmin、xmax、ymin、ymax（預設 −5 到 5）、step（格點間距，預設 1）、xlabel、ylabel。二選一：points="1,2;-2,0"（學生要標出這些點：點格線交點標點，再點一次移除，也可按「加一個點」後用方向鍵移動）；line="2,1"（斜率,截距：學生拖曳兩個控制點，或點控制點再點新位置，讓直線符合）。sk-wrong 用同樣的 points 或 line 寫常見錯誤，加 misconception、feedback；sk-explain 解說 |
| sk-table + sk-tr + sk-wrong | 完成表格。每列一個 <sk-tr>，格子用 | 分隔；第一列加 head 當表頭；寫成 [答案] 的格子變成輸入框（數字依 tolerance 比對，預設 0.01；文字不分大小寫與前後空白）。rowhead 讓每列第一格當列標題。sk-wrong：value（常見錯誤值）、misconception、feedback。手機上最多 4 欄 |
| sk-mark + sk-text + sk-hit + sk-miss | 在文字裡點出片段。sk-text 內把該選的片段包成 <sk-hit>，容易誤選的包成 <sk-miss misconception feedback>，兩者在作答前外觀相同；全部選對且沒有多選才算對。可用來找出解題過程中錯誤的步驟、找證據、辨認詞性或修辭 |
| sk-reflect + sk-point + sk-explain | 自我解釋。學生先寫下自己的說明（min：最少字數，預設 10；文字只留在頁面上，不會送出或被批改），按「對照參考說法」後才顯示 sk-explain 與每個 <sk-point> 重點，逐項勾選自己有寫到的；全部勾選才完成，漏掉時以 misconception 回報 |
| sk-flashcards + sk-flash | 術語字卡。heading；每張 <sk-flash term="正面">背面內容</sk-flash>。學生先回想、點卡片翻面，再選「記得」或「還不熟」，不熟的卡片排到最後再出現，全部記得才結束。不計入題目進度 |
| sk-callout | kind：note、warn、example、worked；heading |
| sk-progress | 依題目與步驟自動顯示進度 |
| sk-observe | 不可見。of、min、max、tag、kind=evidence|misconception、repeat。控制項進入範圍 0.7 秒後回報 |

## 手機版面（手機一屏原則）
kit 在手機寬度（700px 以下）自動切成單欄：圖形與圖表置頂並固定（高度上限約 34% 視窗），說明與標題縮小，觸控目標至少 40px。設計模組時用 375×480 檢查：
- 操作頁：sk-lab 實驗桌與它的操作按鈕放在同一個畫面，不需捲動就能操作；紀錄表與題目放在其他 sk-tab。一張桌放 2 到 4 個器材。
- 題目：一題一個 sk-tab，答題回饋會自動捲入畫面。練習不要和探索放在同一頁。
- 圖形放在 sk-split 的直接子層（或 sk-split 內的 sk-stack），手機上才會自動置頂。
- 不用固定像素寬度，不要橫向捲動。
- 完整手機規則（投影片重排、測驗、交付前 375×667 檢查）見 get_mobile_design_guide；頁面必須有 viewport meta，播放器才會用真實手機寬度顯示（元件庫已內建手機版面）。

## 領域腳本
StudyKit.records(id) 讀實驗紀錄、StudyKit.values 讀目前值（含器材讀值，如 StudyKit.values['bur.reading']）、StudyKit.emit('observe', {tag, observed}) 回報操作迷思；StudyKit.set(name, value)、StudyKit.compute(name, v=>number)、StudyKit.plot(id, series)、StudyKit.render(v=>void) 只用於自己畫的圖表與讀值。器材（sk-lab）的操作邏輯與動畫都內建，不要自己寫。

動態注意：sk-figure 內 SVG 的 transform 與 opacity 會被 kit 補間（260ms），所以跟著手指走的位置要改 x、y、cx、cy 或 points 屬性；落下、倒入、轉動等放開後的動作才改 transform。

${FEEDBACK_RULES}

## 回報給路由的事件
kit 以 postMessage 回報 answer（correct、misconception、attempt）、hint、retry、step、observe（evidence 或 misconception）、summary（總時間、操作、提示、答題數）。平台把它們換成路由訊號：答錯與 misconception、提示次數、重試次數、停留時間，用來決定下一步看補強版、精簡版或延伸版，以及解說詳盡程度。

${ROUTING_CONVENTION}

## 完整範例
${MODULE_KIT_EXAMPLE}
`;
