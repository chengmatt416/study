import { describe, expect, it } from "vitest";
import { validOutput } from "./store";

describe("MCP model response validation", () => {
  it("rejects malformed tool calls without throwing", () => {
    for (const tool_calls of [
      [null],
      [4],
      [{}],
      [{ id: "x", name: "tool", arguments: [] }],
    ]) {
      expect(validOutput({ text: "", tool_calls })).toBe(false);
    }
    const call = { id: "x", name: "tool", arguments: {} };
    expect(validOutput({ text: "", tool_calls: [call, call] })).toBe(false);
    expect(validOutput({ text: "", tool_calls: [call] })).toBe(true);
    expect(validOutput({ text: "" })).toBe(false);
  });
});
