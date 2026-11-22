import { DurableObject } from "cloudflare:workers";
import { PGlite } from "@electric-sql/pglite";
import module from "../../../../.openmaic/cloudflare-db/pglite.wasm";
import callbackModule from "../../../../.openmaic/cloudflare-db/callback-iii.wasm";
import plpgsqlModule from "../../../../.openmaic/cloudflare-db/plpgsql.wasm";
import { SqliteFilesystem, type SqliteStorage } from "./sqlite-fs";
import { verifyOpenMaicTicket } from "../../../../src/shared/openmaic-transport";
import { PostgresEngine } from "./postgres-engine";

interface Env {
  DATABASE: DurableObjectNamespace<OpenMaicPostgres>;
  BOOTSTRAP: Fetcher;
  DATABASE_ADMIN_SECRET?: string;
}
export class OpenMaicPostgres extends DurableObject<Env> {
  private database!: PGlite;
  private engine!: PostgresEngine;
  private readonly eventWaiters = new Map<string, Set<() => void>>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const initialized = await ctx.storage.get<boolean>("postgres-initialized");
      const sqlite: SqliteStorage = {
        exec: (query, ...values) => ctx.storage.sql.exec(query, ...values.map((value) => value instanceof Uint8Array ? value.slice().buffer : value)),
      };
      let fs = new SqliteFilesystem(sqlite, (callback) => ctx.storage.transactionSync(callback));
      if (!initialized) {
        // A seed interrupted before readiness has never accepted application writes.
        ctx.storage.transactionSync(() => { ctx.storage.sql.exec("DELETE FROM pgfs_pages"); ctx.storage.sql.exec("DELETE FROM pgfs_nodes"); });
        fs = new SqliteFilesystem(sqlite, (callback) => ctx.storage.transactionSync(callback));
      }
      const [files, bootstrap] = await Promise.all([
        env.BOOTSTRAP.fetch("https://bootstrap/pglite.data"),
        initialized ? undefined : env.BOOTSTRAP.fetch("https://bootstrap/bootstrap.tgz"),
      ]);
      if (!files.ok || (bootstrap && !bootstrap.ok)) throw new Error("PostgreSQL bootstrap assets unavailable");
      this.database = new PGlite({
        fs, wasmModule: module, fsBundle: await files.blob(),
        loadDataDir: bootstrap ? await bootstrap.blob() : undefined,
        initialMemory: 48 * 1024 * 1024,
        parsers: { 20: (value: string) => value, 1700: (value: string) => value },
        extensions: {
          workerMemory: { name: "workerMemory", setup: async (_pg, options) => ({ emscriptenOpts: {
            ...options,
            precompiledModules: { '/tmp/pglite/lib/postgresql/plpgsql.so': plpgsqlModule },
            wasmMemory: new WebAssembly.Memory({ initial: 768, maximum: 1024 }),
            postRun: [...options.postRun ?? [], (mod: { addFunction: (fn: CallableFunction, signature: string) => number }) => {
              const add = mod.addFunction;
              mod.addFunction = (fn, signature) => {
                if (signature !== "iii") throw new Error(`Unsupported PostgreSQL callback signature: ${signature}`);
                const instance = new WebAssembly.Instance(callbackModule, { e: { f: fn } });
                const wrapped = instance.exports.f;
                if (typeof wrapped !== "function") throw new Error("Missing PostgreSQL callback trampoline");
                return add(wrapped, signature);
              };
            }],
          } }) },
        },
      });
      await this.database.waitReady;
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS worker_event_revisions(route TEXT PRIMARY KEY,revision INTEGER NOT NULL)');
      await this.database.listen('openmaic_agent_event_wakeup', (payload) => {
        try {
          const route = this.eventKey(JSON.parse(payload));
          if (!route) return;
          ctx.storage.sql.exec('INSERT INTO worker_event_revisions VALUES (?,1) ON CONFLICT(route) DO UPDATE SET revision=revision+1', route);
          for (const wake of this.eventWaiters.get(route) ?? []) wake();
        } catch (error) { console.error('Durable event wakeup failed', error instanceof Error ? error.message : 'Invalid notification'); }
      });
      if (!initialized) await ctx.storage.put("postgres-initialized", true);
      this.engine = new PostgresEngine(this.database, async (time) => {
        if (time === undefined) await ctx.storage.deleteAlarm(); else await ctx.storage.setAlarm(time);
      });
    });
  }
  async openSession() { return this.engine.openSession(); }
  async closeSession(id: string) { await this.engine.closeSession(id); }
  async query(text: string, params: unknown[] = [], session?: string) { return this.engine.query(text, params, session); }
  async alarm() { await this.engine.expireSessions(); }
  async placement() {
    const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    if (!response.ok) throw new Error('Database location unavailable');
    const trace = new URLSearchParams((await response.text()).trim().split('\n').join('&'));
    return { colo: trace.get('colo') };
  }
  private eventKey(route: { kind?: string; ownerId?: string; sessionId?: string; stageId?: string; runId?: string }): string | undefined {
    const id = route.kind === 'owner' || route.kind === 'generation-run-owner' ? route.ownerId : route.kind === 'session' ? route.sessionId : route.kind === 'stage' ? route.stageId : route.kind === 'generation-run' ? route.runId : undefined;
    if (!id || id.length > 300) return;
    return `${route.kind}:${id}`;
  }
  async waitForEvents(route: string, after: number): Promise<number> {
    if (route.length > 350 || !/^(owner|session|stage|generation-run|generation-run-owner):/.test(route)) throw new Error('Invalid event route');
    const revision = () => this.ctx.storage.sql.exec<{ revision: number }>('SELECT revision FROM worker_event_revisions WHERE route=?', route).toArray()[0]?.revision ?? 0;
    if (revision() !== after) return revision();
    if ([...this.eventWaiters.values()].reduce((count, set) => count + set.size, 0) >= 1000) throw new Error('Too many event subscribers');
    await new Promise<void>((resolve) => {
      const listeners = this.eventWaiters.get(route) ?? new Set<() => void>();
      const finish = () => { clearTimeout(timer); listeners.delete(finish); if (!listeners.size) this.eventWaiters.delete(route); resolve(); };
      const timer = setTimeout(finish, 10_000);
      listeners.add(finish); this.eventWaiters.set(route, listeners);
    });
    return revision();
  }
  async contract() {
    const query = async (text: string, params: unknown[] = [], session?: string) => {
      const result = await this.query(text, params, session);
      if ('error' in result) throw new Error(`${result.error.code}: ${result.error.message}`);
      return result;
    };
    await query("CREATE TABLE IF NOT EXISTS worker_contract(id text PRIMARY KEY,payload jsonb NOT NULL)");
    await query("CREATE OR REPLACE FUNCTION worker_contract_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.payload=NEW.payload || '{\"trigger\":true}'::jsonb; RETURN NEW; END $$");
    await query("DROP TRIGGER IF EXISTS contract_write ON worker_contract; CREATE TRIGGER contract_write BEFORE INSERT ON worker_contract FOR EACH ROW EXECUTE FUNCTION worker_contract_trigger()");
    await query("INSERT INTO worker_contract VALUES ('trigger-proof','{\"correct\":true}') ON CONFLICT(id) DO NOTHING");
    const session = this.engine.openSession();
    try {
      await query('BEGIN', [], session);
      await query("INSERT INTO worker_contract VALUES ('rollback-proof','{}') ON CONFLICT(id) DO NOTHING", [], session);
      await query('ROLLBACK', [], session);
    } finally { await this.closeSession(session); }
    const lockA = this.engine.openSession(), lockB = this.engine.openSession();
    let advisoryIsolation = false;
    try {
      const locked = await query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [17], lockA);
      const readable = await query('SELECT 1 AS value', [], lockB);
      const contended = await query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [17], lockB);
      const independent = await query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [18], lockB);
      advisoryIsolation = locked.rows[0].locked === true && readable.rows[0].value === 1 && contended.rows[0].locked === false && independent.rows[0].locked === true;
    } finally { await this.closeSession(lockA); await this.closeSession(lockB); }
    const before = await this.waitForEvents('session:worker-contract', -1);
    const wakeup = this.waitForEvents('session:worker-contract', before);
    await query('SELECT pg_notify($1,$2)', ['openmaic_agent_event_wakeup', JSON.stringify({ kind: 'session', sessionId: 'worker-contract' })]);
    const notified = await wakeup;
    await query("INSERT INTO worker_contract VALUES ('cold-start-proof',$1::jsonb) ON CONFLICT(id) DO NOTHING", [JSON.stringify({ nonce: crypto.randomUUID() })]);
    return { advisoryIsolation, version: await query("SELECT version() AS version"), persisted: await query("SELECT payload FROM worker_contract WHERE id='trigger-proof'"), rolledBack: (await query("SELECT id FROM worker_contract WHERE id='rollback-proof'")).rowCount === 0, eventWakeup: notified === before + 1, nonce: (await query("SELECT payload->>'nonce' AS nonce FROM worker_contract WHERE id='cold-start-proof'")).rows[0].nonce };
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'GET' || !['/internal/contract', '/internal/placement'].includes(path) || !env.DATABASE_ADMIN_SECRET) return new Response("Not found", { status: 404 });
    const ticket = await verifyOpenMaicTicket(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", env.DATABASE_ADMIN_SECRET);
    if (ticket?.scope !== "api" || ticket.sub !== "study:database-contract") return new Response("Not found", { status: 404 });
    try {
      if (path === '/internal/placement') return Response.json(await env.DATABASE.getByName('primary-v1').placement());
      return Response.json(await env.DATABASE.getByName("contract-v1").contract());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown database error";
      console.error("PostgreSQL worker contract failed", message);
      return Response.json({ error: message }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
