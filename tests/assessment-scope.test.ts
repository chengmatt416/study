import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { testDatabase } from "./helpers/d1";

const member = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
const admin = { ...member, id: "admin", email: "admin@test.example", role: "admin" as const };
const ctx = { waitUntil: () => undefined } as ExecutionContext;

describe("MCP 段考範圍寫入", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, unknown>>(method: string, path: string, body?: unknown, who = admin) => callApi<T>(env, ctx, who, method, path, body);
  const read = (subject = "physics") => fixture.db.prepare("SELECT * FROM assessment_scope WHERE assessment_id='midterm' AND subject_id=?").get(subject);
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('admin','admin@test.example',1),('member','member@test.example',1)");
    fixture.db.exec("INSERT INTO subjects(id,slug,name,sort) VALUES ('physics','qa-physics','Physics',1),('chem','qa-chem','Chemistry',2),('math','qa-math','Math',3)");
    fixture.db.exec("INSERT INTO assessments(id,title,start_date,end_date,created_at) VALUES ('midterm','段考','2026-11-10','2026-11-12',1)");
    fixture.db.exec("INSERT INTO assessment_scope(id,assessment_id,subject_id,has_exam,coverage_md,exam_date) VALUES ('p','midterm','physics',1,'力學','2026-11-10'),('c','midterm','chem',0,'原子結構',null)");
    env = { DB: fixture.DB } as Env;
  });
  afterEach(() => fixture.db.close());

  async function mcp(who: typeof member | typeof admin, scopes: string[], run: (client: Client) => Promise<void>) {
    const server = buildServer({ env, ctx, user: who, scopes, origin: "https://study.test" });
    const client = new Client({ name: "scope-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try { await run(client); } finally { await client.close(); await server.close(); }
  }

  it("管理員經 MCP 修改單科，其他欄位、科目與段考本身維持原值", async () => {
    const chemistry = read("chem");
    await mcp(admin, ["study:read", "study:write"], async (client) => {
      const tools = await client.listTools();
      expect(tools.tools.find((tool) => tool.name === "update_assessment_scope")?.annotations?.readOnlyHint).toBe(false);
      expect(WRITE_TOOLS.has("update_assessment_scope")).toBe(true);
      const list = await client.callTool({ name: "list_assessments", arguments: {} });
      expect(JSON.stringify(list.content)).toContain("midterm");
      const updated = await client.callTool({ name: "update_assessment_scope", arguments: { assessment_id: "midterm", subject_id: "physics", coverage_md: "## 新範圍\n能量與動量" } });
      expect(updated.isError).not.toBe(true);
      expect(JSON.stringify(updated.content)).toContain("能量與動量");
    });
    expect(read()).toMatchObject({ id: "p", coverage_md: "## 新範圍\n能量與動量", has_exam: 1, exam_date: "2026-11-10" });
    expect(read("chem")).toEqual(chemistry);
    expect(fixture.db.prepare("SELECT * FROM assessments WHERE id='midterm'").get()).toMatchObject({ title: "段考", start_date: "2026-11-10", end_date: "2026-11-12" });
  });

  it("可新增單科範圍並明確清空；只改日期時保留範圍", async () => {
    await api("PUT", "/api/assessments/midterm/scope/math", { coverage_md: "微積分", has_exam: true, exam_date: "2026-11-12" });
    expect(read("math")).toMatchObject({ coverage_md: "微積分", has_exam: 1, exam_date: "2026-11-12" });
    await api("PUT", "/api/assessments/midterm/scope/math", { exam_date: null });
    expect(read("math")).toMatchObject({ coverage_md: "微積分", has_exam: 1, exam_date: null });
    await api("PUT", "/api/assessments/midterm/scope/physics", { coverage_md: "", has_exam: false });
    expect(read()).toMatchObject({ coverage_md: "", has_exam: 0, exam_date: "2026-11-10" });
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM assessment_scope").get()).toMatchObject({ n: 3 });
  });

  it("MCP 讀取授權不能寫入，一般成員即使有 study:write 也不能繞過管理員限制", async () => {
    const original = read();
    for (const [who, scopes] of [[admin, ["study:read"]], [member, ["study:read", "study:write"]]] as const) {
      await mcp(who, [...scopes], async (client) => {
        const result = await client.callTool({ name: "update_assessment_scope", arguments: { assessment_id: "midterm", subject_id: "physics", coverage_md: "禁止寫入" } });
        expect(result.isError).toBe(true);
      });
    }
    await expect(api("PUT", "/api/assessments/midterm/scope/physics", { coverage_md: "禁止寫入" }, member)).rejects.toMatchObject({ status: 403 });
    expect(read()).toEqual(original);
  });

  it("拒絕無內容、無效日期、錯誤型別、超長範圍及未知段考/科目，且不修改資料", async () => {
    const original = read();
    for (const patch of [{}, { exam_date: "2026-02-30" }, { has_exam: 0 }, { coverage_md: null }, { coverage_md: "a".repeat(20001) }]) await expect(api("PUT", "/api/assessments/midterm/scope/physics", patch)).rejects.toMatchObject({ status: 400 });
    await expect(api("PUT", "/api/assessments/missing/scope/physics", { coverage_md: "a" })).rejects.toMatchObject({ status: 404 });
    await expect(api("PUT", "/api/assessments/midterm/scope/missing", { coverage_md: "a" })).rejects.toMatchObject({ status: 404 });
    expect(read()).toEqual(original);
  });
});
