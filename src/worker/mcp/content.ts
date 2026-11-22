import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { SessionUser } from "../lib/types";
import { callApi } from "./internal";

export const CONTENT_WRITE_TOOLS = ["create_content_folder", "update_content_folder", "delete_content_folder", "organize_content"];

export function registerContentTools(server: McpServer, { env, ctx, user, scopes }: { env: Env; ctx: ExecutionContext; user: SessionUser; scopes: string[] }) {
  const tool = <S extends z.ZodObject>(name: string, description: string, schema: S, write: boolean, fn: (args: z.infer<S>) => Promise<unknown>) => {
    server.registerTool(name, { title: name, description, inputSchema: schema, annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false } }, (async (args: z.infer<S>) => {
      try {
        if (write && !scopes.includes("study:write")) throw new Error("此操作需要 study:write，請重新連線並允許寫入");
        return { content: [{ type: "text" as const, text: JSON.stringify(await fn(args), null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `錯誤：${(error as Error).message}` }], isError: true };
      }
    }) as never);
  };
  const api = (method: string, path: string, body?: unknown) => callApi(env, ctx, user, method, path, body);
  const id = z.string().min(1).max(200);
  const folderId = id.nullable().optional();
  tool("list_content", "分頁搜尋目前使用者有權讀取的所有教材（筆記／互動課堂、試卷、電子書、手冊、課綱、字卡）。view 可選 active、archived、all、starred；回傳精簡中繼資料與網址，不讀取教材全文。依 next_cursor 續接。folder_id=root 只列未分類。封存只影響本人，與垃圾桶分開。", z.object({
    view: z.enum(["active", "archived", "all", "starred"]).optional(), kind: z.enum(["note", "exam", "book", "booklet", "syllabus", "deck"]).optional(), folder_id: id.optional(), q: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(2000).optional(), sort: z.enum(["recent", "title"]).optional(),
  }), false, async (args) => {
    const query = new URLSearchParams(Object.entries(args).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return api("GET", `/api/content?${query}`);
  });
  tool("list_content_folders", "取得本人的資料夾樹（parent_id）、教材數量與子資料夾數。資料夾不改變教材原本權限。", z.object({}), false, () => api("GET", "/api/content/folders"));
  tool("create_content_folder", "建立本人的教材資料夾，可用 parent_id 放進已有資料夾。先讀 list_content_folders 避免建立重複結構。", z.object({ name: z.string().trim().min(1).max(120), parent_id: folderId }), true, (args) => api("POST", "/api/content/folders", args));
  tool("update_content_folder", "重新命名或移動本人的資料夾；parent_id=null 移到最上層，不允許循環。", z.object({ folder_id: id, name: z.string().trim().min(1).max(120).optional(), parent_id: folderId }), true, ({ folder_id, ...patch }) => api("PUT", `/api/content/folders/${encodeURIComponent(folder_id)}`, patch));
  tool("delete_content_folder", "刪除本人的空資料夾。必須先移出教材與子資料夾，不會刪除教材。", z.object({ folder_id: id }), true, ({ folder_id }) => api("DELETE", `/api/content/folders/${encodeURIComponent(folder_id)}`));
  tool("organize_content", "批次整理 1 到 100 份已存在的教材：folder_id 移至資料夾（null 取消分類）、archived=true 封存／false 取消封存、starred=true 收藏／false 取消收藏。省略欄位保留。先用 list_content 確認 type/id，全部通過存取驗證才執行；只影響本人，不刪除或改寫教材。", z.object({
    items: z.array(z.object({ type: z.enum(["document", "book", "deck"]), id })).min(1).max(100), folder_id: folderId, archived: z.boolean().optional(), starred: z.boolean().optional(),
  }), true, (args) => api("POST", "/api/content/bulk", args));
}
