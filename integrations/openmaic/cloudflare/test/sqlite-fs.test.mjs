import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { SqliteFilesystem } from "../src/sqlite-fs.ts";
import { PostgresEngine } from "../src/postgres-engine.ts";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  const sql = { exec(query, ...params) { const rows = database.prepare(query).all(...params); return { toArray: () => rows }; } };
  const transaction = (callback) => {
    database.exec("BEGIN");
    try { const result = callback(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  return { database, make: () => new SqliteFilesystem(sql, transaction) };
}
const read = (fs, path, size) => {
  const fd = fs.open(path), buffer = new Uint8Array(size);
  try { fs.read(fd, buffer, 0, size, 0); return buffer; } finally { fs.close(fd); }
};
test("sparse page writes, truncation, and regrowth never reveal stale bytes", () => {
  const { database, make } = fixture(), fs = make();
  try {
    fs.writeFile("/sparse", new Uint8Array());
    const fd = fs.open("/sparse");
    fs.write(fd, new Uint8Array([11, 22, 33, 44]), 0, 4, 65534);
    const bytes = read(fs, "/sparse", 65538);
    assert.equal(bytes.slice(0, 65534).some((x) => x !== 0), false);
    assert.deepEqual([...bytes.slice(65534)], [11, 22, 33, 44]);
    fs.truncate("/sparse", 65535); fs.truncate("/sparse", 65538);
    assert.deepEqual([...read(fs, "/sparse", 65538).slice(65534)], [11, 0, 0, 0]);
    fs.close(fd);
  } finally { database.close(); }
});
test("renaming directories preserves children and open descriptors across replacement", () => {
  const { database, make } = fixture(), fs = make();
  try {
    fs.mkdir("/a/b", { recursive: true }); fs.writeFile("/a/b/original", "original");
    const old = fs.open("/a/b/original"); fs.writeFile("/replacement", "new");
    fs.rename("/replacement", "/a/b/original");
    const buffer = new Uint8Array(8); fs.read(old, buffer, 0, 8, 0);
    assert.equal(new TextDecoder().decode(buffer), "original");
    fs.close(old); fs.rename("/a", "/renamed");
    assert.equal(new TextDecoder().decode(read(fs, "/renamed/b/original", 3)), "new");
    assert.deepEqual(fs.readdir("/renamed/b"), ["original"]);
    assert.throws(() => fs.rmdir("/renamed"), { message: "ENOTEMPTY" });
    assert.throws(() => fs.open("/../escape"), { message: "EINVAL" });
    const reopened = make(); assert.equal(reopened.lstat("/renamed/b/original").size, 3);
  } finally { database.close(); }
});
test("real PostgreSQL JSONB, transactions, triggers, and checkpoints survive a new engine", async () => {
  const { database, make } = fixture();
  let pg = new PGlite({ fs: make() });
  try {
    await pg.waitReady;
    await pg.exec("CREATE TABLE contract(id text PRIMARY KEY, payload jsonb NOT NULL); CREATE TABLE audit(value text); CREATE FUNCTION contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO audit VALUES (NEW.id); RETURN NEW; END $$; CREATE TRIGGER changed AFTER INSERT ON contract FOR EACH ROW EXECUTE FUNCTION contract_audit();");
    await pg.query("INSERT INTO contract VALUES ($1,$2::jsonb)", ["kept", JSON.stringify({ nested: { result: 10 } })]);
    await pg.exec("BEGIN; INSERT INTO contract VALUES ('rolled-back','{}'); ROLLBACK;");
    await pg.close(); pg = new PGlite({ fs: make() }); await pg.waitReady;
    assert.deepEqual((await pg.query("SELECT id,payload->'nested'->>'result' AS result FROM contract")).rows, [{ id: "kept", result: "10" }]);
    assert.deepEqual((await pg.query("SELECT * FROM audit")).rows, [{ value: "kept" }]);
  } finally { if (!pg.closed) await pg.close(); database.close(); }
});

test("virtual pg clients isolate transactions, release locks, and preserve SQLSTATE", async () => {
  const pg = new PGlite(); await pg.waitReady;
  const engine = new PostgresEngine(pg, async () => {});
  const a = engine.openSession(), b = engine.openSession();
  const query = async (...args) => {
    const result = await engine.query(...args); assert.ok(!('error' in result), JSON.stringify(result)); return result;
  };
  try {
    await query('CREATE TABLE isolation(id text PRIMARY KEY)');
    assert.equal((await engine.query('SELECT pg_try_advisory_lock(17)')).error.code, '25000');
    assert.equal((await engine.query('BEGIN; SELECT 1')).error.code, '25000');
    await query('BEGIN', [], a); await query("INSERT INTO isolation VALUES ('private')", [], a);
    let completed = false;
    const read = query('SELECT * FROM isolation', [], b).then(result => { completed = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(completed, false);
    await query('ROLLBACK', [], a); assert.deepEqual((await read).rows, []);
    await query("INSERT INTO isolation VALUES ('durable')");
    assert.equal((await engine.query("INSERT INTO isolation VALUES ('durable')")).error.code, '23505');
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [17], a)).rows[0].locked, true);
    assert.deepEqual((await query('SELECT * FROM isolation', [], b)).rows, [{ id: 'durable' }]);
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [18], b)).rows[0].locked, true);
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [17], b)).rows[0].locked, false);
    assert.equal((await query('SELECT pg_advisory_unlock($1)', [17], b)).rows[0].pg_advisory_unlock, false);
    assert.equal((await query('SELECT pg_try_advisory_lock($1)', [17], a)).rows[0].pg_try_advisory_lock, true);
    await query('SELECT pg_advisory_unlock($1)', [17], a);
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [17], b)).rows[0].locked, false);
    await engine.closeSession(a);
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [17], b)).rows[0].locked, true);
    await engine.closeSession(b);
    const raw = engine.openSession(); await query('SELECT pg_try_advisory_lock($1)', [17], raw);
    assert.equal((await query('SELECT pg_try_advisory_lock($1) AS locked', [17], engine.openSession())).rows[0].locked, false);
    await engine.closeSession(raw);
    const c = engine.openSession(); await query('BEGIN', [], c); await query("INSERT INTO isolation VALUES ('abandoned')", [], c);
    await engine.closeSession(c);
    assert.deepEqual((await query('SELECT * FROM isolation')).rows, [{ id: 'durable' }]);
    assert.equal((await engine.query('SELECT 1', [], c)).error.code, '08006');
  } finally { await pg.close(); }
});
