// workerd keeps an ASCII module as one-byte text; a single non-Latin-1 character makes V8 hold the whole 60 MB Core
// bundle as two-byte text, about 128 MB, which is past the isolate memory limit. The isolate is then discarded after
// each request and the next one boots Next.js again (measured on Cloudflare: 1.5-3 s CPU on every request, against
// 11-33 ms once the bundle is ASCII). Bundlers keep raw Unicode inside regex literals, so this rewrites every non-ASCII
// character as an escape that means the same thing in strings, regexes and comments.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hex = (unit) => '\\u' + unit.toString(16).toUpperCase().padStart(4, '0');

/** Escapes every non-ASCII UTF-16 unit. An identity escape (`\（`) becomes the plain escape, which is what it meant. */
export function asciiSource(source) {
  let out = '';
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code < 0x80) continue;
    let slashes = 0;
    while (i - slashes - 1 >= start && source.charCodeAt(i - slashes - 1) === 0x5c) slashes++;
    out += source.slice(start, slashes % 2 ? i - 1 : i) + hex(code);
    start = i + 1;
  }
  return out + source.slice(start);
}

/** Rewrites one bundle file in place when it has non-ASCII characters. */
export async function asciiBundle(file) {
  const source = await readFile(file, 'utf8');
  if (!/[^\x00-\x7f]/.test(source)) return false;
  const result = asciiSource(source);
  if (/[^\x00-\x7f]/.test(result)) throw new Error(`${file} still has non-ASCII characters`);
  await writeFile(file, result);
  return true;
}

/** The server-side modules the Core Worker bundles from an OpenNext build; browser assets and node_modules are left alone. */
export async function bundleSources(openNext) {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== '.next') await visit(target); }
      else if (/\.(?:m|c)?js$/.test(entry.name)) files.push(target);
    }
  };
  for (const name of ['server-functions', 'middleware', 'cloudflare', '.build']) await visit(path.join(openNext, name));
  files.push(path.join(openNext, 'worker.js'));
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) console.log(file, await asciiBundle(file) ? 'escaped' : 'already ASCII');
}
