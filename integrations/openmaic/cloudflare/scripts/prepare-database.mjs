import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const require = createRequire(import.meta.url);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.openmaic/cloudflare-db");
const dist = path.dirname(require.resolve("@electric-sql/pglite"));
await mkdir(path.join(dir, "assets"), { recursive: true });
const libraryPath = path.join(dist, 'index.js');
let library = await readFile(libraryPath, 'utf8');
const dynamicLoader = 'loadWebAssemblyModule=(binary,flags,libName,localScope,handle)=>{';
const staticLoader = dynamicLoader + 'binary=Module.precompiledModules?.[libName]??binary;';
if (!library.includes(staticLoader)) {
  if (library.split(dynamicLoader).length !== 2) throw new Error('Pinned PostgreSQL extension loader changed');
  library = library.replace(dynamicLoader, staticLoader);
  await writeFile(libraryPath, library);
}
const extension = library.match(/filename:"\/tmp\/pglite\/lib\/postgresql\/plpgsql.so",start:(\d+),end:(\d+)/);
if (!extension) throw new Error('Pinned PL/pgSQL bundle changed');
const files = await readFile(path.join(dist, 'pglite.data'));
await writeFile(path.join(dir, 'plpgsql.wasm'), files.subarray(Number(extension[1]), Number(extension[2])));
const original = await readFile(path.join(dist, "pglite.wasm"));
const wasm = Buffer.from(original);
// Pinned PGlite passes this GUC on its native command line, overriding config files.
// Keep the data segment length fixed; validate the resulting module below.
const sharedBuffers = Buffer.from('shared_buffers=128MB\0');
const buffersOffset = wasm.indexOf(sharedBuffers);
if (buffersOffset < 0 || wasm.indexOf(sharedBuffers, buffersOffset + 1) >= 0) throw new Error('Pinned PGlite shared buffer constant changed');
wasm.write('shared_buffers=8MB\0\0\0', buffersOffset, 'ascii');
let offset = 8;
function uint() { let value = 0, shift = 0, byte; do { byte = wasm[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128); return value; }
function string() { const length = uint(), start = offset; offset += length; return wasm.subarray(start, offset).toString(); }
function limits() { const flags = uint(); uint(); if (flags & 1) uint(); }
let memories = 0;
while (offset < wasm.length) {
  const section = wasm[offset++], length = uint(), end = offset + length;
  if (section === 2) {
    const count = uint();
    for (let i = 0; i < count; i++) {
      const module = string(), name = string(), kind = wasm[offset++];
      if (kind === 0) uint();
      else if (kind === 1) { offset++; limits(); }
      else if (kind === 2) {
        const flags = uint(), start = offset, minimum = uint(), size = offset - start;
        if (module === "env" && name === "memory") {
          if (minimum !== 256 || size !== 2) throw new Error(`Unexpected pinned PGlite memory import: minimum=${minimum}, encodedBytes=${size}`);
          memories++;
        }
        if (flags & 1) uint();
      } else if (kind === 3) offset += 2;
      else throw new Error(`Unsupported WebAssembly import kind ${kind}`);
    }
  }
  offset = end;
}
if (memories !== 1 || !WebAssembly.validate(wasm)) throw new Error("PGlite static module failed validation");
await writeFile(path.join(dir, "pglite.wasm"), wasm);
// Emscripten normally compiles this JS-callback trampoline at runtime.
const callback = Uint8Array.from([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,2,7,1,1,101,1,102,0,0,7,5,1,1,102,0,0]);
if (!WebAssembly.validate(callback)) throw new Error("Invalid static PostgreSQL callback module");
await writeFile(path.join(dir, "callback-iii.wasm"), callback);
await cp(path.join(dist, "pglite.data"), path.join(dir, "assets/pglite.data"));
const pg = new PGlite();
await pg.waitReady;
for (const setting of ["shared_buffers = '8MB'", "max_connections = '10'", "work_mem = '1MB'", "maintenance_work_mem = '8MB'", "wal_buffers = '256kB'", "max_worker_processes = '0'", "max_parallel_workers = '0'"]) {
  await pg.exec(`ALTER SYSTEM SET ${setting}`);
}
await pg.exec("CHECKPOINT");
const seed = await pg.dumpDataDir("gzip");
await writeFile(path.join(dir, "assets/bootstrap.tgz"), new Uint8Array(await seed.arrayBuffer()));
await pg.close();
await writeFile(path.join(dir, "provenance.json"), JSON.stringify({ pglite: "0.3.16", originalWasmSha256: createHash("sha256").update(original).digest("hex"), deployedWasmSha256: createHash("sha256").update(wasm).digest("hex"), initialMemoryMiB: 48 }, null, 2));
console.log("Prepared static PostgreSQL WASM and an empty database bootstrap; no database server required.");
