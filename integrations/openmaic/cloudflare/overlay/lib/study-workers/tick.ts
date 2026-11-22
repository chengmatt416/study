import { taskPool } from "@/lib/study-mcp/store";
import { workersScope } from "./context";
import { generationRunConfig } from "@/lib/server/generation/run/config";
import { claimNextGenerationRun, confirmDueGenerationRunOutlines, releaseGenerationRunLease } from "@/lib/server/generation/run/store";
import { runClaimedGenerationRun } from "@/lib/server/generation/run/runner";
import { defaultRunStepServices } from "@/lib/server/generation/run/services";
import { getAgentSessionStore } from "@/lib/server/agent-runtime/store";
import { runSession, WORKER_ID, type RunContext } from "@/lib/server/agent-runtime/runner";
import { agentRuntimeConfig } from "@/lib/server/agent-runtime/config";
import { runNextOwnerMaterialExtraction } from "@/lib/server/materials/extraction";
import { runNextMaterialExtraction } from "@/lib/server/material-extraction/runner";
import { runNextOwnerExtraction } from "@/lib/server/material-extraction/owner-extraction";
import { getAgentSessionMaterialStore } from "@/lib/server/agent-runtime/session-materials";
import { getServerPersistenceProvider } from "@/lib/persistence/server-provider";

const pending = (id: string) => `EXISTS (SELECT 1 FROM study_mcp_tasks t WHERE t.run_id=${id} AND t.status='pending' AND t.source LIKE '%:epoch-' || COALESCE((SELECT e.epoch FROM study_mcp_epochs e WHERE e.owner_id=t.owner_id AND e.run_id=t.run_id),0)::text)`;

/** Run original core work until its next durable model wait, then release execution. */
export async function tick() {
  const scope = workersScope.getStore();
  if (!scope?.alarm) throw new Error("Only a Durable Object alarm may execute core jobs");
  const pool = await taskPool();
  const config = generationRunConfig();
  const workerId = `workers:${crypto.randomUUID()}`;
  let worked = await runNextOwnerMaterialExtraction(workerId, { leaseTtlMs: config.leaseTtlMs, heartbeatIntervalMs: config.heartbeatIntervalMs });
  worked = await runNextMaterialExtraction(await getAgentSessionMaterialStore(), workerId) || worked;
  worked = await runNextOwnerExtraction({ persistence: await getServerPersistenceProvider(process.env.DATABASE_URL ?? "") }) || worked;
  await confirmDueGenerationRunOutlines();
  const candidates = await pool.query<{ id: string }>(`SELECT g.id FROM generation_runs g WHERE g.state NOT IN ('completed','ended','paused','awaiting_outline_confirmation') AND NOT ${pending("g.id")} ORDER BY g.updated_at LIMIT 1`);
  if (candidates.rows[0]) {
    const claim = await claimNextGenerationRun(workerId, { runId: candidates.rows[0].id, leaseTtlMs: config.leaseTtlMs, maxTakeovers: config.maxTakeovers });
    if (claim) {
      worked = true;
      const abort = new AbortController();
      try {
        await workersScope.run({ ...scope, suspend: () => { const error = new DOMException("Waiting for durable MCP input", "AbortError"); abort.abort(error); throw error; } },
          () => runClaimedGenerationRun(claim, defaultRunStepServices, abort, config.heartbeatIntervalMs));
      } finally { await releaseGenerationRunLease(claim.lease, { undoTakeover: true }); }
    }
  }
  const store = await getAgentSessionStore();
  const sessions = await pool.query<{ id: string; replies: string }>(`SELECT s.id,(SELECT COUNT(*) FROM study_mcp_tasks t WHERE t.run_id=s.id AND t.status='answered')::text AS replies FROM agent_sessions s WHERE s.deleted_at IS NULL AND s.status IN ('queued','running') AND (s.cancel_requested_at IS NOT NULL OR NOT ${pending("s.id")}) ORDER BY s.created_at LIMIT 1`);
  if (sessions.rows[0]) {
    const row = sessions.rows[0];
    const meta = await store.claimNextSession(WORKER_ID, 0, { sessionId: row.id, leaseTtlMs: agentRuntimeConfig.leaseTtlMs, maxAttempts: agentRuntimeConfig.maxAttempts + Number(row.replies) });
    if (meta) {
      worked = true;
      const context: RunContext = { running: new Map(), shuttingDown: false };
      await workersScope.run({ ...scope, suspend: () => {
        context.shuttingDown = true;
        const error = new DOMException("Waiting for durable MCP input", "AbortError");
        for (const run of context.running.values()) run.abort.abort(error);
        throw error;
      } }, () => runSession(context, meta));
    }
  }
  const countdown = await pool.query<{ due: string | null }>("SELECT MIN(outline_auto_confirm_at)::text AS due FROM generation_runs WHERE state='awaiting_outline_confirmation'");
  let maintained = false;
  if (scope.maintenance) {
    try { const { maintain } = await import('./maintenance'); await maintain(); maintained = true; }
    catch (error) { console.error('Core maintenance failed; retrying at the next scheduled wake', error); }
  }
  return { worked, more: worked, maintained, nextAlarm: countdown.rows[0]?.due ? new Date(countdown.rows[0].due).getTime() : undefined };
}
