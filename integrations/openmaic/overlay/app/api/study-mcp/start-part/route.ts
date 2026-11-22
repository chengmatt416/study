import { withRequestOwner } from "@/lib/server/identity/with-owner";
import { MAX_START_BODY_BYTES, parseRunInput, readJsonBody } from "@/lib/server/generation/run/input";
import { startGenerationRun, startRefusal } from "@/lib/server/generation/run/start";
import { runSnapshot } from "@/lib/server/generation/run/store";
import { partMarker, PartStartBusyError, startCoursePart } from "@/lib/study-mcp/start-part";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRequestOwner(request, async (principal, headers) => {
    const body = await readJsonBody(request, MAX_START_BODY_BYTES);
    if (!body.ok) return Response.json({ error: body.message }, { status: body.status, headers });
    const value = body.value as { part_id?: unknown; input?: Record<string, unknown> } | null;
    if (!value || typeof value.part_id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.part_id) || !value.input || typeof value.input !== "object" || Array.isArray(value.input) || typeof value.input.requirement !== "string" || !value.input.requirement.trim())
      return Response.json({ error: "Provide part_id and an official generation input" }, { status: 400, headers });
    const parsed = parseRunInput({ ...value.input, requirement: value.input.requirement + partMarker(value.part_id) });
    if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400, headers });
    try {
      const result = await startCoursePart(principal.ownerId, value.part_id, parsed.value, input => startGenerationRun(principal.ownerId, input, { principal, request, origin: "generation-runs" }));
      return Response.json({ run: runSnapshot(result.run), idempotent: result.idempotent }, { status: result.idempotent ? 200 : 202, headers });
    } catch (error) {
      if (error instanceof PartStartBusyError) return Response.json({ error: error.message, retryable: true }, { status: 409, headers });
      const refusal = startRefusal(error);
      if (!refusal) throw error;
      const response = Response.json({ error: refusal.message, code: refusal.code }, { status: refusal.status, headers });
      for (const [key, value] of refusal.headers ?? []) response.headers.append(key, value);
      return response;
    }
  });
}
