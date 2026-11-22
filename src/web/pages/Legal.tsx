// 隱私權政策與服務條款（公開頁面，不需登入；Google OAuth 同意畫面需要這兩個網址）
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Scales, ShieldCheck } from "@phosphor-icons/react";
import { api } from "../lib/api";
import { Markdown } from "../components/Markdown";
import { Reveal } from "../components/ui";
import { Wordmark } from "../layouts/Shell";

const EFFECTIVE = "2026 年 10 月 4 日";

function useContact() {
  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ appName: string; contactEmail?: string }>("/api/auth/config"), staleTime: Infinity });
  return data?.contactEmail ? `[${data.contactEmail}](mailto:${data.contactEmail})` : "網站管理員";
}

function LegalLayout({ title, icon, md }: { title: string; icon: React.ReactNode; md: string }) {
  return (
    <div className="min-h-full">
      <header className="glass sticky top-0 z-10 border-x-0 border-t-0">
        <div className="safe-top mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/" aria-label="回首頁">
            <Wordmark />
          </Link>
          <nav className="ml-auto flex gap-1 text-sm">
            <Link to="/privacy" className="rounded-xl px-3 py-1.5 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10">
              隱私權政策
            </Link>
            <Link to="/terms" className="rounded-xl px-3 py-1.5 text-slate-600 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10">
              服務條款
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
        <Reveal>
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-600">
            <ArrowLeft size={16} /> 返回
          </Link>
          <div className="mb-2 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-aurora text-on-accent shadow-[var(--shadow-glow)]">{icon}</span>
            <h1 className="font-display text-3xl font-semibold md:text-4xl">{title}</h1>
          </div>
          <p className="mb-8 text-sm text-slate-500">生效日期：{EFFECTIVE}</p>
          <div className="hairline rounded-[28px] bg-white/90 p-6 shadow-[var(--shadow-soft)] md:p-10 dark:bg-ink-900/80">
            <Markdown md={md} />
          </div>
        </Reveal>
      </main>
    </div>
  );
}

export function Privacy() {
  const contact = useContact();
  const md = `STUDY（以下稱「本服務」）是一個僅供授權成員使用的非商業學習平台。本政策說明我們蒐集哪些資料、如何使用與保護，以及你擁有的權利。本服務依中華民國《個人資料保護法》處理個人資料。

## 1. 我們蒐集的資料

:::note[帳號資料（透過 Google 登入取得）]
- 姓名、電子郵件地址、大頭貼網址、Google 帳號識別碼
- 我們只要求 \`openid\`、\`email\`、\`profile\` 三項基本權限，**不會**讀取你的 Gmail、雲端硬碟、聯絡人或任何其他 Google 資料
:::

**學習紀錄**（為提供功能而產生）：
- 電子書閱讀進度、書籤、你建立的標注（螢光、手寫、便利貼）
- 字卡複習紀錄與排程狀態
- 模擬試題的作答內容、成績與自評分數
- 你對重點整理、試題、字卡的編輯與修訂紀錄（含修訂者與時間）

**技術資料**：
- 登入工作階段（session）的雜湊值、瀏覽器 User-Agent、建立與到期時間
- 管理操作的稽核紀錄（例如新增成員、刪除內容）
- 伺服器錯誤日誌（由 Cloudflare 平台產生）

## 2. 資料用途

- 驗證身分並確認你在授權名單中
- 提供閱讀、標注、複習排程、自動批改、共同編輯等功能
- 在共同編輯的內容上標示修訂者，讓其他成員了解內容變更
- 維護系統安全、除錯與防止濫用

我們**不會**將你的資料用於廣告、**不會**販售或出租給任何人，也**不使用**第三方追蹤或分析工具。

## 3. 誰看得到你的資料

| 資料 | 可見範圍 |
| --- | --- |
| 姓名、大頭貼 | 其他成員（例如共同編輯時的修訂者、分享的標注） |
| 你設為「分享」的標注 | 所有成員 |
| 私人標注、閱讀進度、字卡紀錄、作答與成績 | 僅你本人；管理員可看到彙整後的題目答對率 |
| 電子郵件、最後登入時間 | 管理員 |

## 4. 第三方服務

| 服務 | 用途 | 傳送的資料 |
| --- | --- | --- |
| Google（OAuth） | 登入驗證 | 依 Google 登入流程 |
| Cloudflare（Workers、D1、R2、Durable Objects） | 主機、資料庫、檔案儲存 | 本服務所有資料皆儲存於 Cloudflare |
| Google Fonts | 載入網頁字型 | 你的 IP 位址與瀏覽器資訊（由瀏覽器直接連線） |
| Google NotebookLM | 成員匯入字卡時，由伺服器讀取公開分享連結 | 僅該分享連結，不含你的個人資料 |

GeoGebra 與 Qalculate! 計算機皆自架於本服務，使用時**不會**將資料傳送給其開發者。

## 5. Cookie 與本機儲存

- **必要 Cookie**：僅一個 \`__Host-sid\` 登入工作階段 Cookie（HttpOnly、Secure、SameSite=Lax），有效 30 天，用於維持登入。我們不使用廣告或追蹤 Cookie。
- **瀏覽器本機儲存**（localStorage、IndexedDB、Service Worker 快取）：儲存深色模式偏好、計算機歷史紀錄、離線複習佇列與作答暫存，以及讓 App 可離線使用的快取。這些資料只存在你的裝置上，可透過清除瀏覽器資料刪除。

## 6. 保存期間

- 登入工作階段：最長 30 天，登出或被移出授權名單時立即失效
- 學習紀錄與編輯紀錄：在你仍為成員期間保存，以維持功能與修訂歷史
- 被移出授權名單後，你將無法登入；如需刪除資料，請依第 8 節提出

## 7. 資料安全

- 全程使用 HTTPS 加密傳輸
- 登入憑證不以明文儲存（僅保存雜湊值）
- 上傳的檔案不公開，每次存取皆需驗證登入身分
- 所有 API 皆依角色權限檢查

沒有任何系統能保證百分之百安全；若發生可能影響你權益的資料外洩事件，我們會儘速通知。

## 8. 你的權利

依《個人資料保護法》第 3 條，你可以請求：

1. 查詢或閱覽你的個人資料
2. 製給複製本
3. 補充或更正
4. 停止蒐集、處理或利用
5. 刪除

請聯絡 ${contact} 提出請求，我們會在合理期間內處理。請注意：刪除帳號後，你在共同編輯內容中的修訂仍會保留於文件中（作者欄位將匿名化），以維持其他成員內容的完整性。

## 9. 未成年使用者

本服務的使用者可能包含未滿 18 歲的學生。未成年人應在法定代理人（家長或監護人）知悉並同意下使用本服務。法定代理人可依第 8 節代為行使權利。

## 10. 政策變更

本政策如有修改，會更新本頁的生效日期。

## 11. 聯絡我們

如對本政策有任何疑問，請聯絡 ${contact}。`;
  return <LegalLayout title="隱私權政策" icon={<ShieldCheck size={26} weight="fill" />} md={md} />;
}

