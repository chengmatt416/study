import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.resolve(root, process.env.OPENMAIC_CORE_DIR ?? ".openmaic/core");
const integration = path.join(root, "integrations/openmaic");
const lock = JSON.parse(
  await readFile(path.join(integration, "core.lock.json"), "utf8"),
);
const command = process.argv[2] ?? "setup";
async function run(cmd, args, cwd = core, capture = false, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      detached: process.platform !== "win32",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      env: {
        ...process.env,
        OPENMAIC_MCP_MODE: "1",
        OPENMAIC_DB_PORT: process.env.OPENMAIC_DB_PORT ?? "55432",
        ...extraEnv,
      },
    });
    let stopSignal;
    const forward = (signal) => {
      stopSignal = signal;
      try {
        if (process.platform === "win32") child.kill(signal);
        else if (child.pid) process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminate);
    const cleanup = () => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    };
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("exit", (code) => {
      cleanup();
      if (stopSignal) process.exit(stopSignal === "SIGINT" ? 130 : 143);
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`${cmd} exited ${code}`));
    });
  });
}
async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
async function replace(file, before, after) {
  const target = path.join(core, file),
    text = await readFile(target, "utf8");
  if (text.includes(after)) return;
  if (text.split(before).length !== 2)
    throw new Error(
      `Pinned OpenMAIC source differs at ${file}; refusing a partial patch`,
    );
  await writeFile(target, text.replace(before, after));
}
if (command === "setup") {
  await mkdir(path.dirname(core), { recursive: true });
  if (!(await exists(path.join(core, ".git")))) {
    await run(
      "git",
      [
        "clone",
        "--no-checkout",
        process.env.OPENMAIC_SOURCE ?? lock.repository,
        core,
      ],
      root,
    );
    await run("git", ["checkout", "--detach", lock.commit]);
  }
  const commit = await run("git", ["rev-parse", "HEAD"], core, true);
  if (commit !== lock.commit)
    throw new Error(
      "Existing core is a different revision. Preserve it and choose the pinned checkout explicitly.",
    );
  const entry = path.join(core, "instrumentation.ts");
  const nodeEntry = path.join(core, "instrumentation.study-node.ts");
  if ((await readFile(entry, "utf8")).includes("./instrumentation.study-node"))
    await cp(nodeEntry, entry);
  await cp(path.join(integration, "overlay"), core, { recursive: true });
  await cp(
    path.join(root, "src/shared/openmaic-transport.ts"),
    path.join(core, "lib/study-mcp/protocol.ts"),
  );
  await replace(
    "lib/server/generation-capabilities.ts",
    "  const [webSearch, imageGeneration, videoGeneration, tts] = await Promise.all([",
    `  if (process.env.OPENMAIC_MCP_MODE === '1') return { webSearch: false, imageGeneration: false, videoGeneration: false, tts: false };\n  const [webSearch, imageGeneration, videoGeneration, tts] = await Promise.all([`,
  );
  await replace(
    "app/api/model-config/route.ts",
    "    const stored = await readWorkspaceModelConfig(await pool(), ownerId);\n    return NextResponse.json(modelSettingsView(stored), { headers });",
    `    const stored = await readWorkspaceModelConfig(await pool(), ownerId);\n    if (process.env.OPENMAIC_MCP_MODE === '1') {\n      const { mcpSettingsView } = await import('@/lib/study-mcp/settings');\n      return NextResponse.json(mcpSettingsView(modelSettingsView(stored)), { headers });\n    }\n    return NextResponse.json(modelSettingsView(stored), { headers });`,
  );
  await replace(
    "lib/server/agent-runtime/runner.ts",
    "export async function runSession(ctx: RunContext, meta: ClaimedAgentSession): Promise<void> {",
    `export async function runSession(ctx: RunContext, meta: ClaimedAgentSession): Promise<void> {\n  const { withMcpScope } = await import('@/lib/study-mcp/context');\n  return withMcpScope(meta.id, () => runSessionInternal(ctx, meta));\n}\nasync function runSessionInternal(ctx: RunContext, meta: ClaimedAgentSession): Promise<void> {`,
  );
  await replace(
    "lib/server/agent-runtime/agent-driver-model.ts",
    "  const resolution = await lookupSlot('agent', workspaceId);",
    `  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    const { resolveMcpModel } = await import('@/lib/study-mcp/model');\n    const connection = resolveMcpModel({ stage: AGENT_DRIVER_STAGE, workspaceId });\n    return { connection, piModel: buildPiDriverModel(connection, DEFAULT_DRIVER_API), reservedOutputTokens: UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS };\n  }\n  const resolution = await lookupSlot('agent', workspaceId);`,
  );
  await replace(
    "next.config.ts",
    "  experimental: {\n    proxyClientMaxBodySize",
    "  experimental: {\n    ...(process.env.OPENMAIC_MCP_MODE === '1' ? { cpus: 1 } : {}),\n    proxyClientMaxBodySize",
  );
  await replace(
    "next.config.ts",
    "  serverExternalPackages: [",
    "  serverExternalPackages: [\n    ...(process.env.OPENMAIC_MCP_MODE === '1' ? ['@ai-sdk/amazon-bedrock', '@ai-sdk/anthropic', '@ai-sdk/azure', '@ai-sdk/google', '@ai-sdk/openai'] : []),",
  );
  await replace(
    "lib/ai/providers.ts",
    "export function isProviderKeyRequired(providerId: string): boolean {",
    "export function isProviderKeyRequired(providerId: string): boolean {\n  if (providerId === 'study-mcp' || providerId === 'study-live') return false;",
  );
  await replace(
    "lib/server/model-config/media.ts",
    "  const resolution = await lookupSlot(slot, workspaceId);",
    "  if (process.env.OPENMAIC_MCP_MODE === '1') throw new SlotDisabledError(slot);\n  const resolution = await lookupSlot(slot, workspaceId);",
  );
  await replace(
    "lib/server/model-config/media.ts",
    "  return (await lookupSlot(slot, workspaceId)).status === 'assigned';",
    "  if (process.env.OPENMAIC_MCP_MODE === '1') return false;\n  return (await lookupSlot(slot, workspaceId)).status === 'assigned';",
  );
  const llmPath = path.join(core, "lib/ai/llm.ts");
  const llmText = await readFile(llmPath, "utf8");
  const previousTimeoutPatch =
    "  if (process.env.OPENMAIC_MCP_MODE === '1' && typeof params.model === 'object' && params.model.provider === 'study-mcp') params = { ...params, timeout: undefined };\n";
  // The first guard refused the live classroom model too, so in-class questions failed.
  const previousGuardPatch =
    "  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    if (typeof params.model !== 'object' || params.model.provider !== 'study-mcp') throw new Error('MCP mode refuses remote model transports');\n    params = { ...params, timeout: undefined };\n  }\n";
  if (llmText.includes(previousTimeoutPatch) || llmText.includes(previousGuardPatch))
    await writeFile(llmPath, llmText.replace(previousTimeoutPatch, "").replace(previousGuardPatch, ""));
  // MCP turns wait for the chatbot without a deadline; the live classroom model (study-live) keeps its timeout.
  await replace(
    "lib/ai/llm.ts",
    "  const record = params as Record<string, unknown>;",
    "  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    const provider = typeof params.model === 'object' ? params.model.provider : undefined;\n    if (provider !== 'study-mcp' && provider !== 'study-live') throw new Error('MCP mode refuses remote model transports');\n    if (provider === 'study-mcp') params = { ...params, timeout: undefined };\n  }\n  const record = params as Record<string, unknown>;",
  );
  await replace(
    "lib/agent/runtime/tool-timeout.ts",
    "  const override = AGENT_TOOL_TIMEOUT_OVERRIDES[toolName];",
    "  if (env.OPENMAIC_MCP_MODE === '1' && ['generate_scene', 'generate_actions'].includes(toolName)) return 0;\n  const override = AGENT_TOOL_TIMEOUT_OVERRIDES[toolName];",
  );
  await replace(
    "lib/server/resolve-model.ts",
    "  const { requestProvidersAllowed } =",
    `  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    const { resolveMcpModel } = await import('@/lib/study-mcp/model');\n    return resolveMcpModel(params);\n  }\n  const { requestProvidersAllowed } =`,
  );
  await replace(
    "instrumentation.ts",
    "  if (process.env.NEXT_RUNTIME !== 'nodejs') return;",
    `  if (process.env.NEXT_RUNTIME !== 'nodejs') return;\n  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    const { installStudyIdentity } = await import('@/lib/study-mcp/identity');\n    installStudyIdentity();\n  }`,
  );
  await replace(
    "lib/server/generation/run/runner.ts",
    "    return await executeGenerationRun(claim, {",
    `    const { withMcpScope } = await import('@/lib/study-mcp/context');\n    return await withMcpScope(claim.run.id, () => executeGenerationRun(claim, {`,
  );
  await replace(
    "lib/server/generation/run/runner.ts",
    "    });\n  } catch (error) {",
    "    }));\n  } catch (error) {",
  );
  await replace(
    "lib/server/generation/run/deadline.ts",
    "  const timeout = new AbortController();",
    `  if (process.env.OPENMAIC_MCP_MODE === '1') return call(runSignal);\n  const timeout = new AbortController();`,
  );
  await replace(
    "middleware.ts",
    "  const { pathname } = request.nextUrl;",
    `  const { pathname } = request.nextUrl;\n  if (process.env.OPENMAIC_MCP_MODE === '1') {\n    const { guardStudyRequest } = await import('@/lib/study-mcp/auth');\n    const refusal = await guardStudyRequest(request);\n    if (refusal) return refusal;\n    return NextResponse.next();\n  }`,
  );
  await cp(entry, nodeEntry);
  await writeFile(
    entry,
    `// Keep the complete official boot sequence in Node's instrumentation graph.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { register } = await import('./instrumentation.study-node');
    await register();
  }
}
`,
  );
  if (!(await exists(path.join(core, ".env.local")))) {
    const { randomBytes } = await import("node:crypto");
    await writeFile(
      path.join(core, ".env.local"),
      `OPENMAIC_MCP_MODE=1\nOPENMAIC_AGENT_RUNTIME_ENABLED=1\nNEXT_PUBLIC_PRO_WORKBENCH_ENABLED=1\nOWNER_SINGLE_USER=false\nOWNER_ANONYMOUS_PREMINT=false\nSTUDY_MCP_SECRET=${randomBytes(32).toString("hex")}\nDATABASE_URL=postgres://openmaic:openmaic-dev@127.0.0.1:55432/openmaic\n`,
      { mode: 0o600 },
    );
    console.log(
      "Created local core configuration; copy STUDY_MCP_SECRET to STUDY as OPENMAIC_MCP_SECRET without putting it in chat.",
    );
  }
  console.log(
    `Full OpenMAIC ${lock.version} (${lock.commit}) with MCP transport installed at ${core}`,
  );
  if (!process.argv.includes("--no-install"))
    await run("pnpm", ["install", "--frozen-lockfile"]);
} else if (command === "connect") {
  const local = Object.fromEntries(
    (await readFile(path.join(core, ".env.local"), "utf8"))
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  if ((local.STUDY_MCP_SECRET ?? "").length < 32)
    throw new Error("Run setup first");
  const target = path.join(root, ".dev.vars");
  let text = (await exists(target)) ? await readFile(target, "utf8") : "";
  for (const [name, value] of Object.entries({
    OPENMAIC_CORE_URL: `http://127.0.0.1:${process.env.OPENMAIC_PORT ?? "3001"}`,
    OPENMAIC_MCP_SECRET: local.STUDY_MCP_SECRET,
  })) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    text = pattern.test(text)
      ? text.replace(pattern, `${name}=${value}`)
      : `${text.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(target, text, { mode: 0o600 });
  console.log(
    "Connected local STUDY to its full OpenMAIC core. No model API key is configured. Restart STUDY dev to load the connection.",
  );
} else if (command === "dev") {
  await run("npm", [
    "run",
    "dev",
    "--",
    "--hostname",
    "127.0.0.1",
    "--port",
    process.env.OPENMAIC_PORT ?? "3001",
    ...process.argv.slice(3),
  ]);
} else if (command === "build") {
  await run("npm", ["run", "build", "--", ...process.argv.slice(3)]);
} else if (command === "start") {
  const standalone = path.join(core, ".next/standalone");
  if (!(await exists(path.join(standalone, "server.js"))))
    throw new Error("Run openmaic:build before starting the production core");
  await cp(path.join(core, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
  await cp(
    path.join(core, ".next/static"),
    path.join(standalone, ".next/static"),
    { recursive: true },
  );
  await run(
    process.execPath,
    ["--env-file-if-exists=.env.local", ".next/standalone/server.js"],
    core,
    false,
    {
      PORT: process.env.OPENMAIC_PORT ?? "3001",
      HOSTNAME: process.env.OPENMAIC_HOST ?? "127.0.0.1",
    },
  );
} else if (command === "test") {
  await run("node", [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.study-mcp.config.ts",
  ]);
} else if (command === "db") {
  await run("npm", ["run", "db:up"]);
} else
  throw new Error(
    "Use setup [--no-install], connect, dev, build, start, test or db",
  );
