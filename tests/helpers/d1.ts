import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function testDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("../../migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
  const prepare = (sql: string, params: (string | number | null)[] = []) => ({
    execute: () => db.prepare(sql).all(...params),
    bind: (...values: (string | number | null)[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: db.prepare(sql).run(...params), results: [] }),
  });
  const DB = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    db.exec("BEGIN");
    try { const result = []; for (const statement of statements) result.push({ results: statement.execute() }); db.exec("COMMIT"); return result; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  } };
  return { db, DB };
}
