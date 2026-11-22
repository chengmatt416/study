import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { signOpenMaicTicket } from '../src/shared/openmaic-transport.ts';
import { patchStudyClassroom } from '../integrations/openmaic/cloudflare/patch-classroom.mjs';
import { asciiBundle, bundleSources } from '../integrations/openmaic/cloudflare/scripts/ascii-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.join(root, '.openmaic/worker-core');
const integration = path.join(root, 'integrations/openmaic/cloudflare');
const env = { ...process.env, RAYON_NUM_THREADS: '2', TOKIO_WORKER_THREADS: '2', OPENMAIC_CORE_DIR: core, OPENMAIC_WORKERS: '1', OPENMAIC_MCP_MODE: '1', DATABASE_URL: 'postgres://workers/openmaic', NEXT_PUBLIC_PRO_WORKBENCH_ENABLED: '1' };
const action = process.argv[2] ?? 'prepare';
function requiredHttpsOrigin(name) {
  let url;
  try { url = new URL(process.env[name] ?? ''); } catch { /* Checked below. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Set ${name} to your own HTTPS Worker origin.`);
  }
  return url.origin;
}
const coreOrigin = ['deploy', 'connect', 'verify'].includes(action) ? requiredHttpsOrigin('OPENMAIC_WORKERS_ORIGIN') : '';
if (action === 'deploy') env.OPENMAIC_DATABASE_ORIGIN = requiredHttpsOrigin('OPENMAIC_DATABASE_ORIGIN');
function run(command, args, cwd = root, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function replace(file, before, after) {
  const target = path.join(core, file), source = await readFile(target, 'utf8');
  if (!source.includes(before)) throw new Error(`Pinned core patch no longer matches ${file}`);
  await writeFile(target, source.replace(before, after));
}
async function secretFile(directory, key) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'secrets.json');
  let value;
  try { value = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; value = { [key]: randomBytes(32).toString('hex') }; await writeFile(file, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); }
  if (typeof value[key] !== 'string' || value[key].length < 32) throw new Error(`Invalid ${key} in private deployment secrets`);
  return { file, value: value[key] };
}
async function verifyCore(secret) {
  const ticket = await signOpenMaicTicket({ sub: 'study:worker-deployment-check', aud: 'study-openmaic', scope: 'api', exp: Date.now() + 60_000 }, secret);
  const response = await fetch(new URL('/api/study-mcp/status', coreOrigin), { headers: { authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(60_000) });
  const status = await response.json();
  if (!response.ok || status.engine !== 'OpenMAIC' || status.transport !== 'study-mcp/v1') throw new Error('Deployed full core verification failed');
  const database = await fetch(new URL('/api/study-mcp/tasks', coreOrigin), { headers: { authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(60_000) });
  if (!database.ok || !Array.isArray((await database.json()).tasks)) throw new Error('Full core cannot read its durable MCP task store');
  const denied = await fetch(new URL('/api/study-mcp/tasks', coreOrigin));
  if (denied.status !== 401) throw new Error('Deployed core accepted an unsigned protected request');
  console.log('Full OpenMAIC Worker responds with MCP transport and enforces signed authentication.');
}
async function prepare() {
  await rm(path.join(core, '.open-next/study-build-verified.json'), { force: true });
  // Only reset generated host-adapter files; integration sources are authoritative.
  const git = promisify(execFile);
  try {
    await readFile(path.join(core, '.git/HEAD'));
    for (const file of ['next.config.ts','lib/ai/providers.ts','lib/prompts/loader.ts','lib/pbl/v2/prompts/loader.ts','packages/@openmaic/generation/src/prompts/loader.ts','packages/@openmaic/generation/src/pbl/prompts/loader.ts','lib/server/skill-export.ts','lib/server/usage-storage.ts','lib/server/material-extraction/document-image-parser.ts','lib/server/agent-runtime/import-pptx.ts','lib/server/agent-runtime/scene-preview-content.ts','lib/persistence/server-provider.ts','lib/server/materials/bytes.ts','lib/server/agent-runtime/runner.ts','instrumentation.ts','middleware.ts','lib/server/classroom-media-bytes.ts','lib/document/extractors/images.ts','lib/server/materials/inline-images.ts','lib/pdf/pdf-providers.ts']) {
      const { stdout } = await git('git', ['show', `HEAD:${file}`], { cwd: core, maxBuffer: 10 * 1024 * 1024 });
      await writeFile(path.join(core, file), stdout);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await run('node', ['scripts/openmaic-core.mjs', 'setup', '--no-install']);
  const packagePath = path.join(core, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.dependencies.next = '16.4.3';
  pkg.devDependencies['@opennextjs/cloudflare'] = '1.20.15';
  pkg.devDependencies.wrangler = '4.156.0';
  pkg.devDependencies['@cloudflare/workers-types'] = '5.20261031.1';
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  await cp(path.join(integration, 'pnpm-lock.yaml'), path.join(core, 'pnpm-lock.yaml'));
  await cp(path.join(integration, 'overlay'), core, { recursive: true });
  for (const file of ['lib/playback/types.ts', 'lib/playback/engine.ts', 'lib/action/engine.ts', 'components/edit/PlaybackChromeRoot.tsx', 'components/classroom/ClassroomSurface.tsx', 'components/roundtable/index.tsx', 'components/stage/scene-sidebar.tsx', 'components/scene-renderers/classroom-complete.tsx', 'lib/workbench/classroom-exit.ts', 'components/scene-renderers/InteractiveIframeHost.tsx', 'components/canvas/canvas-area.tsx', 'app/layout.tsx', 'components/scene-renderers/quiz-view.tsx', 'components/chat/use-chat-sessions.ts', 'components/scene-renderers/pbl-renderer.tsx', 'components/chat/chat-session.tsx', 'lib/utils/iframe.ts', 'components/stage.tsx', 'components/stage/scene-renderer.tsx', ...['simulation-content', 'diagram-content', 'game-content', 'visualization3d-content', 'requirements-to-outlines', 'slide-content', 'slide-actions', 'quiz-content'].map(name => `packages/@openmaic/generation/templates/${name}/system.md`)]) {
    const { stdout } = await git('git', ['show', `HEAD:${file}`], { cwd: core, maxBuffer: 10 * 1024 * 1024 });
    await writeFile(path.join(core, file), stdout);
  }
  await cp(path.join(root, 'src/shared/live-classroom.ts'), path.join(core, 'lib/study-workers/live-classroom.ts'));
  await cp(path.join(root, 'src/shared/live-ai-transport.ts'), path.join(core, 'lib/study-workers/live-ai-transport.ts'));
  await cp(path.join(root, 'src/shared/ai-boundary.ts'), path.join(core, 'lib/study-workers/ai-boundary.ts'));
  await cp(path.join(root, 'src/shared/classroom-grading.ts'), path.join(core, 'lib/study-classroom/grading.ts'));
  await cp(path.join(root, 'src/shared/module-kit.ts'), path.join(core, 'lib/study-classroom/module-kit.ts'));
  await cp(path.join(root, 'src/shared/module-lab.ts'), path.join(core, 'lib/study-classroom/module-lab.ts'));
  await cp(path.join(root, 'src/shared/classroom-tips.ts'), path.join(core, 'lib/study-classroom/tips.ts'));
  await cp(path.join(root, 'src/shared/course-map.ts'), path.join(core, 'lib/study-classroom/course-map.ts'));
  await patchStudyClassroom(core);
  const skills = {};
  async function collect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await collect(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) skills[name] = await readFile(path.join(directory, entry.name), 'utf8');
    }
  }
  await collect(path.join(core, 'skills/agent-runtime'));
  await writeFile(path.join(core, 'lib/study-workers/builtin-skills.json'), JSON.stringify(skills));
  const bundledFiles = {};
  async function collectFiles(relative) {
    for (const entry of await readdir(path.join(core, relative), { withFileTypes: true })) {
      const name = relative + '/' + entry.name;
      if (entry.isDirectory()) await collectFiles(name);
      else if (entry.isFile() && !/\.[cm]?tsx?$/.test(name)) bundledFiles[name] = (await readFile(path.join(core, name))).toString('base64');
    }
  }
  for (const directory of ['lib/prompts', 'lib/pbl/v2/prompts', 'packages/@openmaic/generation/templates', 'packages/@openmaic/generation/snippets', 'packages/@openmaic/generation/prompts-pbl', 'skills/openmaic']) await collectFiles(directory);
  await writeFile(path.join(core, 'lib/study-workers/builtin-files.json'), JSON.stringify(bundledFiles));
  await replace('lib/prompts/loader.ts', "return path.join(process.cwd(), 'lib', 'prompts');", "return process.env.OPENMAIC_PROMPTS_DIR ?? '/tmp/study-core/lib/prompts';");
  await replace('lib/pbl/v2/prompts/loader.ts', "return path.join(process.cwd(), 'lib', 'pbl', 'v2', 'prompts');", "return process.env.OPENMAIC_PBL_PROMPTS_DIR ?? '/tmp/study-core/lib/pbl/v2/prompts';");
  await replace('packages/@openmaic/generation/src/prompts/loader.ts', "const DEFAULT_PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');", "const DEFAULT_PROMPTS_DIR = process.env.OPENMAIC_GENERATION_PROMPTS_DIR ?? '/tmp/study-core/packages/@openmaic/generation';");
  await replace('packages/@openmaic/generation/src/pbl/prompts/loader.ts', "const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../prompts-pbl');", "const PROMPTS_DIR = process.env.OPENMAIC_GENERATION_PBL_PROMPTS_DIR ?? '/tmp/study-core/packages/@openmaic/generation/prompts-pbl';");
  await replace('lib/server/skill-export.ts', "join(process.cwd(), 'skills', 'openmaic')", "'/tmp/study-core/skills/openmaic'");
  await replace('lib/server/skill-export.ts', "join(process.cwd(), 'skills', 'agent-runtime')", "process.env.OPENMAIC_AGENT_SKILLS_DIR ?? '/tmp/study-skills'");
  for (const [file, anchor, name, async] of [
    ['lib/server/material-extraction/document-image-worker.mjs', "try {\n  if (workerData.kind === 'plan')", 'runImageJob', false],
    ['lib/server/agent-runtime/import-pptx-worker.mjs', "installHost();\nconst { importPptx }", 'runPptxJob', true],
  ]) {
    let source = await readFile(path.join(core, file), 'utf8');
    source = source.replace("import { parentPort, workerData } from 'node:worker_threads';", '');
    const position = source.indexOf(anchor); if (position < 0) throw new Error(`Pinned parse worker changed: ${file}`);
    source = source.slice(0, position) + `export ${async ? 'async ' : ''}function ${name}(workerData) {\n` + source.slice(position).replaceAll('parentPort.postMessage(', 'return (') + '\n}\n';
    if (async) source = source.replace('const response = await fetch(this.url, init);', `const response = this.url.startsWith('data:') ? dataResponse(this.url) : await fetch(this.url, init);`) + `\nfunction dataResponse(url) { const match = /^data:([^,]*),(.*)$/s.exec(url); if (!match) throw new Error('Invalid data URL'); const [mime, ...options] = match[1].split(';'); const bytes = options.includes('base64') ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2])); return new Response(bytes, { headers: { 'content-type': mime || 'application/octet-stream' } }); }\n`;
    await writeFile(path.join(core, file.replace('.mjs', '.cloudflare.mjs')), source);
  }
  await replace('lib/server/material-extraction/document-image-parser.ts', '  if (job.kind !== \'plan\' || cacheKey === undefined)', `  if (process.env.OPENMAIC_WORKERS === '1') {\n    const work = import('@/lib/study-workers/parser-client').then(({ parseInWorker }) => parseInWorker<{ result: Result }>('images', JSON.stringify(job), signal)).then(value => value.result);\n    return work.catch(error => { throw new DocumentImageParseError(error); });\n  }\n  if (job.kind !== 'plan' || cacheKey === undefined)`);
  await replace('lib/server/agent-runtime/import-pptx.ts', '  const workerFile = importerWorkerPath();', `  if (process.env.OPENMAIC_WORKERS === '1') {\n    const { parseInWorker } = await import('@/lib/study-workers/parser-client');\n    const { slides } = await parseInWorker<{ slides: Slide[] }>('pptx', buffer, signal);\n    return options.upload ? await rewriteDataUrls(slides, options.upload) as Slide[] : slides;\n  }\n  const workerFile = importerWorkerPath();`);
  await replace('lib/server/agent-runtime/scene-preview-content.ts', '    return new Uint8Array(await readFile(target, { signal }));', `    const { workersEnvironment } = await import('@/lib/study-workers/context');\n    const response = await workersEnvironment().ASSETS!.fetch('https://assets/vendor/interactive/' + libraryDirectory + '/' + file);\n    signal?.throwIfAborted();\n    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;`);
  for (const file of ['lib/prompts/loader.ts', 'lib/pbl/v2/prompts/loader.ts']) {
    const target = path.join(core, file); const source = await readFile(target, 'utf8');
    await writeFile(target, source.replaceAll('fs.readFileSync(', 'fs.readFileSync(/* turbopackIgnore: true */ '));
  }
  await replace('lib/server/usage-storage.ts', '    const dir = usageDir(opts.baseDir);', `    if (process.env.OPENMAIC_WORKERS === '1' && !opts.baseDir) {\n      const { writeWorkerUsage } = await import('@/lib/study-workers/usage'); await writeWorkerUsage(record); return;\n    }\n    const dir = usageDir(opts.baseDir);`);
  await replace('lib/server/usage-storage.ts', 'export async function readUsageRecords(opts: ReadOptions = {}): Promise<UsageRecord[]> {', `export async function readUsageRecords(opts: ReadOptions = {}): Promise<UsageRecord[]> {\n  if (process.env.OPENMAIC_WORKERS === '1' && !opts.baseDir) { const { readWorkerUsage } = await import('@/lib/study-workers/usage'); return readWorkerUsage(opts.months); }`);
  await replace('lib/persistence/server-provider.ts', "import { Pool } from 'pg';", "import { Pool } from 'pg';\nimport { WorkersPool } from '@/lib/study-workers/database';");
  await replace('lib/persistence/server-provider.ts', '  new Pool({\n    connectionString,', "  // The RPC host implements the query/connect/release contract used by storage; pg wire-protocol client methods do not apply.\n  process.env.OPENMAIC_WORKERS === '1' ? new WorkersPool() as unknown as Pool : new Pool({\n    connectionString,");
  await replace('lib/server/materials/bytes.ts', 'let sharedStore: MaterialByteStore | null = null;', "import { workersMaterialByteStore } from '@/lib/study-workers/materials';\nlet sharedStore: MaterialByteStore | null = null;");
  await replace('lib/server/materials/bytes.ts', '  sharedStore ??= new LocalMaterialByteStore();', "  if (process.env.OPENMAIC_WORKERS === '1') return workersMaterialByteStore;\n  sharedStore ??= new LocalMaterialByteStore();");
  await replace('lib/study-mcp/auth.ts', '  headers: Headers,', '  headers: Pick<Headers, "get">,\n  secret = process.env.STUDY_MCP_SECRET ?? "",');
  await replace('lib/study-mcp/auth.ts', 'process.env.STUDY_MCP_SECRET ?? "")', 'secret)');
  await replace('lib/study-mcp/auth.ts', '  request: Request,', '  request: Pick<Request, "url" | "method"> & { headers: Pick<Headers, "get"> },\n  secret?: string,');
  await replace('lib/study-mcp/auth.ts', 'studyTicket(request.headers)', 'studyTicket(request.headers, secret)');
  await replace('lib/study-mcp/model.ts', 'import { randomUUID }', "import { LIVE_CLASSROOM_STAGES } from '@/lib/study-workers/live-classroom';\nimport { workersScope } from '@/lib/study-workers/context';\nimport { liveClassroomModel } from '@/lib/study-workers/live-ai';\nimport { randomUUID }");
  await replace('lib/study-mcp/model.ts', '  const ownerId = params.workspaceId;', `  const grant = workersScope.getStore()?.liveGrant;
  if (params.stage && LIVE_CLASSROOM_STAGES.has(params.stage)) {
    if (!grant) throw new Error('課堂 AI 已停用或缺少即時互動授權；不會改用 MCP 或模擬回應。');
    return liveClassroomModel(grant);
  }
  const ownerId = params.workspaceId;`);
  await replace('lib/study-mcp/store.ts', 'export async function requestMcpOutput(', 'import { suspendForMcp } from "@/lib/study-workers/context";\nexport async function requestMcpOutput(');
  await replace('lib/study-mcp/store.ts', '    if (rows[0].response) return rows[0].response;', '    if (rows[0].response) return rows[0].response;\n    suspendForMcp();');
  await replace('lib/server/agent-runtime/runner.ts', 'const WORKER_ID =', 'export const WORKER_ID =');
  for (const [factory, sdk] of [['createOpenAI','openai'],['createAzure','azure'],['createAnthropic','anthropic'],['createAmazonBedrock','amazon-bedrock'],['createGoogleGenerativeAI','google']]) {
    await replace('lib/ai/providers.ts', `import { ${factory} } from '@ai-sdk/${sdk}';`, `import { ${factory} } from '@/lib/study-workers/api-disabled';`);
  }
  for (const file of ['lib/document/extractors/images.ts', 'lib/server/materials/inline-images.ts', 'lib/pdf/pdf-providers.ts']) {
    await replace(file, "import sharp from 'sharp';", "import sharp from '@/lib/study-workers/images';");
  }
  await rm(path.join(core, 'proxy.ts'), { force: true });
  await rm(path.join(core, 'middleware.ts'), { force: true });
  await replace('next.config.ts', "  output: 'standalone',", "  output: 'standalone',\n  turbopack: { root: process.cwd() },");
  await replace('next.config.ts', '  typescript: {', '  typescript: {\n    ignoreBuildErrors: true, // Checked separately before bundling to bound peak memory.');
  await replace('next.config.ts', "    ...(process.env.OPENMAIC_MCP_MODE === '1' ? { cpus: 1 } : {}),", "    cpus: 1,\n    turbopackMemoryEviction: 'full',");
  await replace('next.config.ts', '  env: {', "  env: {\n    OPENMAIC_WORKERS: '1',");
  await writeFile(path.join(core, 'worker-env.d.ts'), `interface CloudflareEnv { STUDY_MCP_SECRET: string; OPENMAIC_SECRET_KEY: string }\ndeclare module 'cloudflare:workers' {\n  const DurableObject: typeof import('@cloudflare/workers-types').CloudflareWorkersModule.DurableObject;\n  export { DurableObject };\n}\n`);
  const config = JSON.parse(await readFile(path.join(integration, 'wrangler.core.jsonc'), 'utf8'));
  delete config.$schema;
  config.main = './worker.ts'; config.assets.directory = './.open-next/assets';
  config.vars.OPENMAIC_AGENT_SKILLS_DIR = '/tmp/study-skills';
  await writeFile(path.join(core, 'wrangler.jsonc'), JSON.stringify(config, null, 2) + '\n');
  const parserConfig = JSON.parse(await readFile(path.join(integration, 'wrangler.parser.jsonc'), 'utf8'));
  delete parserConfig.$schema;
  await writeFile(path.join(core, 'wrangler.parser.jsonc'), JSON.stringify(parserConfig, null, 2) + '\n');
  await cp(path.join(integration, 'wrangler.jobs.jsonc'), path.join(core, 'wrangler.jobs.jsonc'));
  await writeFile(path.join(core, '.env.local'), 'OPENMAIC_WORKERS=1\nOPENMAIC_MCP_MODE=1\nDATABASE_URL=postgres://workers/openmaic\nOPENMAIC_AGENT_SKILLS_DIR=/tmp/study-skills\nNEXT_PUBLIC_PRO_WORKBENCH_ENABLED=1\n');
  if (!process.argv.includes('--no-install')) {
    await run('npm', ['ci', '--ignore-scripts'], integration);
    await run('pnpm', ['install', '--ignore-scripts', '--frozen-lockfile'], core);
  }
  console.log('Prepared full pinned OpenMAIC core for Cloudflare Workers.');
}
if (action === 'prepare') await prepare();
else if (action === 'build') {
  await rm(path.join(core, '.open-next/study-build-verified.json'), { force: true });
  // Next validates host identity during prerendering; production uses the Worker secret.
  env.STUDY_MCP_SECRET = randomBytes(32).toString('hex');
  env.OPENMAIC_SECRET_KEY = randomBytes(32).toString('base64');
  if (!process.argv.includes('--skip-packages')) for (const workspace of ['mathml2omml', 'pptxgenjs', '@openmaic/dsl', '@openmaic/geometry', '@openmaic/generation', '@openmaic/storage', '@openmaic/importer', '@openmaic/renderer', '@openmaic/editor']) await run('npm', ['run', 'build'], path.join(core, 'packages', workspace));
  await run('node', ['scripts/sync-maic-importer.mjs'], core);
  await run('node', ['scripts/sync-interactive-assets.mjs'], core);
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'types', '--config', 'wrangler.jsonc', '--strict-vars=false', '--include-runtime=false', '--env-interface', 'CloudflareEnv', 'cloudflare-env.d.ts'], core);
  let bindings = await readFile(path.join(core, 'cloudflare-env.d.ts'), 'utf8');
  bindings = bindings.replace(/declare namespace /g, 'namespace ');
  bindings = bindings.replace(/OPENMAIC_DATABASE: DurableObjectNamespace[^;]*;/, 'OPENMAIC_DATABASE: DurableObjectNamespace<import("./lib/study-workers/database").DatabaseApi>;');
  bindings = bindings.replace(/OPENMAIC_JOBS: DurableObjectNamespace[^;]*;/, 'OPENMAIC_JOBS: DurableObjectNamespace<import("./lib/study-workers/jobs-worker").JobsApi>;');
  bindings = bindings.replace(/WORKER_SELF_REFERENCE: Service[^;]*;/, 'WORKER_SELF_REFERENCE: Fetcher;');
  const aliases = ['R2Bucket','ImagesBinding','Fetcher','KVNamespace','D1Database','Queue','IncomingRequestCfProperties','ExecutionContext'].map(name => `type ${name} = CF.${name};`).join('\n');
  await writeFile(path.join(core, 'cloudflare-env.d.ts'), `import type * as CF from '@cloudflare/workers-types';\ndeclare global {\n${aliases}\ntype DurableObjectNamespace<T extends CF.Rpc.DurableObjectBranded | undefined = undefined> = CF.DurableObjectNamespace<T>;\ntype Service<T extends CF.Rpc.WorkerEntrypointBranded | CF.ExportedHandler | undefined = undefined> = CF.Service<T>;\n${bindings}\n}\n`);
  // Type-check the host boundary, without re-analyzing the generated 60 MB framework bundle.
  await mkdir(path.join(core, '.open-next'), { recursive: true });
  await writeFile(path.join(core, '.open-next/worker.d.ts'), `import type { Request, Response, ExecutionContext } from '@cloudflare/workers-types';\ndeclare const handler: { fetch(request: Request, env: CloudflareEnv, context: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> };\nexport default handler;\n`);
  await run('node', ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json', '--noEmit'], core, { NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=2048' });
  if (process.argv.includes('--typecheck-only')) { console.log('Full core TypeScript passed; no deployment bundle was built.'); process.exit(0); }
  await run('node', ['node_modules/@opennextjs/cloudflare/dist/cli/index.js', 'build'], core);
  // A non-ASCII Core bundle is held as two-byte text past the isolate memory limit, so every request boots Next.js again.
  for (const file of await bundleSources(path.join(core, '.open-next'))) await asciiBundle(file);
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'wrangler.jsonc', '--outdir', path.join(core, '.open-next/deploy')], core);
  if (/[^\x00-\x7f]/.test(await readFile(path.join(core, '.open-next/deploy/worker.js'), 'utf8'))) throw new Error('Core Worker bundle is not ASCII; isolates would not be reused');
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'wrangler.parser.jsonc', '--outdir', path.join(core, '.open-next/parser-worker')], core);
  await writeFile(path.join(core, '.open-next/study-build-verified.json'), JSON.stringify({ checkedAt: new Date().toISOString(), sourceRevision: process.env.GITHUB_SHA, typescript: true, build: true, asciiBundle: true }));
} else if (action === 'deploy') {
  await readFile(path.join(core, '.open-next/study-build-verified.json'));
  await readFile(path.join(core, '.open-next/worker.js'));
  const databaseSecrets = await secretFile(path.join(root, '.openmaic/cloudflare-db'), 'DATABASE_ADMIN_SECRET');
  const coreSecrets = await secretFile(path.join(root, '.openmaic/cloudflare-core'), 'STUDY_MCP_SECRET');
  const runtimeSecrets = JSON.parse(await readFile(coreSecrets.file, 'utf8'));
  if (!runtimeSecrets.OPENMAIC_SECRET_KEY) { runtimeSecrets.OPENMAIC_SECRET_KEY = randomBytes(32).toString('base64'); await writeFile(coreSecrets.file, JSON.stringify(runtimeSecrets), { mode: 0o600 }); }
  await run('npm', ['ci', '--ignore-scripts'], integration);
  await run('node', ['scripts/prepare-database.mjs'], integration);
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', path.join(integration, 'wrangler.database.jsonc'), '--secrets-file', databaseSecrets.file]);
  await run('node', [path.join(integration, 'scripts/verify-database.mjs')]);
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', path.join(core, '.open-next/parser-worker/parser-worker.js'), '--no-bundle', '--config', 'wrangler.parser.jsonc'], core);
  const jobsSecrets = path.join(root, '.openmaic/cloudflare-core/jobs-secrets.json');
  await writeFile(jobsSecrets, JSON.stringify({ STUDY_MCP_SECRET: coreSecrets.value }), { mode: 0o600 });
  if (process.argv.includes('--bootstrap')) {
    const initialJobs = JSON.parse(await readFile(path.join(core, 'wrangler.jobs.jsonc'), 'utf8'));
    initialJobs.services = []; initialJobs.triggers = { crons: [] };
    await writeFile(path.join(core, 'wrangler.jobs.bootstrap.jsonc'), JSON.stringify(initialJobs));
    await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.jobs.bootstrap.jsonc', '--secrets-file', jobsSecrets], core);
  } else await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.jobs.jsonc', '--secrets-file', jobsSecrets], core);
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.jsonc', '--secrets-file', coreSecrets.file], core);
  if (process.argv.includes('--bootstrap')) await run('node', ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'wrangler.jobs.jsonc', '--secrets-file', jobsSecrets], core);
  await verifyCore(coreSecrets.value);
} else if (action === 'connect') {
  const { value } = await secretFile(path.join(root, '.openmaic/cloudflare-core'), 'STUDY_MCP_SECRET');
  await verifyCore(value);
  const configPath = path.join(root, 'wrangler.jsonc');
  let config = await readFile(configPath, 'utf8');
  if (!config.includes('"binding": "OPENMAIC_CORE"')) {
    const coreConfig = JSON.parse(await readFile(path.join(integration, 'wrangler.core.jsonc'), 'utf8'));
    const binding = JSON.stringify({ binding: 'OPENMAIC_CORE', service: coreConfig.name });
    config = config.includes('"services":') ? config.replace(/"services":\s*\[/, `"services": [${binding},`) : config.replace('  "observability":', `  "services": [${binding}],\n  "observability":`);
    if (!config.includes('"binding": "OPENMAIC_CORE"')) throw new Error('Cannot safely insert core service binding');
    await writeFile(configPath, config);
  }
  const file = path.join(root, '.openmaic/cloudflare-core/study-secrets.json');
  await writeFile(file, JSON.stringify({ OPENMAIC_CORE_URL: coreOrigin, OPENMAIC_MCP_SECRET: value }), { mode: 0o600 });
  await run('node', ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk', file]);
  await run('npm', ['run', 'cf-typegen']);
  await run('npm', ['run', 'deploy']);
} else if (action === 'verify') {
  const { value } = await secretFile(path.join(root, '.openmaic/cloudflare-core'), 'STUDY_MCP_SECRET');
  await verifyCore(value);
} else throw new Error(`Unknown Workers action: ${action}`);
