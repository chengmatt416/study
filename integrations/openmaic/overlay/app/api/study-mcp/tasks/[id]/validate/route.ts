import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { readJsonBody } from "@/lib/server/generation/run/input";
import { taskPool, validateTask, validOutput } from "@/lib/study-mcp/store";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    const body = await readJsonBody(request, 2_100_000);
    if (!body.ok) return Response.json({ error: body.message }, { status: body.status, headers });
    const value = body.value as { expected_version?: number; output?: unknown } | null;
    if (!Number.isSafeInteger(value?.expected_version) || value!.expected_version! < 1 || !validOutput(value?.output))
      return Response.json({ error: "Provide positive expected_version and a complete output" }, { status: 400, headers });
    const report = await validateTask(await taskPool(), ownerId, (await context.params).id, value!.expected_version!, value!.output!);
    return report ? Response.json(report, { headers }) : Response.json({ error: "Task not found, answered, superseded by retry, or version changed" }, { status: 409, headers });
  });
}
