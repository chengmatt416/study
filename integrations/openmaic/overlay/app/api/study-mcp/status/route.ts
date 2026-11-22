export const runtime = "nodejs";
export async function GET() {
  return Response.json({
    engine: "OpenMAIC",
    version: "1.3.0",
    commit: "fe2cf7dade345f4eaaf9afb1771e6734e17edaab",
    transport:
      process.env.OPENMAIC_MCP_MODE === "1" ? "study-mcp/v1" : "disabled",
    generation: "official",
    compiler: "official",
    classroom: "official",
    capabilities: { task_summary: true, task_context_paging: true, task_cursor_paging: true, context_chunk_chars: CONTEXT_CHUNK_CHARS, max_context_bytes: MAX_CONTEXT_BYTES, verification: MODEL_WORKFLOW.protocol, preflight: true, exact_output_receipt: true, receipt_only_submit: true, read_before_validate: true, distinct_review_evidence: true },
  });
}
import { CONTEXT_CHUNK_CHARS, MAX_CONTEXT_BYTES, MODEL_WORKFLOW } from "@/lib/study-mcp/workflow";
