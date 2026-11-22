import { AsyncLocalStorage } from "node:async_hooks";
import type { ExecutionContext } from '@cloudflare/workers-types';

interface WorkerScope {
  env: CloudflareEnv;
  context: Pick<ExecutionContext, 'waitUntil'>;
  alarm?: boolean;
  liveGrant?: string;
  maintenance?: boolean;
  suspend?: () => never;
}
const key = Symbol.for("study.openmaic.workers.scope");
const state = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<WorkerScope> };
export const workersScope = (state[key] ??= new AsyncLocalStorage<WorkerScope>());
export function workersEnvironment(): CloudflareEnv {
  const scope = workersScope.getStore();
  if (!scope) throw new Error("OpenMAIC storage requires a Cloudflare request or alarm context");
  return scope.env;
}
export function suspendForMcp(): void { workersScope.getStore()?.suspend?.(); }
export async function wakeWorkers(): Promise<void> {
  await workersEnvironment().OPENMAIC_JOBS.getByName("coordinator-v1").wake();
}