export function Terms() {
  const contact = useContact();
  const md = `歡迎使用 STUDY（以下稱「本服務」）。使用本服務即表示你同意以下條款；如不同意，請勿使用。

## 1. 服務性質

本服務是一個**非商業性**的學習平台，提供電子書閱讀與標注、數學計算工具、重點整理、模擬試題自動批改與字卡複習等功能。本服務不收取任何費用，也不提供任何付費功能。

## 2. 使用資格與帳號

- 僅限經管理員加入**授權名單**的 Google 帳號使用。
- 你應妥善保管自己的 Google 帳號，並對以你帳號進行的所有操作負責。
- 不得將帳號借予他人，或協助未經授權者存取本服務。
- 未成年人應在法定代理人同意下使用。

## 3. 教材與著作權

:::warning[重要]
本服務中的電子書等教材可能受著作權保護，僅供**已合法取得該教材**之成員作為**個人學習**用途參考。
:::

你同意：
- 不得下載、複製、截圖散布、轉傳或以任何方式將教材提供給授權名單以外的人；
- 不得將教材或本服務內容用於任何商業目的；
- 不得上傳你無權使用或分享的內容。

如權利人認為本服務中的內容侵害其權利，請聯絡 ${contact}，我們會儘速處理並移除相關內容。

## 4. 共同編輯與成員內容

- 授權成員可以新增及修訂重點整理、模擬試題與字卡。你提交的內容會以你的名義顯示，並保留於修訂歷史中。
- 你提交內容時，即授權本服務及其他成員在本服務內為學習目的使用、顯示、修改該內容。你仍保有你原創內容的權利。
- 修訂內容在管理員確認前會以螢光標示；管理員有權接受、回復或移除任何修訂。
- 試題答案的修改需經管理員核准後才會生效。

## 5. 使用規範

你不得：
- 張貼違法、侵權、騷擾、歧視或不當內容；
- 故意破壞他人編輯的內容或刪除他人的學習成果；
- 嘗試未經授權存取系統、他人帳號或資料，或干擾服務運作；
- 以自動化方式大量存取本服務。

違反者，管理員得移除相關內容，並將帳號移出授權名單。

## 6. 第三方軟體與授權

本服務整合下列開源或第三方軟體，各依其授權條款使用：

| 軟體 | 授權 |
| --- | --- |
| GeoGebra | 原始碼 EUPL-1.2；應用程式依 [GeoGebra 授權](https://www.geogebra.org/license)僅限非商業用途。Made with GeoGebra® |
| Qalculate!（libqalculate） | GNU GPL v2 或更新版本 |
| PDF.js | Apache License 2.0 |
| KaTeX、CodeMirror、Yjs、ts-fsrs 等 | MIT 或相容授權 |

「字卡連結匯入」功能會讀取 Google NotebookLM 的**公開分享連結**。此功能並非 Google 官方提供的介面，Google 變更服務時可能暫時無法使用；本服務與 Google 並無合作或隸屬關係。

## 7. 免責聲明

- 本服務以「現況」提供，不保證無中斷、無錯誤。
- **自動批改**、計算機結果、字卡排程與重點整理內容可能有誤，僅供學習參考，不代表任何考試的正式評分標準或正確答案。請以老師及官方教材為準。
- 對於因使用或無法使用本服務所生之損害（包括資料遺失、成績影響等），在法律允許的最大範圍內，本服務不負賠償責任。建議重要內容自行備份。

## 8. 服務變更與終止

我們得隨時修改、暫停或終止本服務的全部或部分功能。管理員得隨時將任何帳號移出授權名單。

## 9. 條款修改

本條款如有修改，會更新本頁的生效日期。修改後你繼續使用本服務，即視為同意修改後的條款。

## 10. 準據法

本條款依中華民國法律解釋與適用。

## 11. 聯絡我們

如對本條款有任何疑問，請聯絡 ${contact}。相關個人資料的處理方式請參閱[隱私權政策](/privacy)。`;
  return <LegalLayout title="服務條款" icon={<Scales size={26} weight="fill" />} md={md} />;
}
