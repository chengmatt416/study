// 單變數 / 雙變數統計（輸出對齊 TI-84 1-Var Stats / 2-Var Stats / 回歸）。
import * as ss from "simple-statistics";
export const MAX_STATS_OBSERVATIONS = 100_000;

export interface OneVarResult {
  n: number;
  mean: number;
  sum: number;
  sumSq: number;
  sx: number | null; // 樣本標準差
  sigmaX: number; // 母體標準差
  variance: number; // 母體變異數
  sampleVariance: number | null;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  range: number;
  iqr: number;
  modes: number[];
  outliers: number[];
  lowerFence: number;
  upperFence: number;
  whiskerMin: number;
  whiskerMax: number;
}

/** 依 TI-84 方法計算四分位數（中位數不含在上下半部）。 */
export function quartilesTI(sorted: number[]): { q1: number; median: number; q3: number } {
  const n = sorted.length;
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const median = med(sorted);
  if (n < 2) return { q1: median, median, q3: median };
  const lower = sorted.slice(0, Math.floor(n / 2));
  const upper = sorted.slice(Math.ceil(n / 2));
  return { q1: med(lower), median, q3: med(upper) };
}

/** values 搭配可選的頻數 freqs。 */
export function oneVar(values: number[], freqs?: number[]): OneVarResult {
  if (values.some((value) => !Number.isFinite(value))) throw new Error("數據必須是有效數值");
  if (freqs && (freqs.length !== values.length || freqs.some((frequency) => !Number.isSafeInteger(frequency) || frequency < 0))) throw new Error("每個數值都需要非負整數頻數");
  const count = freqs ? freqs.reduce((sum, frequency) => sum + frequency, 0) : values.length;
  if (count > MAX_STATS_OBSERVATIONS) throw new Error(`資料超過 ${MAX_STATS_OBSERVATIONS.toLocaleString()} 筆，請縮小範圍後再分析`);
  const data: number[] = [];
  values.forEach((v, i) => {
    const f = freqs?.[i] ?? 1;
    for (let k = 0; k < f; k++) data.push(v);
  });
  if (data.length === 0) throw new Error("沒有資料");
  const sorted = [...data].sort((a, b) => a - b);
  const n = data.length;
  const sum = data.reduce((s, x) => s + x, 0);
  const mean = sum / n;
  const sumSq = data.reduce((s, x) => s + x * x, 0);
  const variance = data.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const sampleVariance = n > 1 ? (variance * n) / (n - 1) : null;
  const { q1, median, q3 } = quartilesTI(sorted);
  const iqr = q3 - q1;
  const counts = new Map<number, number>();
  for (const x of data) counts.set(x, (counts.get(x) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const modes = maxCount > 1 ? [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v).sort((a, b) => a - b) : [];
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const inside = sorted.filter((value) => value >= lowerFence && value <= upperFence);
  return {
    n,
    mean,
    sum,
    sumSq,
    sx: sampleVariance === null ? null : Math.sqrt(sampleVariance),
    sigmaX: Math.sqrt(variance),
    variance,
    sampleVariance,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    iqr,
    modes,
    outliers: [...new Set(sorted.filter((x) => x < lowerFence || x > upperFence))],
    lowerFence,
    upperFence,
    whiskerMin: inside[0],
    whiskerMax: inside[inside.length - 1],
  };
}

export type RegressionModel = "linear" | "quadratic" | "cubic" | "exponential" | "power" | "logarithmic";

export interface RegressionResult {
  model: RegressionModel;
  equation: string;
  latex: string;
  coefficients: Record<string, number>;
  r?: number;
  r2: number;
  predict: (x: number) => number;
}

export interface TwoVarResult {
  n: number;
  meanX: number;
  meanY: number;
  sumX: number;
  sumY: number;
  sumX2: number;
  sumY2: number;
  sumXY: number;
  sx: number | null;
  sy: number | null;
  sigmaX: number;
  sigmaY: number;
  r: number | null;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function twoVar(xs: number[], ys: number[]): TwoVarResult {
  if (xs.length !== ys.length) throw new Error("x 與 y 筆數不同");
  const n = xs.length;
  if (n < 2) throw new Error("至少需要 2 筆資料");
  if (n > MAX_STATS_OBSERVATIONS) throw new Error(`資料超過 ${MAX_STATS_OBSERVATIONS.toLocaleString()} 筆，請縮小範圍後再分析`);
  if ([...xs, ...ys].some((value) => !Number.isFinite(value))) throw new Error("數據必須是有效數值");
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const sumX = sum(xs);
  const sumY = sum(ys);
  const meanX = sumX / n;
  const meanY = sumY / n;
  const sumX2 = sum(xs.map((x) => x * x));
  const sumY2 = sum(ys.map((y) => y * y));
  const sumXY = sum(xs.map((x, i) => x * ys[i]));
  const varX = sum(xs.map((value) => (value - meanX) ** 2)) / n;
  const varY = sum(ys.map((value) => (value - meanY) ** 2)) / n;
  const r = varX > 0 && varY > 0 ? ss.sampleCorrelation(xs, ys) : null;
  return {
    n, meanX, meanY, sumX, sumY, sumX2, sumY2, sumXY,
    sx: Math.sqrt((varX * n) / (n - 1)),
    sy: Math.sqrt((varY * n) / (n - 1)),
    sigmaX: Math.sqrt(varX),
    sigmaY: Math.sqrt(varY),
    r,
    minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function r2Of(ys: number[], pred: number[]): number {
  const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
  const ssTot = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - pred[i]) ** 2, 0);
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

/** 最小平方多項式擬合（正規方程 + 高斯消去）。 */
function polyFit(xs: number[], ys: number[], degree: number): number[] {
  const m = degree + 1;
  const A: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < xs.length; i++) {
    const pw = [1];
    for (let k = 1; k <= 2 * degree; k++) pw.push(pw[k - 1] * xs[i]);
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += pw[r + c];
      A[r][m] += pw[r] * ys[i];
    }
  }
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) throw new Error("資料不足以擬合此模型");
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= m; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row, i) => row[m] / A[i][i]); // c0 + c1 x + c2 x^2 ...
}

