import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { taskPool } from "@/lib/study-mcp/store";
import { listTasks, McpQueryError } from "@/lib/study-mcp/tasks";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    try {
      return Response.json(await listTasks(await taskPool(), ownerId, new URL(request.url).searchParams), { headers });
    } catch (error) {
      if (!(error instanceof McpQueryError)) throw error;
      return Response.json({ error: error.message }, { status: 400, headers });
    }
  });
}
