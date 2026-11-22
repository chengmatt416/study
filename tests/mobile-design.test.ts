import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { MODULE_KIT_GUIDE } from "../src/shared/module-kit-guide";
import { MOBILE_DESIGN_SECTIONS, mobileDesignGuide } from "../src/shared/mobile-design-guide";
import { buildCoursePrompt } from "../src/shared/openmaic";
import { buildServer } from "../src/worker/mcp/server";

describe("手機優先教材", () => {
  it("指南涵蓋投影片、互動模組、測驗與交付前檢查，並可只取其中一部分", () => {
    const all = mobileDesignGuide();
    for (const part of ["textType=title", "約 60 字", "不超過 80 字", "375×480", "44×44px", "viewport", "375×667", "1280px"]) expect(all, part).toContain(part);
    expect(mobileDesignGuide("slides")).toContain(MOBILE_DESIGN_SECTIONS.slides);
    expect(mobileDesignGuide("slides")).not.toContain("手機版互動模組");
    expect(mobileDesignGuide("quizzes")).toContain("交付前檢查");
  });

  it("課程提示、模組指南與 MCP 說明都要求先讀指南", () => {
    expect(buildCoursePrompt("化學平衡")).toContain("get_mobile_design_guide");
    expect(MODULE_KIT_GUIDE).toContain("get_mobile_design_guide");
  });

  it("MCP 提供唯讀的 get_mobile_design_guide，且在說明中要求手機優先", async () => {
    const server = buildServer({ env: {} as Env, ctx: { waitUntil: () => undefined } as ExecutionContext, user: { id: "u", email: "u@test", name: "U", avatar_url: null, role: "member" }, scopes: ["study:read"], origin: "https://study.test" });
    const client = new Client({ name: "mobile-design", version: "1" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);
    try {
      expect(client.getInstructions()).toContain("get_mobile_design_guide");
      const tool = (await client.listTools()).tools.find((t) => t.name === "get_mobile_design_guide");
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      const result = await client.callTool({ name: "get_mobile_design_guide", arguments: { topic: "modules" } });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain("375×480");
      const guide = await client.callTool({ name: "get_openmaic_guide", arguments: {} });
      expect(JSON.stringify(guide.content)).toContain("get_mobile_design_guide");
    } finally { await client.close(); await server.close(); }
  });
});
