import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, streamText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { Type } from "typebox";
import { buildAgent } from "@/lib/agent/runtime/build-agent";
import { createCallLlmStreamFn } from "@/lib/agent/runtime/stream-fn";
import { callLLM } from "@/lib/ai/llm";
import {
  serverMediaConnection,
  mediaSlotAvailable,
} from "@/lib/server/model-config/media";
import { isProviderKeyRequired } from "@/lib/ai/providers";
import { resolveAgentToolTimeoutMs } from "@/lib/agent/runtime/tool-timeout";
afterEach(() => vi.unstubAllEnvs());
import { buildCompleteScene, generateSceneContent } from "@openmaic/generation";
import { validateScene } from "@openmaic/dsl";
vi.mock("./store", () => ({ requestMcpOutput: vi.fn() }));
import { createMcpLanguageModel, resolveMcpModel } from "./model";

describe("Full core through the MCP language-model transport", () => {
  it("runs the official content generator, builder and DSL validator without provider fetch", async () => {
    const content = {
      elements: [
        {
          type: "text",
          id: "concept",
          left: 60,
          top: 60,
          width: 880,
          height: 120,
          rotate: 0,
          content: "<p>質量四倍，週期兩倍。</p>",
          defaultFontName: "system-ui",
          defaultColor: "#171717",
        },
      ],
      background: { type: "solid", color: "#ffffff" },
    };
    const transport = vi.fn(async () => ({ text: JSON.stringify(content) }));
    const model = createMcpLanguageModel(transport);
    const outline = {
      id: "outline-1",
      type: "slide" as const,
      title: "平方根關係",
      order: 0,
      description: "逐步解釋週期公式",
      keyPoints: ["固定彈簧常數", "平方根關係"],
    };
    const generated = await generateSceneContent(
      outline,
      async (system, user) =>
        (await generateText({ model, system, prompt: user })).text,
    );
    expect(generated).not.toBeNull();
    const scene = buildCompleteScene(
      outline,
      generated!,
      [
        {
          id: "speech-1",
          type: "speech",
          text: "先固定彈簧常數，再比較質量比與週期比。",
        },
      ],
      "stage-1",
      { sceneId: "scene-1" },
    );
    expect(scene).toMatchObject({
      type: "slide",
      id: "scene-1",
      content: { type: "slide" },
    });
    expect(validateScene(scene).valid).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]).toBeDefined();
  });

  it("lets the official AI SDK execute declared tools and ask MCP for the next turn", async () => {
    const execute = vi.fn(async ({ value }: { value: number }) => ({
      doubled: value * 2,
    }));
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        tool_calls: [{ id: "call-1", name: "double", arguments: { value: 4 } }],
      })
      .mockResolvedValueOnce({ text: "週期比為二。" });
    const result = await generateText({
      model: createMcpLanguageModel(transport),
      prompt: "請計算",
      tools: {
        double: tool({ inputSchema: z.object({ value: z.number() }), execute }),
      },
      stopWhen: stepCountIs(3),
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.text).toBe("週期比為二。");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(transport.mock.calls[1][0])).toContain("doubled");
  });

  it("runs the official Pi harness and tool loop over MCP", async () => {
    vi.stubEnv("OPENMAIC_MCP_MODE", "1");
    expect(isProviderKeyRequired("study-mcp")).toBe(false);
    expect(await serverMediaConnection("image", "study:owner")).toBe("off");
    expect(await mediaSlotAvailable("image", "study:owner")).toBe(false);
    expect(resolveAgentToolTimeoutMs("generate_scene")).toBe(0);
    expect(resolveAgentToolTimeoutMs("generate_actions")).toBe(0);
    expect(resolveAgentToolTimeoutMs("double")).toBeGreaterThan(0);
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "8" }],
      details: {},
    }));
    const transport = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        tool_calls: [
          { id: "pi-call", name: "double", arguments: { value: 4 } },
        ],
      })
      .mockResolvedValueOnce({ text: "結果為八。" });
    const model = createMcpLanguageModel(transport);
    const agent = buildAgent({
      streamFn: createCallLlmStreamFn({ languageModel: model }),
      systemPrompt: "Use the tool and explain.",
      tools: [
        {
          name: "double",
          label: "Double",
          description: "Double a value",
          parameters: Type.Object({ value: Type.Number() }),
          execute,
        },
      ],
      allowedToolNames: new Set(["double"]),
    });
    await agent.prompt("計算四的兩倍。");
    expect(agent.state.errorMessage).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(agent.state.messages)).toContain("結果為八。");
    expect(JSON.stringify(transport.mock.calls[1][0])).toContain("tool-result");
    await expect(
      callLLM(
        {
          model: { ...model, provider: "remote-provider" },
          prompt: "blocked",
          maxRetries: 0,
        },
        "test",
      ),
    ).rejects.toThrow(/refuses remote/);
  });

  it("streams a submitted MCP turn through the official SDK and refuses undeclared tools", async () => {
    const model = createMcpLanguageModel(async () => ({
      text: "一步一步理解。",
    }));
    const result = streamText({ model, prompt: "解釋概念" });
    let text = "";
    for await (const part of result.textStream) text += part;
    expect(text).toBe("一步一步理解。");
    await expect(
      generateText({
        model: createMcpLanguageModel(async () => ({
          text: "",
          tool_calls: [{ id: "bad", name: "undeclared", arguments: {} }],
        })),
        prompt: "test",
        maxRetries: 0,
      }),
    ).rejects.toThrow(/outside/);
    expect(() => resolveMcpModel({ workspaceId: null })).toThrow(
      /verified STUDY/,
    );
  });
});
