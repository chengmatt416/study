import { afterEach, describe, expect, it, vi } from "vitest";
import { readToolStorage, toolStorageKey, writeToolStorage } from "../src/web/features/tools/storage";

describe("private tool storage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps users' tool data separate and leaves legacy values intact", () => {
    const values = new Map([["stats1", "legacy private input"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    expect(writeToolStorage(toolStorageKey("first", "stats1"), "1 2 3")).toBe(true);
    expect(readToolStorage(toolStorageKey("second", "stats1"))).toBeNull();
    expect(readToolStorage(toolStorageKey("first", "stats1"))).toBe("1 2 3");
    expect(readToolStorage("stats1")).toBe("legacy private input");
    expect(toolStorageKey("owner:a", "stats1")).not.toBe(toolStorageKey("owner%3Aa", "stats1"));
  });
  it("reports unavailable or full browser storage without crashing the tool", () => {
    vi.stubGlobal("localStorage", { getItem() { throw Error("blocked"); }, setItem() { throw Error("quota"); } });
    expect(readToolStorage("any")).toBeNull(); expect(writeToolStorage("any", "value")).toBe(false);
  });
});
