# STUDY

STUDY 是可自行架設的學習平台，提供 PDF 閱讀與標注、重點整理協作、模擬試題、間隔複習字卡、寫作練習與數學工具。可另外接上 MCP 和 OpenMAIC 互動課程。

此儲存庫提供原始碼、資料庫結構及合成測試資料。新安裝的使用者、科目、教材與學習紀錄都是空的。

## 介面截圖

![STUDY 桌面首頁，顯示字卡進度、考試範圍、閱讀與最近更新](docs/screenshots/home.png)

*截圖使用虛構教材與學習紀錄。*

## 本機開發

需要 Node.js 24 與 npm。先安裝依賴並建立本機資料庫。

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

開啟 http://localhost:5173，在登入頁用 `.dev.vars` 中的 `BOOTSTRAP_ADMINS` 信箱登入。範例帳號只用於本機，首次登入時才建立。登入後可從「管理後台 → 科目」新增科目，再匯入自己的教材。部署時請使用自己的管理員信箱並產生獨立的 `SESSION_PEPPER`。

```sh
npm test
npm run build
```

## 自行部署

在自己的 Cloudflare 帳號建立 D1、KV 與 R2，並將資源名稱及識別碼填入 `wrangler.jsonc`。將 `PUBLIC_ORIGIN` 設為你的 HTTPS 網址，`BOOTSTRAP_ADMINS` 設為你的管理員信箱，保持 `DEV_LOGIN=0`。將 Google OAuth 的回呼網址設為 `<PUBLIC_ORIGIN>/api/auth/google/callback`，並以 Wrangler secrets 設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 和 `SESSION_PEPPER`。套用遷移後即可部署。[Wrangler 設定](https://developers.cloudflare.com/workers/wrangler/configuration/)

```sh
npm run db:migrate:remote
npm run deploy
```

- 互動課程需要另外部署 OpenMAIC Workers，詳見 [OpenMAIC 整合](integrations/openmaic/README.md)。
- GeoGebra 和 Qalculate! 的執行檔需自行準備，`npm run vendor` 提供下載與建置流程。請依各自授權使用。[GeoGebra 授權](https://www.geogebra.org/license) · [Qalculate! 專案](https://github.com/Qalculate/libqalculate)
- 部署者應依實際服務設定更新 `src/web/pages/Legal.tsx` 的隱私權政策與使用條款。

## 授權

STUDY 原始碼採用 [MIT 授權](LICENSE)。第三方軟體及資產沿用其各自授權。[OpenMAIC 上游授權](integrations/openmaic/LICENSE.upstream)
