import { VisibilityPicker } from "../../components/VisibilityPicker";
import { useUser } from "../../lib/auth";
import type { Visibility } from "../../../shared/visibility";
import { useState } from "react";
import { Link } from "react-router";
import { buildCoursePrompt } from "../../../shared/openmaic";
import { Button, inputCls, toast } from "../../components/ui";
import { McpConnect } from "../ai/McpConnect";

export function CourseSetup({ title = "", slug }: { title?: string; slug?: string }) {
  const user = useUser();
  const [visibility, setVisibility] = useState<Visibility>(user.access?.features.shared_write === false ? "private" : "shared");
  const chosenVisibility = user.access?.features.shared_write === false ? "private" : visibility;
  const [topic, setTopic] = useState(title);
  const prompt = buildCoursePrompt(topic.trim() || "請填入課程主題", slug) + (!slug ? `\n建立重點整理時務必傳入 visibility="${chosenVisibility}"，整份互動課程沿用該可見範圍。` : "");
  return <div className="space-y-4">
    <div>
      <h2 className="text-xl font-semibold">用完整 OpenMAIC core 建立課堂</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">在已連接 STUDY MCP 的 chatbot 貼上指令。官方 core 負責生成管線、場景編譯與完整課堂；每個模型回合交給目前 chatbot 經 MCP 回答，可跨多次對話續接。大型課程自動採分冊流程，逐冊保留來源、生成並覆核；每冊最多 45,000 字元來源與 100 個場景。使用你現有的帳號與用量，不呼叫模型 API。</p>
    </div>
    <label className="block text-sm font-medium">課程主題<input className={`${inputCls} mt-2 w-full`} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：化學平衡與勒沙特列原理" /></label>
    {!slug && <VisibilityPicker value={visibility} onChange={setVisibility} />}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!topic.trim()} onClick={() => navigator.clipboard.writeText(prompt).then(() => toast("已複製，請貼到已連接 MCP 的 chatbot")).catch(() => toast("無法複製，請選取下方指令手動複製", "err"))}>複製課程生成指令</Button>
      <Link to="/ai" className="text-sm underline underline-offset-4">前往 AI 工作室</Link>
    </div>
    <p className="text-sm leading-6 text-slate-500">生成風格以黑、白、灰為主，可搭配克制光暈；先測決定學習起點，每章先教學、再互動、再檢核；答錯可回頭釐清，理解後才進下一章。</p>
    <details>
      <summary className="cursor-pointer text-sm text-slate-500">查看生成指令</summary>
      <textarea aria-label="課程生成指令" readOnly value={prompt} className={`${inputCls} mt-2 min-h-64 w-full text-sm`} />
    </details>
    <details>
      <summary className="cursor-pointer text-sm text-slate-500">設定 MCP 連線（首次使用）</summary>
      <div className="mt-3"><McpConnect /></div>
    </details>
    <p className="text-xs leading-5 text-slate-500">官方 core 需先啟動。課堂中的教師提問與多代理工具回合也經 MCP 處理；未連接 chatbot 時會保留待回答任務，不會冒充即時 AI 回覆。</p>
  </div>;
}
