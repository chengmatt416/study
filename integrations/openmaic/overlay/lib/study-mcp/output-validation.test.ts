import { describe, expect, it, vi } from "vitest";
import { generateText, tool } from "ai";
import { z } from "zod";
import { outputErrors } from "./output-validation";
import { createMcpLanguageModel } from "./model";

const schema = {
  type: "object", properties: { ratio: { $ref: "#/$defs/positive" }, unit: { enum: ["s"] } },
  required: ["ratio", "unit"], additionalProperties: false,
  $defs: { positive: { type: "number", exclusiveMinimum: 0 } },
};
const request = { responseFormat: { type: "json", schema }, tools: [{ type: "function", name: "calculate", inputSchema: schema }] };
const call = (args: Record<string, unknown>, name = "calculate") => ({ text: "", tool_calls: [{ id: "c1", name, arguments: args }] });

describe("Official model output preflight", () => {
  it("checks JSON response schemas with refs, required properties, enums and extra fields", () => {
    expect(outputErrors(request, { text: '{"ratio":2,"unit":"s"}' })).toEqual([]);
    expect(outputErrors(request, { text: '{"ratio":-2,"unit":"kg","extra":true}' })).toEqual(expect.arrayContaining([expect.stringContaining("/ratio"), expect.stringContaining("/unit")]));
    expect(outputErrors(request, { text: '{"ratio":2}' }).length).toBeGreaterThan(0);
    expect(outputErrors(request, { text: '```json\n{}\n```' })).toEqual([expect.stringContaining("valid JSON")]);
    expect(outputErrors({ responseFormat: { type: "json", schema: false } }, { text: "{}" }).length).toBeGreaterThan(0);
  });
  it("validates declared tool argument schemas before any execution", () => {
    expect(outputErrors(request, call({ ratio: 2, unit: "s" }))).toEqual([]);
    expect(outputErrors(request, call({ ratio: "2", unit: "s" }))).toEqual([expect.stringContaining("tool_calls[0].arguments/ratio")]);
    expect(outputErrors(request, call({ ratio: 2, unit: "s" }, "unknown"))).toEqual([expect.stringContaining("not declared")]);
  });
  it("enforces required, none and named tool choice", () => {
    expect(outputErrors({ ...request, toolChoice: { type: "required" } }, { text: '{"ratio":2,"unit":"s"}' })).toEqual([expect.stringContaining("requires at least one")]);
    expect(outputErrors({ ...request, toolChoice: { type: "none" } }, call({ ratio: 2, unit: "s" }))).toEqual([expect.stringContaining("forbids")]);
    expect(outputErrors({ ...request, toolChoice: { type: "tool", toolName: "calculate" } }, call({ ratio: 2, unit: "s" }))).toEqual([]);
    expect(outputErrors({ ...request, toolChoice: { type: "tool", toolName: "other" } }, call({ ratio: 2, unit: "s" }))).toEqual([expect.stringContaining("required tool")]);
  });
  it("accepts optional legacy metadata and does not compile schemas or execute tools", () => {
    const forbidden = vi.spyOn(globalThis, "Function").mockImplementation(() => { throw Error("runtime code compilation forbidden"); });
    try {
      expect(outputErrors(null, { text: "legacy response" })).toEqual([]);
      expect(outputErrors({ responseFormat: { type: "json" } }, { text: "{}" })).toEqual([]);
      expect(outputErrors(request, call({ ratio: 2, unit: "s" }))).toEqual([]);
      expect(forbidden).not.toHaveBeenCalled();
    } finally { forbidden.mockRestore(); }
  });
  it("bounds error count and large-output diagnostics", () => {
    const output = { text: "", tool_calls: Array.from({ length: 64 }, (_, i) => ({ id: String(i), name: "x".repeat(2000), arguments: {} })) };
    const errors = outputErrors(request, output);
    expect(errors).toHaveLength(30); expect(errors.every(error => error.length <= 600)).toBe(true);
    const large = outputErrors({ responseFormat: { type: "json", schema: { type: "array", items: { type: "number" } } } }, { text: JSON.stringify(Array(20_000).fill("not a number")) });
    expect(large).toHaveLength(1); expect(large[0]).toContain("bounded task");
  });
  it("validates schemas actually requested by the official AI SDK", async () => {
    const execute = vi.fn(async ({ value }: { value: number }) => ({ value }));
    let turn = 0;
    const model = createMcpLanguageModel(async official => {
      if (turn++ === 0) {
        expect(outputErrors(official, { text: "", tool_calls: [{ id: "c", name: "double", arguments: { value: "wrong" } }] })).toEqual([expect.stringContaining("/value")]);
        const output = { text: "", tool_calls: [{ id: "c", name: "double", arguments: { value: 4 } }] };
        expect(outputErrors(official, output)).toEqual([]);
        expect(execute).not.toHaveBeenCalled();
        return output;
      }
      return { text: "done" };
    });
    const result = await generateText({ model, prompt: "calculate", tools: { double: tool({ inputSchema: z.object({ value: z.number() }), execute }) } });
    expect(result.toolResults).toHaveLength(1); expect(execute).toHaveBeenCalledOnce();
  });
});
