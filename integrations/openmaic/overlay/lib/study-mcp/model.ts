import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type { ModelRequest, ResolvedModel } from "@/lib/server/resolve-model";
import { requestMcpOutput, type McpOutput } from "./store";
import { MODEL_WORKFLOW } from "./workflow";

type CoreModel = Extract<
  Exclude<LanguageModel, string>,
  { specificationVersion: "v3" }
>;
type CallOptions = Parameters<CoreModel["doGenerate"]>[0];
type ModelResult = Awaited<ReturnType<CoreModel["doGenerate"]>>;
type StreamPart =
  Awaited<ReturnType<CoreModel["doStream"]>>["stream"] extends ReadableStream<
    infer P
  >
    ? P
    : never;
type Transport = (request: unknown, signal?: AbortSignal) => Promise<McpOutput>;

/** The official AI SDK / Pi tool loops keep running; only the model transport yields to MCP. */
export function createMcpLanguageModel(transport: Transport): CoreModel {
  const generate = async (options: CallOptions): Promise<ModelResult> => {
    const output = await transport(
      {
        protocol: "study-openmaic-model/v1",
        workflow: MODEL_WORKFLOW,
        prompt: options.prompt,
        tools: options.tools,
        toolChoice: options.toolChoice,
        responseFormat: options.responseFormat,
        maxOutputTokens: options.maxOutputTokens,
      },
      options.abortSignal,
    );
    const declaredTools = new Set(
      options.tools
        ?.filter((tool) => tool.type === "function")
        .map((tool) => tool.name),
    );
    if (output.tool_calls?.some((call) => !declaredTools.has(call.name)))
      throw new Error(
        "MCP output names a tool outside the official core request",
      );
    const content: ModelResult["content"] = [];
    if (output.text) content.push({ type: "text", text: output.text });
    for (const call of output.tool_calls ?? [])
      content.push({
        type: "tool-call",
        toolCallId: call.id,
        toolName: call.name,
        input: JSON.stringify(call.arguments),
      });
    return {
      content,
      finishReason: {
        unified: output.tool_calls?.length ? "tool-calls" : "stop",
        raw: "mcp-completed",
      },
      warnings: [],
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
    };
  };
  return {
    specificationVersion: "v3",
    provider: "study-mcp",
    modelId: "external-chatbot",
    supportedUrls: {},
    doGenerate: generate,
    async doStream(options) {
      return {
        stream: new ReadableStream<StreamPart>({
          async start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            try {
              const result = await generate(options);
              for (const item of result.content) {
                if (item.type === "text") {
                  controller.enqueue({ type: "text-start", id: "mcp-text" });
                  controller.enqueue({
                    type: "text-delta",
                    id: "mcp-text",
                    delta: item.text,
                  });
                  controller.enqueue({ type: "text-end", id: "mcp-text" });
                } else if (item.type === "tool-call") controller.enqueue(item);
              }
              controller.enqueue({
                type: "finish",
                finishReason: result.finishReason,
                usage: result.usage,
              });
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }),
      };
    },
  };
}
export function resolveMcpModel(params: ModelRequest): ResolvedModel {
  if (!params.workspaceId?.startsWith("study:"))
    throw new Error("MCP model resolution requires a verified STUDY workspace");
  const ownerId = params.workspaceId;
  const resolutionId = randomUUID();
  return {
    model: createMcpLanguageModel((request, signal) =>
      requestMcpOutput(
        ownerId,
        params.stage ?? "classroom",
        request,
        signal,
        resolutionId,
      ),
    ),
    modelString: "study-mcp/external-chatbot",
    providerId: "study-mcp",
    modelId: "external-chatbot",
    modelInfo: {
      id: "external-chatbot",
      name: "MCP chatbot",
      capabilities: { tools: true, streaming: true, vision: true },
    },
    apiKey: "",
    serverManaged: false,
  };
}
