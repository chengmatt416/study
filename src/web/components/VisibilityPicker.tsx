import type { Visibility } from "../../shared/visibility";
import { useUser } from "../lib/auth";
import { inputCls } from "./ui";

export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (value: Visibility) => void }) {
  const user = useUser();
  const sharedWrite = user.access?.features.shared_write !== false;
  return <label className="block text-sm font-medium">可見範圍<select aria-label="可見範圍" className={inputCls + " mt-2"} value={sharedWrite ? value : "private"} onChange={(e) => onChange(e.target.value as Visibility)}>
    <option value="private">私人 · 僅自己可見</option><option value="shared" disabled={!sharedWrite}>共享 · 有權限的成員可見</option>
  </select><span className="mt-2 block text-xs leading-relaxed font-normal text-slate-500 dark:text-slate-400">{sharedWrite ? "私人內容不會出現在其他使用者的搜尋或 MCP 中。建立後，擁有者可在內容頁用一個按鈕改為私人或共享。" : "你的群組已停用共享寫入；仍可建立、編輯與使用自己的私人內容。"}</span></label>;
}
