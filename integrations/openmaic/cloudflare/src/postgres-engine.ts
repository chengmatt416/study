import type { PGlite } from "@electric-sql/pglite";

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: { name: string; dataTypeID: number }[];
}
export interface QueryFailure { error: { message: string; code?: string; detail?: string; hint?: string; constraint?: string } }
interface Session { transaction: boolean; locks: Map<string, number>; touched: number }
const SESSION_TTL = 30_000;
const failure = (message: string, code: string): QueryFailure => ({ error: { message, code } });

/** Keep pg's connection/transaction semantics while PGlite has one physical backend. */
export class PostgresEngine {
  private readonly sessions = new Map<string, Session>();
  private readonly lockOwners = new Map<string, string>();
  private readonly waiters = new Set<() => void>();
  private tail = Promise.resolve();
  private owner?: string;
  constructor(private readonly pg: PGlite, private readonly schedule: (time?: number) => Promise<void>) {}
  openSession(): string {
    const id = crypto.randomUUID();
    this.sessions.set(id, { transaction: false, locks: new Map(), touched: Date.now() });
    return id;
  }
  private async turn<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); } finally { release(); }
  }
  private async releaseOwner(): Promise<void> {
    this.owner = undefined;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
    await this.scheduleSessions();
  }
  private async scheduleSessions(): Promise<void> {
    const deadlines = [...this.sessions.values()].filter(session => session.transaction || session.locks.size).map(session => session.touched + SESSION_TTL);
    await this.schedule(deadlines.length ? Math.min(...deadlines) : undefined);
  }
  private async execute(text: string, params: unknown[]): Promise<QueryResult> {
    const result = params.length ? await this.pg.query(text, params) : (await this.pg.exec(text)).at(-1);
    return { rows: result?.rows ?? [], rowCount: result?.affectedRows || result?.rows.length || 0, fields: result?.fields ?? [] };
  }
  async query(text: string, params: unknown[] = [], id?: string): Promise<QueryResult | QueryFailure> {
    const deadline = Date.now() + 10_000;
    const sql = text.trim().replace(/;\s*$/, "");
    const begin = /^(?:BEGIN|START TRANSACTION)(?:\s|;|$)/i.test(sql);
    const end = /^(?:COMMIT|ROLLBACK)(?:\s+(?:WORK|TRANSACTION))?$/i.test(sql);
    const advisory = /^SELECT\s+(pg_try_advisory_lock|pg_advisory_unlock)\(([\s\S]*)\)(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))?$/i.exec(sql);
    if ((begin || advisory) && !id) return failure("Transactions and advisory locks require a checked-out PostgreSQL client", "25000");
    for (;;) {
      const result = await this.turn(async (): Promise<QueryResult | QueryFailure | { wait: Promise<void> }> => {
        const session = id ? this.sessions.get(id) : undefined;
        if (id && !session) return failure("PostgreSQL connection was lost; retry the transaction", "08006");
        if (this.owner && this.owner !== id) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) return failure("Timed out waiting for the active PostgreSQL transaction", "55P03");
          if (this.waiters.size >= 100) return failure("Too many waiting PostgreSQL clients", "53300");
          return { wait: new Promise<void>((resolve) => {
            const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
            const timer = setTimeout(wake, remaining); this.waiters.add(wake);
          }) };
        }
        if (begin && id && !this.owner) this.owner = id;
        if (session) session.touched = Date.now();
        try {
          if (advisory && session && id) {
            // Physical PGlite connections share a backend. Session advisory locks
            // belong to virtual clients and must not block unrelated SQL queries.
            const keyResult = await this.execute(`SELECT ARRAY[${advisory[2]}]::bigint[]::text AS key`, params);
            const key = String(keyResult.rows[0].key);
            const acquiring = advisory[1].toLowerCase() === 'pg_try_advisory_lock';
            const holder = this.lockOwners.get(key);
            const accepted = acquiring ? !holder || holder === id : holder === id;
            if (accepted) {
              const count = (session.locks.get(key) ?? 0) + (acquiring ? 1 : -1);
              if (count > 0) { session.locks.set(key, count); this.lockOwners.set(key, id); }
              else { session.locks.delete(key); this.lockOwners.delete(key); }
              await this.scheduleSessions();
            }
            const field = advisory[3] ?? advisory[1].toLowerCase();
            return { rows: [{ [field]: accepted }], rowCount: 1, fields: [{ name: field, dataTypeID: 16 }] };
          }
          const result = await this.execute(text, params);
          if (session) {
            if (begin) session.transaction = true;
            if (end) session.transaction = false;
            if (this.owner === id && !session.transaction) await this.releaseOwner();
            else if (begin) await this.scheduleSessions();
          }
          return result;
        } catch (error) {
          const data = error as { message?: string; code?: string; detail?: string; hint?: string; constraint?: string };
          if (session && this.owner === id && !session.transaction) await this.releaseOwner();
          return { error: { message: data.message ?? "PostgreSQL query failed", code: data.code, detail: data.detail, hint: data.hint, constraint: data.constraint } };
        }
      });
      if (!("wait" in result)) return result;
      await result.wait;
    }
  }
  async closeSession(id: string): Promise<void> {
    await this.turn(async () => {
      const session = this.sessions.get(id);
      if (!session) return;
      if (this.owner === id) {
        if (session.transaction) await this.pg.exec("ROLLBACK");
        await this.releaseOwner();
      }
      for (const key of session.locks.keys()) if (this.lockOwners.get(key) === id) this.lockOwners.delete(key);
      this.sessions.delete(id);
      await this.scheduleSessions();
    });
  }
  async expireSessions(): Promise<void> {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.touched + SESSION_TTL <= now) await this.closeSession(id);
    }
    await this.scheduleSessions();
  }
}
