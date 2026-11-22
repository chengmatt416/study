// 「連接 AI」：顯示 MCP server 網址與各 AI 用戶端的設定步驟
import { useQuery } from "@tanstack/react-query";
import { Copy, Plugs } from "@phosphor-icons/react";
import { api } from "../../lib/api";
import { Button, Card, toast } from "../../components/ui";

const CLIENTS: { name: string; steps: string[] }[] = [
  { name: "Claude（網頁 / 桌面 / 手機）", steps: ["設定 → Connectors（連接器）→ Add custom connector", "名稱填 STUDY，網址貼上下方 MCP 網址", "按 Connect，在跳出的 STUDY 頁面登入並按「允許」"] },
  { name: "ChatGPT", steps: ["設定 → Apps & Connectors → 進階設定開啟 Developer mode", "Create → 填入名稱 STUDY 與 MCP 網址，驗證方式選 OAuth", "連線時在 STUDY 頁面登入並允許"] },
  { name: "Claude Code / Cursor / VS Code", steps: ["新增 HTTP（Streamable HTTP）類型的 MCP server，網址為下方 MCP 網址", "Claude Code 可執行：claude mcp add --transport http study <MCP 網址>", "首次使用時會開啟瀏覽器登入 STUDY 並授權"] },
];

export function McpConnect() {
  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ mcpUrl?: string }>("/api/auth/config"), staleTime: Infinity });
  const url = data?.mcpUrl ?? `${location.origin}/mcp`;
  return (
    <Card className="p-5 md:p-8">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-ink-900 text-white dark:bg-white dark:text-ink-900">
          <Plugs size={22} weight="fill" />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">連接 AI（MCP）</h2>
          <p className="text-sm text-slate-500">讓 Claude、ChatGPT 等 AI 直接讀取你的內容，並建立重點整理、試題、字卡</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-2xl bg-ink-100 p-2 pl-4 dark:bg-white/5">
        <code className="min-w-0 flex-1 truncate text-sm">{url}</code>
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            navigator.clipboard
              .writeText(url)
              .then(() => toast("已複製 MCP 網址"))
              .catch(() => toast("無法複製，請手動選取", "err"))
          }
        >
          <Copy size={16} /> 複製
        </Button>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {CLIENTS.map((c) => (
          <div key={c.name} className="rounded-2xl border border-black/5 p-4 dark:border-white/10">
            <div className="mb-2 text-sm font-semibold">{c.name}</div>
            <ol className="list-decimal space-y-1 pl-4 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="mt-5 text-xs leading-5 text-slate-500">
        <p>可用工具：平台總覽、搜尋、讀取書架 PDF／學期課綱／重點整理／試題／字卡、我的學習進度、格式規格、驗證試題、建立/修訂重點整理、建立試題（含答案）、建立字卡組/新增卡片、匯入 NotebookLM 字卡、OpenMAIC 課程規格、讀取/驗證/儲存互動課程、讀取段考與修改單科段考範圍（管理員及寫入授權）。</p>
        <p className="mt-1">OpenMAIC 使用完整官方 core 生成、編譯與執行課堂；模型回合交給目前 chatbot 經 MCP 多步完成。官方工具與場景由 core 執行，不需要模型 API key，對話中斷後可續接。</p>
        <p className="mt-1">可讓 chatbot 依學年度／學期查詢 syllabus，並直接取得有權存取的課綱或書架 PDF，不需另行上傳：完整檔案透過 10 分鐘有效連結下載，小檔可用 MCP 內嵌讀取；實際 PDF 解析能力取決於使用的 chatbot。</p>
        <p className="mt-1">授權時可只勾選「讀取」。AI 新增或修改的內容會以你的名義記錄並以螢光標示；成員設定的試題答案仍需管理員核准。被移出授權名單後連線立即失效。</p>
      </div>
    </Card>
  );
}
