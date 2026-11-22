import { workersEnvironment } from '@/lib/study-workers/context';
export interface NotifyQueryable { query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }
export const AGENT_EVENT_NOTIFY_CHANNEL = 'openmaic_agent_event_wakeup';
export const AGENT_EVENT_PROBE_CHANNEL = 'openmaic_agent_event_selfcheck';
export const AGENT_EVENT_NOTIFY_APPLICATION_NAME = 'openmaic-agent-notify-bus';
export type AgentEventWakeupRoute = { kind: 'owner' | 'generation-run-owner'; ownerId: string } | { kind: 'session'; sessionId: string } | { kind: 'stage'; stageId: string } | { kind: 'generation-run'; runId: string };
export interface AgentEventNotifyBusHandle { stop(): Promise<void>; connecting: Promise<void> }
const subscribers = new Map<string, Set<() => void>>();
const key = (route: AgentEventWakeupRoute) => `${route.kind}:${'ownerId' in route ? route.ownerId : 'sessionId' in route ? route.sessionId : 'stageId' in route ? route.stageId : route.runId}`;
export function startAgentEventNotifyBus(): AgentEventNotifyBusHandle { return { stop: stopAgentEventNotifyBus, connecting: Promise.resolve() }; }
export async function stopAgentEventNotifyBus(): Promise<void> { for (const stops of subscribers.values()) for (const stop of stops) stop(); subscribers.clear(); }
export function hasAgentEventWakeupSubscriber(route: AgentEventWakeupRoute): boolean { return Boolean(subscribers.get(key(route))?.size); }
export function subscribeAgentEventWakeup(route: AgentEventWakeupRoute, wake: () => void): () => void {
  const routeKey = key(route);
  const database = workersEnvironment().OPENMAIC_DATABASE.getByName('primary-v1');
  let active = true;
  const stops = subscribers.get(routeKey) ?? new Set<() => void>();
  const stop = () => { active = false; stops.delete(stop); if (!stops.size) subscribers.delete(routeKey); };
  stops.add(stop); subscribers.set(routeKey, stops);
  void (async () => {
    let revision = -1;
    while (active) {
      const next = await database.waitForEvents(routeKey, revision);
      if (active && next !== revision) wake();
      revision = next;
    }
  })().catch(error => { stop(); console.error('Core event subscription interrupted; durable-log fallback remains active', error instanceof Error ? error.message : 'RPC failure'); });
  return stop;
}
/** PostgreSQL emits only after commit; the database DO publishes the wakeup. */
export async function notifyDurableAgentEvent(database: Pick<NotifyQueryable, 'query'>, route: AgentEventWakeupRoute): Promise<void> {
  const payload = JSON.stringify(route);
  if (Buffer.byteLength(payload, 'utf8') > 8000) return;
  await database.query('SELECT pg_notify($1,$2)', [AGENT_EVENT_NOTIFY_CHANNEL, payload]);
}
