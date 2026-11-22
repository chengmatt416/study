import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import files from './builtin-skills.json';
import bundledFiles from './builtin-files.json';
export function installBuiltinSkills(): void {
  for (const [name, content] of Object.entries(files)) {
    if (name.split('/').includes('..') || name.startsWith('/')) throw new Error('Invalid bundled skill path');
    const target = `/tmp/study-skills/${name}`;
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content);
  }
  for (const [name, content] of Object.entries(bundledFiles)) {
    if (name.split('/').includes('..') || name.startsWith('/')) throw new Error('Invalid bundled core file path');
    const target = `/tmp/study-core/${name}`;
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, Buffer.from(content, 'base64'));
  }
}
