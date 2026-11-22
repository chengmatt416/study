import { describe, expect, it } from "vitest";
import { MAX_STATS_OBSERVATIONS, oneVar, parseColumns, parseOneVarInput, regression, twoVar } from "../src/shared/stats";

describe("statistics input integrity", () => {
  it("keeps an empty dataset empty and rejects mistyped observations", () => {
    expect(parseColumns("  \n ")).toEqual([]);
    expect(() => parseOneVarInput(" ")).toThrow("請輸入數據");
    expect(() => parseOneVarInput("1 broken 3")).toThrow("無效數值");
    expect(() => parseOneVarInput("1,,3")).toThrow("空白數值");
    expect(parseOneVarInput("-1, 2.5; 3e2").values).toEqual([-1, 2.5, 300]);
  });
  it("accepts a first heading but never drops invalid, missing or ragged data rows", () => {
    expect(parseColumns("x,y\n1,2\n3\t4")).toEqual([[1, 3], [2, 4]]);
    for (const text of ["x y\n1 2\n3 bad\n4 5", "1,2\n3,,4", "1 2\n3", "NaN 2\n3 4", "1 Infinity\n3 4"])
      expect(() => parseColumns(text)).toThrow();
  });
  it("validates frequencies exactly and does not round or clamp them", () => {
    for (const text of ["1 -2\n2 1", "1 1.5\n2 2", "1 2 3\n2 3 4", "1 0\n2 0"])
      expect(() => parseOneVarInput(text, true)).toThrow();
    const input = parseOneVarInput("x f\n1 2\n2 0\n3 1", true);
    expect(input.data).toEqual([1, 1, 3]);
    expect(oneVar(input.values, input.freqs)).toMatchObject({ n: 3, mean: 5 / 3 });
  });
  it("rejects excessive frequency expansion before allocating an observation array", () => {
    expect(() => parseOneVarInput(`1 ${MAX_STATS_OBSERVATIONS + 1}`, true)).toThrow("超過");
    expect(() => oneVar([1], [MAX_STATS_OBSERVATIONS + 1])).toThrow("超過");
    expect(() => oneVar([1], [Infinity])).toThrow("非負整數");
    expect(() => oneVar([1, 2], [1])).toThrow("非負整數");
    expect(() => oneVar([NaN])).toThrow("有效數值");
  });
  it("places box-plot whiskers at actual in-range observations rather than at the quartiles", () => {
    expect(oneVar([0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 100])).toMatchObject({ whiskerMin: 9, whiskerMax: 17, outliers: [0, 100] });
  });
  it("keeps variance accurate for large observations with small differences", () => {
    const result = twoVar([1e12, 1e12 + 1, 1e12 + 2], [2e12, 2e12 + 2, 2e12 + 4]);
    expect(result.sx).toBeCloseTo(1); expect(result.sy).toBeCloseTo(2);
    expect(result.sigmaX).toBeCloseTo(Math.sqrt(2 / 3)); expect(result.r).toBeCloseTo(1);
  });
  it("rejects undefined regressions instead of displaying a NaN equation", () => {
    expect(() => regression([1, 1, 1], [2, 3, 4], "linear")).toThrow("不同的 x 值");
    expect(() => regression([1, NaN, 3], [2, 3, 4], "linear")).toThrow("有效數值");
    const horizontal = regression([1, 2, 3], [4, 4, 4], "linear");
    expect(horizontal.predict(20)).toBe(4);
    expect(Number.isFinite(horizontal.r!)).toBe(false);
  });
});
