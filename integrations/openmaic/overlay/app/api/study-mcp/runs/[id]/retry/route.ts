import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { readJsonBody } from "@/lib/server/generation/run/input";
import {
  readGenerationRunWithMedia,
  retryGenerationRun,
} from "@/lib/server/generation/run/store";
import { generationRunConfig } from "@/lib/server/generation/run/config";
import { wakeGenerationRunner } from "@/lib/server/generation/run/runner";
import { taskPool } from "@/lib/study-mcp/store";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withRequestOwner(request, async ({ ownerId }, headers) => {
    const { id } = await context.params;
    const body = await readJsonBody(request, 4096);
    const commandId =
      body.ok &&
      typeof body.value === "object" &&
      body.value !== null &&
      "commandId" in body.value
        ? body.value.commandId
        : null;
    if (
      typeof commandId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(commandId)
    )
      return Response.json(
        { error: "Provide a stable commandId for this retry" },
        { status: 400, headers },
      );
    const current = await readGenerationRunWithMedia(id, ownerId);
    if (!current)
      return Response.json(
        { error: "Run not found" },
        { status: 404, headers },
      );
    const pool = await taskPool();
    if (current.run.state !== "paused") {
      const prior = await pool.query(
        "SELECT last_command FROM study_mcp_epochs WHERE owner_id=$1 AND run_id=$2",
        [ownerId, id],
      );
      if (prior.rows[0]?.last_command === commandId)
        return Response.json({ accepted: true, idempotent: true }, { headers });
      return Response.json(
        { error: "Only a paused run can be retried" },
        { status: 409, headers },
      );
    }
    await pool.query(
      `INSERT INTO study_mcp_epochs(owner_id,run_id,epoch,last_command) VALUES ($1,$2,1,$3) ON CONFLICT(owner_id,run_id) DO UPDATE SET epoch=study_mcp_epochs.epoch+1,last_command=excluded.last_command WHERE study_mcp_epochs.last_command<>excluded.last_command`,
      [ownerId, id, commandId],
    );
    const result = await retryGenerationRun(
      id,
      ownerId,
      { commandId },
      { maxActiveRunsPerOwner: generationRunConfig().maxActiveRunsPerOwner },
    );
    wakeGenerationRunner();
    return Response.json({ accepted: true, result }, { headers });
  });
}
