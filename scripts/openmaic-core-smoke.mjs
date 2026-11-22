import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signOpenMaicTicket } from "../src/shared/openmaic-transport.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeDevelopment = process.argv.includes('--node');
const dir = path.join(root, nodeDevelopment ? '.openmaic/qa' : '.openmaic/qa/workers');
await mkdir(dir, { recursive: true, mode: 0o700 });
const config = nodeDevelopment ? Object.fromEntries(
  (await readFile(path.join(root, ".openmaic/core/.env.local"), "utf8"))
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
) : JSON.parse(await readFile(path.join(root, '.openmaic/cloudflare-core/secrets.json'), 'utf8'));
const origin = nodeDevelopment ? `http://127.0.0.1:${process.env.OPENMAIC_PORT ?? "3001"}` : process.env.OPENMAIC_WORKERS_ORIGIN;
if (!origin) throw new Error('Set OPENMAIC_WORKERS_ORIGIN to your own HTTPS Worker origin.');
const request = async (method, endpoint, body) => {
  const token = await signOpenMaicTicket(
    {
      sub: nodeDevelopment ? 'study:core-smoke' : 'study:workers-smoke',
      aud: "study-openmaic",
      scope: "api",
      exp: Date.now() + 60000,
    },
    config.STUDY_MCP_SECRET,
  );
  const response = await fetch(origin + endpoint, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
};
const mode = process.argv[2] ?? "status";
if (mode === "start") {
  const job = await request("POST", "/api/generate-classroom", {
    requirement:
      "這是獨立測試用課堂，不是使用者正式教材。用繁體中文介紹理想彈簧週期 T=2π√(m/k)。安排 3 個場景：一頁逐步講解 slide、一個可調質量且有 SVG 圖形的 interactive、一個 single 題的 quiz。使用黑白灰、自足程式，不生成外部影像/影片/語音。",
  });
  await writeFile(path.join(dir, "run.json"), JSON.stringify(job, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(job));
} else if (mode === "task") {
  const tasks = await request("GET", "/api/study-mcp/tasks");
  const task = tasks.tasks[0];
  if (!task) {
    console.log(JSON.stringify(tasks));
    process.exit(0);
  }
  await writeFile(path.join(dir, "task.json"), JSON.stringify(task, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        id: task.id,
        source: task.source,
        run_id: task.run_id,
        version: task.version,
        request: task.request,
      },
      null,
      2,
    ),
  );
} else if (mode === "submit") {
  const task = JSON.parse(await readFile(path.join(dir, "task.json"), "utf8"));
  const output = JSON.parse(await readFile(process.argv[3], "utf8"));
  console.log(
    JSON.stringify(
      await request("POST", `/api/study-mcp/tasks/${task.id}`, {
        expected_version: task.version,
        output,
      }),
    ),
  );
} else if (mode === "job") {
  const job = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8"));
  console.log(
    JSON.stringify(
      await request("GET", `/api/generate-classroom/${job.jobId}`),
    ),
  );
} else
  console.log(JSON.stringify(await request("GET", "/api/study-mcp/status")));