/** TI-84 對 ExpReg / PwrReg / LnReg 回報線性化後的 r 與 r² */
function linR(u: number[], v: number[]): { r: number; r2: number } {
  const r = ss.sampleCorrelation(u, v);
  return { r, r2: r * r };
}

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return String(v);
  const s = Number(v.toPrecision(6)).toString();
  return s;
};
const signed = (v: number) => (v < 0 ? ` - ${fmt(-v)}` : ` + ${fmt(v)}`);

export function regression(xs: number[], ys: number[], model: RegressionModel): RegressionResult {
  if (xs.length !== ys.length || xs.length < 2) throw new Error("至少需要 2 組 (x, y)");
  if ([...xs, ...ys].some((value) => !Number.isFinite(value))) throw new Error("數據必須是有效數值");
  if (new Set(xs).size < 2) throw new Error("回歸需要至少 2 個不同的 x 值");
  switch (model) {
    case "linear": {
      const { m, b } = ss.linearRegression(xs.map((x, i) => [x, ys[i]]));
      const predict = (x: number) => m * x + b;
      const r = ss.sampleCorrelation(xs, ys);
      return {
        model, coefficients: { a: m, b }, r, r2: r * r, predict,
        equation: `y = ${fmt(m)}x${signed(b)}`,
        latex: `y = ${fmt(m)}x ${b < 0 ? "-" : "+"} ${fmt(Math.abs(b))}`,
      };
    }
    case "quadratic":
    case "cubic": {
      const deg = model === "quadratic" ? 2 : 3;
      if (xs.length <= deg) throw new Error(`至少需要 ${deg + 1} 組資料`);
      const c = polyFit(xs, ys, deg);
      const predict = (x: number) => c.reduce((s, ci, i) => s + ci * x ** i, 0);
      const names = deg === 2 ? ["c", "b", "a"] : ["d", "c", "b", "a"];
      const coefficients = Object.fromEntries(c.map((v, i) => [names[i], v]));
      const terms = c
        .map((ci, i) => ({ ci, i }))
        .reverse()
        .map(({ ci, i }, k) => {
          const xpart = i === 0 ? "" : i === 1 ? "x" : `x^${i}`;
          return k === 0 ? `${fmt(ci)}${xpart}` : `${signed(ci)}${xpart}`;
        })
        .join("");
      return { model, coefficients, r2: r2Of(ys, xs.map(predict)), predict, equation: `y = ${terms}`, latex: `y = ${terms.replace(/\^(\d)/g, "^{$1}")}` };
    }
    case "exponential": {
      if (ys.some((y) => y <= 0)) throw new Error("指數回歸需要 y > 0");
      const { m, b } = ss.linearRegression(xs.map((x, i) => [x, Math.log(ys[i])]));
      const a = Math.exp(b);
      const base = Math.exp(m);
      const predict = (x: number) => a * base ** x;
      return {
        model, coefficients: { a, b: base }, ...linR(xs, ys.map(Math.log)), predict,
        equation: `y = ${fmt(a)} · ${fmt(base)}^x`, latex: `y = ${fmt(a)} \\cdot ${fmt(base)}^{x}`,
      };
    }
    case "power": {
      if (ys.some((y) => y <= 0) || xs.some((x) => x <= 0)) throw new Error("乘冪回歸需要 x > 0 且 y > 0");
      const { m, b } = ss.linearRegression(xs.map((x, i) => [Math.log(x), Math.log(ys[i])]));
      const a = Math.exp(b);
      const predict = (x: number) => a * x ** m;
      return {
        model, coefficients: { a, b: m }, ...linR(xs.map(Math.log), ys.map(Math.log)), predict,
        equation: `y = ${fmt(a)} · x^${fmt(m)}`, latex: `y = ${fmt(a)} x^{${fmt(m)}}`,
      };
    }
    case "logarithmic": {
      if (xs.some((x) => x <= 0)) throw new Error("對數回歸需要 x > 0");
      const { m, b } = ss.linearRegression(xs.map((x, i) => [Math.log(x), ys[i]]));
      const predict = (x: number) => b + m * Math.log(x);
      return {
        model, coefficients: { a: b, b: m }, ...linR(xs.map(Math.log), ys), predict,
        equation: `y = ${fmt(b)}${signed(m)} ln x`, latex: `y = ${fmt(b)} ${m < 0 ? "-" : "+"} ${fmt(Math.abs(m))}\\ln x`,
      };
    }
  }
}

