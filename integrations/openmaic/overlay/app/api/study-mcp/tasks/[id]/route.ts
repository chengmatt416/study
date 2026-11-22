import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { readJsonBody } from "@/lib/server/generation/run/input";
import { McpSubmissionError, submitTask, taskPool, validOutput } from "@/lib/study-mcp/store";
import { McpQueryError, taskContext } from "@/lib/study-mcp/tasks";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    try {
      const task = await taskContext(await taskPool(), ownerId, (await context.params).id, new URL(request.url).searchParams);
      return task ? Response.json(task, { headers }) : Response.json({ error: "Task not found" }, { status: 404, headers });
    } catch (error) {
      if (!(error instanceof McpQueryError)) throw error;
      return Response.json({ error: error.message }, { status: 400, headers });
    }
  });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    const { id } = await context.params;
    const body = await readJsonBody(request, 2_100_000);
    if (!body.ok)
      return Response.json(
        { error: body.message },
        { status: body.status, headers },
      );
    const value = body.value as {
      expected_version?: number;
      output?: unknown;
      validation_receipt?: string;
    } | null;
    if (
      !Number.isSafeInteger(value?.expected_version) ||
      (value?.output === undefined ? typeof value?.validation_receipt !== "string" || !/^[a-f0-9]{64}$/.test(value.validation_receipt) : !validOutput(value.output))
    )
      return Response.json(
        {
          error:
            "Provide expected_version and validation_receipt, or a complete output for a legacy task",
        },
        { status: 400, headers },
      );
    let saved;
    try { saved = await submitTask(
      await taskPool(),
      ownerId,
      id,
      value!.expected_version!,
      value!.output as Parameters<typeof submitTask>[4],
      value!.validation_receipt,
    ); } catch (error) {
      if (!(error instanceof McpSubmissionError)) throw error;
      return Response.json({ error: "The model turn did not pass pre-submission verification; correct it and resubmit the same version", errors: error.errors }, { status: 422, headers });
    }
    if (!saved)
      return Response.json(
        {
          error:
            "Task not found, answered or version changed. Read pending tasks again.",
        },
        { status: 409, headers },
      );
    return Response.json(
      {
        id: saved.id,
        version: saved.version,
        status: saved.status,
        next_action:
          "Continue polling the official core for its next model turn or completed classroom.",
      },
      { headers },
    );
  });
}
