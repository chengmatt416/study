import { EventEmitter } from "node:events";
import type { Rpc, DurableObjectNamespace } from '@cloudflare/workers-types';
import { workersEnvironment } from "./context";
import type { PoolOptions, PoolConfig } from 'pg';

export interface SqlResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
}
export interface DatabaseApi extends Rpc.DurableObjectBranded {
  openSession(): Promise<string>;
  query(text: string, params?: unknown[], session?: string): Promise<SqlResult<object> | { error: { message: string; code?: string; detail?: string; hint?: string; constraint?: string } }>;
  closeSession(session: string): Promise<void>;
  waitForEvents(route: string, after: number): Promise<number>;
}
function database() {
  const namespace = workersEnvironment().OPENMAIC_DATABASE;
  return namespace.getByName("primary-v1");
}
function normalize(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
class WorkerClient extends EventEmitter {
  private released = false;
  constructor(private readonly id: string) { super(); }
  async query<T = Record<string, unknown>>(input: string | { text: string; values?: unknown[] }, params?: unknown[]): Promise<SqlResult<T>> {
    if (this.released) throw new Error("PostgreSQL client has been released");
    const result = await database().query(typeof input === "string" ? input : input.text, params ?? (typeof input === "string" ? [] : input.values), this.id);
    if ("error" in result) throw Object.assign(new Error(result.error.message), result.error, { name: "DatabaseError" });
    return { ...result, rows: result.rows.map((row) => normalize(row)) as T[] };
  }
  release(): void {
    if (this.released) return;
    this.released = true;
    const closing = database().closeSession(this.id);
    workersScopeContext(closing);
  }
  async end(): Promise<void> { if (!this.released) { this.released = true; await database().closeSession(this.id); } }
}
function workersScopeContext(promise: Promise<void>) {
  // Release must remain durable even when pg's synchronous release API is used.
  const { context } = requireScope();
  context.waitUntil(promise);
}
import { workersScope } from "./context";
function requireScope() { const scope = workersScope.getStore(); if (!scope) throw new Error("Missing Worker context"); return scope; }

/** The official pg query/connect contract, backed by a private Durable Object. */
export class WorkersPool extends EventEmitter {
  readonly options: PoolOptions;
  readonly totalCount = 0;
  readonly idleCount = 0;
  readonly waitingCount = 0;
  readonly expiredCount = 0;
  get ending() { return this.ended; }
  ended = false;
  constructor(options: PoolConfig = {}) { super(); this.options = { max: 1, maxUses: Infinity, allowExitOnIdle: true, maxLifetimeSeconds: 0, idleTimeoutMillis: 0, ...options }; }
  async connect(): Promise<WorkerClient> {
    if (this.ended) throw new Error("PostgreSQL pool has ended");
    return new WorkerClient(await database().openSession());
  }
  async query<T = Record<string, unknown>>(input: string | { text: string; values?: unknown[] }, params?: unknown[]): Promise<SqlResult<T>> {
    if (this.ended) throw new Error("PostgreSQL pool has ended");
    const result = await database().query(typeof input === "string" ? input : input.text, params ?? (typeof input === "string" ? [] : input.values));
    if ("error" in result) throw Object.assign(new Error(result.error.message), result.error, { name: "DatabaseError" });
    return { ...result, rows: result.rows.map((row) => normalize(row)) as T[] };
  }
  async end(): Promise<void> { this.ended = true; }
}
