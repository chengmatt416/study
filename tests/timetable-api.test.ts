import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { callApi } from "../src/worker/mcp/internal";
import { buildServer, WRITE_TOOLS } from "../src/worker/mcp/server";
import { testDatabase } from "./helpers/d1";

const user = { id: "member", email: "member@test.example", name: "Member", avatar_url: null, role: "member" as const };
const other = { ...user, id: "other", email: "other@test.example" };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
const term = { academic_year: 2026, semester: "1" };

describe("課表 API 與 MCP", () => {
  let fixture: ReturnType<typeof testDatabase>;
  let env: Env;
  const api = <T = Record<string, any>>(method: string, path: string, body?: unknown, who = user) => callApi<T>(env, ctx, who, method, path, body);
  const rule = (feature: string) => fixture.db.prepare("INSERT OR REPLACE INTO access_rules(group_id,resource_type,resource_id,allowed) VALUES ('students','feature',?,0)").run(feature);
  beforeEach(() => {
    fixture = testDatabase();
    fixture.db.exec("INSERT INTO allowlist(email,role,created_at) VALUES ('member@test.example','member',1),('other@test.example','member',1)");
    fixture.db.exec("INSERT INTO users(id,email,created_at) VALUES ('member','member@test.example',1),('other','other@test.example',1)");
    fixture.db.exec("INSERT INTO subjects(id,slug,name,sort) VALUES ('chem','chem','Chemistry',1)");
    env = { DB: fixture.DB } as Env;
  });
  afterEach(() => fixture.db.close());

  it("新增、列出、局部修改與刪除，且只看得到自己的課表", async () => {
    const { entry } = await api("POST", "/api/timetable", { ...term, day: 2, start: "09:00", end: "09:50", title: " 化學 ", room: "B204", subject_id: "chem" });
    expect(entry).toMatchObject({ day: 2, title: "化學", room: "B204", subject_id: "chem", semester: "1" });
    await api("POST", "/api/timetable", { ...term, day: 1, start: "08:00", end: "08:50", title: "數學" });
    expect((await api("GET", "/api/timetable?academic_year=2026&semester=1")).entries.map((e: { title: string }) => e.title)).toEqual(["數學", "化學"]);
    expect((await api("GET", "/api/timetable?academic_year=2026&semester=2")).entries).toEqual([]);
    expect((await api("GET", "/api/timetable?academic_year=2026&semester=1", undefined, other)).entries).toEqual([]);

    const patched = await api("PUT", `/api/timetable/${entry.id}`, { end: "10:10", room: null });
    expect(patched.entry).toMatchObject({ title: "化學", start: "09:00", end: "10:10", subject_id: "chem" });
    expect(patched.entry.room).toBeUndefined();
    await expect(api("PUT", `/api/timetable/${entry.id}`, { start: "11:00" })).rejects.toMatchObject({ status: 400 });
    await expect(api("PUT", `/api/timetable/${entry.id}`, { title: "x" }, other)).rejects.toMatchObject({ status: 404 });
    await expect(api("DELETE", `/api/timetable/${entry.id}`, undefined, other)).rejects.toMatchObject({ status: 404 });
    await api("DELETE", `/api/timetable/${entry.id}`);
    expect((await api("GET", "/api/timetable?academic_year=2026&semester=1")).entries).toHaveLength(1);
  });

  it("拒絕不合法的時間、科目與學期", async () => {
    const ok = { ...term, day: 1, start: "08:00", end: "08:50", title: "數學" };
    for (const bad of [{ ...ok, end: "07:00" }, { ...ok, start: "8:00" }, { ...ok, day: 8 }, { ...ok, title: " " }, { ...ok, semester: "3" }, { ...ok, subject_id: "missing" }]) {
      await expect(api("POST", "/api/timetable", bad)).rejects.toMatchObject({ status: 400 });
    }
    expect(fixture.db.prepare("SELECT COUNT(*) AS n FROM timetable_entries").get()).toEqual({ n: 0 });
  });

  it("功能開關「課綱」關閉時課表也不可用", async () => {
    fixture.db.exec("INSERT INTO access_groups(id,name,created_at) VALUES ('students','Students',1); INSERT INTO access_group_members(group_id,email) VALUES ('students','member@test.example')");
    rule("syllabi");
    await expect(api("GET", "/api/timetable")).rejects.toMatchObject({ status: 403 });
    expect((await api("GET", "/api/timetable", undefined, other)).entries).toEqual([]);
  });

  it("MCP 可讀取與修改課表，唯讀授權不能寫入", async () => {
    for (const name of ["add_timetable_entry", "update_timetable_entry", "delete_timetable_entry"]) expect(WRITE_TOOLS.has(name)).toBe(true);
    const server = buildServer({ env, ctx, user, scopes: ["study:read", "study:write"], origin: "https://study.test" });
    const client = new Client({ name: "timetable-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const call = async (name: string, args: Record<string, unknown>) => { const r = await client.callTool({ name, arguments: args }); const t = r.content[0].type === "text" ? r.content[0].text : ""; return { error: r.isError === true, data: r.isError ? t : JSON.parse(t) }; };
    try {
      const added = await call("add_timetable_entry", { ...term, day: 3, start: "10:00", end: "10:50", title: "物理" });
      expect(added.data).toMatchObject({ title: "物理", conflicts: [] });
      const clash = await call("add_timetable_entry", { ...term, day: 3, start: "10:30", end: "11:20", title: "英文", room: "A1" });
      expect(clash.data.conflicts).toEqual([expect.objectContaining({ title: "物理" })]);
      const updated = await call("update_timetable_entry", { entry_id: clash.data.entry_id, start: "11:00", end: "11:50" });
      expect(updated.data).toMatchObject({ start: "11:00", room: "A1", conflicts: [] });
      expect((await call("update_timetable_entry", { entry_id: "nope", title: "x" })).error).toBe(true);
      const listed = await call("list_timetable", term);
      expect(listed.data.entries.map((e: { title: string }) => e.title)).toEqual(["物理", "英文"]);
      expect((await call("delete_timetable_entry", { entry_id: added.data.entry_id })).error).toBe(false);
      expect((await call("list_timetable", term)).data.entries.map((e: { title: string }) => e.title)).toEqual(["英文"]);
      expect((await call("list_timetable", { academic_year: 2026, semester: "2" })).data.entries).toEqual([]);
    } finally { await client.close(); await server.close(); }

    const readOnly = buildServer({ env, ctx, user, scopes: ["study:read"], origin: "https://study.test" });
    const roClient = new Client({ name: "timetable-ro", version: "1" });
    const [c2, s2] = InMemoryTransport.createLinkedPair();
    await Promise.all([readOnly.connect(s2), roClient.connect(c2)]);
    try {
      const r = await roClient.callTool({ name: "add_timetable_entry", arguments: { ...term, day: 1, start: "08:00", end: "08:50", title: "數學" } });
      expect(r.isError).toBe(true);
    } finally { await roClient.close(); await readOnly.close(); }
  });
});
