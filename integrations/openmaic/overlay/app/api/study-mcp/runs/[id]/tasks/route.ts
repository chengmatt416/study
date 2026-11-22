import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { clearFinishedRunTasks } from "@/lib/study-mcp/start-part";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    const { id } = await context.params;
    const removed = await clearFinishedRunTasks(ownerId, id);
    return removed === null
      ? Response.json({ error: "Only a finished run's tasks can be cleared" }, { status: 409, headers })
      : Response.json({ removed }, { headers });
  });
}