/** 解析貼上的資料：支援換行、逗號、tab、空白分隔；兩欄（x y）或三欄。 */
export function parseColumns(text: string): number[][] {
  const rows = text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), index })).filter(({ line }) => line);
  const out: number[][] = [];
  for (const [position, { line, index }] of rows.entries()) {
    const tokens = /[,;\t]/.test(line) ? line.split(/[,;\t]/).flatMap((part) => part.trim() ? part.trim().split(/\s+/) : [""]) : line.split(/\s+/);
    const values = tokens.map(Number);
    const header = position === 0 && tokens.every((token) => /\p{L}/u.test(token) && !/^[+-]?(?:\d|\.\d)/.test(token) && !/^(?:[+-]?infinity|nan)$/i.test(token));
    if (header) continue;
    if (tokens.some((token) => !token) || values.some((value) => !Number.isFinite(value))) throw new Error(`第 ${index + 1} 列包含空白或無效數值`);
    if (!out.length) for (let column = 0; column < values.length; column++) out.push([]);
    if (values.length !== out.length) throw new Error(`第 ${index + 1} 列需要 ${out.length} 個數值`);
    values.forEach((value, column) => out[column].push(value));
  }
  return out;
}

export function parseOneVarInput(text: string, frequency = false): { values: number[]; freqs?: number[]; data: number[] } {
  if (!text.trim()) throw new Error("請輸入數據");
  if (!frequency && (/(?:^|[,;])\s*[,;]/.test(text) || /[,;]\s*$/.test(text))) throw new Error("數據包含空白數值，請檢查分隔符號");
  const columns = frequency ? parseColumns(text) : [text.trim().split(/[\s,;]+/).map(Number)];
  if (frequency && columns.length !== 2) throw new Error("每列需要數值與頻數兩欄");
  const values = columns[0] ?? [], freqs = frequency ? columns[1] : undefined;
  if (!values.length) throw new Error("請輸入數據");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("數據包含無效數值，請檢查後再分析");
  if (freqs?.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("頻數必須是非負整數，不會自動四捨五入");
  const count = freqs ? freqs.reduce((sum, value) => sum + value, 0) : values.length;
  if (count > MAX_STATS_OBSERVATIONS) throw new Error(`資料超過 ${MAX_STATS_OBSERVATIONS.toLocaleString()} 筆，請縮小範圍後再分析`);
  if (!count) throw new Error("頻數總和必須大於 0");
  return { values, freqs, data: values.flatMap((value, index) => Array(freqs?.[index] ?? 1).fill(value) as number[]) };
}

export function histogramBins(data: number[], binCount?: number): { x0: number; x1: number; count: number }[] {
  if (!data.length) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const k = binCount ?? Math.max(1, Math.ceil(Math.log2(data.length) + 1)); // Sturges
  const width = max === min ? 1 : (max - min) / k;
  const bins = Array.from({ length: k }, (_, i) => ({ x0: min + i * width, x1: min + (i + 1) * width, count: 0 }));
  for (const v of data) {
    const idx = Math.min(k - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}
