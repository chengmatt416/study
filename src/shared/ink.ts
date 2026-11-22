// 手寫筆跡幾何運算（一般橡皮擦）
/** 把筆跡在擦子範圍內的點移除並切成多段（先加密取樣，避免擦子剛好落在兩點之間） */
export function splitInk(points: [number, number, number][], width: number, x: number, y: number, r: number): [number, number, number][][] {
  const R = r + width / 2;
  const step = Math.max(0.5, R / 2);
  const dense: [number, number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    dense.push(p);
    const q = points[i + 1];
    if (!q) break;
    const n = Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1]) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      dense.push([+(p[0] + (q[0] - p[0]) * t).toFixed(2), +(p[1] + (q[1] - p[1]) * t).toFixed(2), +(p[2] + (q[2] - p[2]) * t).toFixed(2)]);
    }
  }
  const segments: [number, number, number][][] = [];
  let cur: [number, number, number][] = [];
  for (const p of dense) {
    if (Math.hypot(p[0] - x, p[1] - y) <= R) {
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length >= 2) segments.push(cur);
  return segments;
}


// ---------- 書寫板 / 手寫作答的文件格式 ----------
export type InkPt = [number, number, number];
export interface InkStroke {
  id: string;
  kind: "pen" | "highlighter";
  color: string;
  size: number;
  points: InkPt[];
}
export interface InkPage {
  id: string;
  strokes: InkStroke[];
}
export type InkBg = "blank" | "grid" | "lines";
export interface InkDoc {
  version: 1;
  bg: InkBg;
  /** 頁高（寬固定 1000）；未設定為 A4 比例 1414 */
  h?: number;
  pages: InkPage[];
}

/**
 * 手寫作答的精簡字串格式（存進作答 JSON，跨裝置可看）：
 * `ink1|bg|h` 後接每頁 `\n#`，每筆 `kind,color,size:x,y,p x,y,p …`（座標取整數、壓力 ×10 取整）
 */
export function encodeInk(doc: InkDoc): string {
  let out = `ink1|${doc.bg}|${doc.h ?? 1414}`;
  for (const pg of doc.pages) {
    out += "\n#";
    for (const s of pg.strokes) {
      const pts = s.points.map((p) => `${Math.round(p[0])},${Math.round(p[1])},${Math.round(p[2] * 10)}`).join(" ");
      out += `\n${s.kind === "highlighter" ? "h" : "p"},${s.color},${s.size}:${pts}`;
    }
  }
  return out;
}

export function decodeInk(src: string): InkDoc | null {
  const lines = src.split("\n");
  const [tag, bg, h] = (lines[0] ?? "").split("|");
  if (tag !== "ink1") return null;
  const pages: InkPage[] = [];
  let n = 0;
  for (const line of lines.slice(1)) {
    if (line === "#") {
      pages.push({ id: `p${pages.length}`, strokes: [] });
      continue;
    }
    const pg = pages[pages.length - 1];
    if (!pg) continue;
    const [head, body = ""] = line.split(":");
    const [k, color, size] = head.split(",");
    const points = body
      .split(" ")
      .filter(Boolean)
      .map((t) => {
        const [x, y, p] = t.split(",").map(Number);
        return [x, y, (p || 5) / 10] as InkPt;
      });
    if (points.length) pg.strokes.push({ id: `s${n++}`, kind: k === "h" ? "highlighter" : "pen", color: /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#111111", size: Number(size) || 5, points });
  }
  return { version: 1, bg: (["blank", "grid", "lines"] as const).find((b) => b === bg) ?? "blank", h: Number(h) || 1414, pages: pages.length ? pages : [{ id: "p0", strokes: [] }] };
}

export const inkStrokeCount = (doc: InkDoc | null) => doc?.pages.reduce((s, p) => s + p.strokes.length, 0) ?? 0;

// ---------- 自由作答（open）的作答值 ----------
/** open 題作答：純文字（打字），或 { mode, text, ink }（可切換打字/手寫，兩者皆保留） */
export interface OpenAnswer {
  mode: "text" | "ink";
  text?: string;
  ink?: string;
}
export function readOpenAnswer(v: unknown): OpenAnswer {
  if (typeof v === "string") return { mode: "text", text: v };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { mode: o.mode === "ink" ? "ink" : "text", text: typeof o.text === "string" ? o.text : undefined, ink: typeof o.ink === "string" ? o.ink : undefined };
  }
  return { mode: "text" };
}
