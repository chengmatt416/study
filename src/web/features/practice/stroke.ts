import { getStroke } from "perfect-freehand";

type InkPoint = [x: number, y: number, pressure: number, t?: number];

/** 每支筆可以調的手感 */
export interface StrokeTuning {
  /** 穩定程度 0..1：0＝完全照手的軌跡，1＝最平滑（線條較順但轉角較圓） */
  stabilize: number;
  /** 壓感 0..1：0＝粗細固定，0.5＝一般，1＝輕重差異最大 */
  pressure: number;
}

const DEFAULT_TUNING: StrokeTuning = { stabilize: 0.35, pressure: 0.5 };

export type InputKind = "pen" | "touch" | "mouse";

export interface RawSample {
  /** 頁面座標 */
  x: number;
  y: number;
  /** 裝置回報的筆壓（0..1；沒有筆壓的裝置通常是 0 或 0.5） */
  pressure: number;
  /** 從下筆起算的毫秒 */
  t: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One Euro 濾波器的低通部分：截止頻率越低越平滑 */
function alphaFor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / Math.max(1e-4, dtSec));
}

interface Filtered {
  x: number;
  y: number;
  p: number;
  t: number;
}

/**
 * 逐點建立筆畫。
 * - 位置：One Euro 濾波（慢慢寫時壓掉手抖，寫快時幾乎不延遲）；放開時補上真正的落點。
 * - 筆壓：真的筆壓先過曲線（輕輕寫不會細到看不見）再平滑；沒有筆壓的裝置依速度算（快細慢粗）。
 * - 點數：太近的點不留；幾乎在同一直線上、筆壓也平順的點併成一段。
 */
export class StrokeBuilder {
  private readonly kind: InputKind;
  private readonly tuning: StrokeTuning;
  /** 兩個存下來的點最少要隔多遠（頁面單位） */
  private readonly minDist: number;
  /** 併成一段的容許偏差（頁面單位） */
  private readonly lineTol: number;
  /** 每個頁面單位是幾個螢幕像素（算速度用） */
  private readonly scale: number;

  private committed: InkPoint[] = [];
  /** 最後一個存下來的點之後、還沒存的點（已濾波）：用來判斷能不能併成直線 */
  private run: Filtered[] = [];
  private tail: Filtered | null = null;
  private lastRaw: RawSample | null = null;
  private fx = 0;
  private fy = 0;
  private fp = 0.5;
  private dxHat = 0;
  private dyHat = 0;
  private started = false;
  private realPressure = false;
  private done = false;

  constructor(opts: { kind: InputKind; tuning?: Partial<StrokeTuning>; scale?: number }) {
    this.kind = opts.kind;
    this.tuning = {
      stabilize: clamp(opts.tuning?.stabilize ?? DEFAULT_TUNING.stabilize, 0, 1),
      pressure: clamp(opts.tuning?.pressure ?? DEFAULT_TUNING.pressure, 0, 1),
    };
    this.scale = Math.max(0.05, opts.scale ?? 1);
    // 約半個螢幕像素；放得很大時（放大書寫）點可以更密，但不小於儲存精度 0.1
    this.minDist = clamp(0.5 / this.scale, 0.12, 0.6);
    this.lineTol = clamp(0.22 / this.scale, 0.05, 0.25);
  }

  /** 整理筆壓：回傳 0..1，0.5＝筆的標稱粗細 */
  private shapePressure(raw: number, speedPxMs: number, dtMs: number): number {
    const sens = this.tuning.pressure;
    let target: number;
    if (this.realPressure) {
      // Apple Pencil 一般書寫的力道約 0.15–0.5：過曲線後落在 0.3–0.65，約 0.35 的力道就是標稱粗細
      const curved = Math.pow(clamp(raw, 0, 1), 0.65);
      target = 0.5 + (curved - 0.5) * (sens * 2);
    } else {
      // 沒有筆壓：寫得快就細、慢就粗（幅度一樣受壓感設定控制）
      const v = Math.min(2.2, speedPxMs);
      target = 0.5 + (0.2 - 0.19 * v) * (sens * 2);
    }
    target = clamp(target, 0.04, 1);
    if (!this.started) return target;
    // 平滑：約 28 ms 的時間常數，筆壓突然跳動不會變成一顆墨點
    const a = 1 - Math.exp(-Math.max(1, dtMs) / 28);
    return this.fp + (target - this.fp) * a;
  }

  add(sample: RawSample): void {
    if (this.done) return;
    const prev = this.lastRaw;
    if (prev && sample.x === prev.x && sample.y === prev.y && sample.pressure === prev.pressure) return;
    const dtMs = prev ? Math.max(0.5, sample.t - prev.t) : 8;
    if (this.kind === "pen" && sample.pressure > 0 && sample.pressure !== 0.5 && sample.pressure !== 1) this.realPressure = true;

    const speedPxMs = prev ? (Math.hypot(sample.x - prev.x, sample.y - prev.y) * this.scale) / dtMs : 0;

    if (!this.started) {
      this.fx = sample.x;
      this.fy = sample.y;
      this.fp = this.shapePressure(sample.pressure, 0, dtMs);
      // 沒有筆壓的裝置起筆稍細，才有下筆的感覺
      if (!this.realPressure) this.fp = Math.min(this.fp, 0.42);
      this.started = true;
    } else {
      const s = this.tuning.stabilize;
      if (s <= 0.001) {
        this.fx = sample.x;
        this.fy = sample.y;
      } else {
        const dt = dtMs / 1000;
        // 速度（螢幕像素／秒）先低通，再決定截止頻率：越快截止頻率越高，延遲越小
        const rawDx = ((sample.x - prev!.x) * this.scale) / dt;
        const rawDy = ((sample.y - prev!.y) * this.scale) / dt;
        const ad = alphaFor(1.2, dt);
        this.dxHat += (rawDx - this.dxHat) * ad;
        this.dyHat += (rawDy - this.dyHat) * ad;
        const speed = Math.hypot(this.dxHat, this.dyHat);
        const minCutoff = lerp(22, 1.1, Math.pow(s, 0.8));
        const beta = lerp(0.09, 0.006, s);
        const a = alphaFor(minCutoff + beta * speed, dt);
        this.fx += (sample.x - this.fx) * a;
        this.fy += (sample.y - this.fy) * a;
      }
      this.fp = this.shapePressure(sample.pressure, speedPxMs, dtMs);
    }
    this.lastRaw = sample;
    this.push({ x: this.fx, y: this.fy, p: this.fp, t: sample.t });
  }

  private toPoint(f: Filtered): InkPoint {
    return [round1(f.x), round1(f.y), round2(clamp(f.p, 0, 1)), Math.max(0, Math.round(f.t))];
  }

  private commit(f: Filtered): void {
    this.committed.push(this.toPoint(f));
    this.run = [];
    this.tail = null;
  }

  private push(f: Filtered): void {
    if (this.committed.length === 0) {
      this.commit(f);
      return;
    }
    const last = this.committed[this.committed.length - 1];
    const d = Math.hypot(f.x - last[0], f.y - last[1]);
    if (d < this.minDist) {
      // 還沒離開上一個點：先當尾巴（畫面看得到，位置還會跟著筆走）
      this.tail = f;
      return;
    }
    // 上一個點到這個點之間的點，如果都貼著這條直線、筆壓也是平順變化，就不用留
    const segLen = d;
    let straight = segLen <= 14;
    if (straight) {
      for (const q of this.run) {
        const u = clamp(((q.x - last[0]) * (f.x - last[0]) + (q.y - last[1]) * (f.y - last[1])) / (segLen * segLen), 0, 1);
        const px = last[0] + (f.x - last[0]) * u;
        const py = last[1] + (f.y - last[1]) * u;
        if (Math.hypot(q.x - px, q.y - py) > this.lineTol || Math.abs(q.p - lerp(last[2], f.p, u)) > 0.05) {
          straight = false;
          break;
        }
      }
    }
    if (!straight && this.run.length > 0) {
      // 轉彎了：把轉彎前的最後一個點存下來，再從那裡重新看
      const corner = this.run[this.run.length - 1];
      this.commit(corner);
      this.push(f);
      return;
    }
    this.run.push(f);
    this.tail = f;
    // 直線段也不要太長：每隔一段存一個點，粗細變化才跟得上
    if (segLen > 9) this.commit(f);
  }

  /** 目前的點列（包含還在跟著筆移動的尾巴）；畫即時筆跡用 */
  points(): InkPoint[] {
    if (!this.tail) return this.committed;
    const t = this.toPoint(this.tail);
    const last = this.committed[this.committed.length - 1];
    if (last && last[0] === t[0] && last[1] === t[1]) return this.committed;
    return [...this.committed, t];
  }

  /** 放開：把尾巴存下來，並補上筆真正離開的位置（濾波會落後一點點） */
  finish(): InkPoint[] {
    if (this.done) return this.committed;
    this.done = true;
    if (this.tail) {
      const f = this.tail;
      const last = this.committed[this.committed.length - 1];
      const pt = this.toPoint(f);
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) this.committed.push(pt);
      this.tail = null;
    }
    const raw = this.lastRaw;
    const last = this.committed[this.committed.length - 1];
    if (raw && last && Math.hypot(raw.x - last[0], raw.y - last[1]) >= 0.25) {
      // 沒有筆壓的裝置收筆稍細
      const p = this.realPressure ? this.fp : Math.min(this.fp, 0.4);
      this.committed.push([round1(raw.x), round1(raw.y), round2(clamp(p, 0, 1)), Math.max(0, Math.round(raw.t))]);
    }
    this.run = [];
    return this.committed;
  }

  get length(): number {
    return this.committed.length + (this.tail ? 1 : 0);
  }
}

/** 一次處理整串取樣（測試、回放、匯入用） */
/** 將 perfect-freehand 外框多邊形轉為平滑二次貝茲 SVG 路徑。 */
function outlineToSvgPath(pts: readonly number[][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d += ` Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`;
  }
  return d + "Z";
}

export function practiceStrokePath(points: readonly InkPoint[]): string {
  if (!points.length) return "";
  const [[x, y, pressure]] = points;
  const samples = points.length === 1 ? [points[0], [x + 0.1, y + 0.1, pressure]] : points;
  const outline = getStroke(samples.map(([px, py, p]) => [px, py, p]), {
    size: 2.8,
    thinning: 0.62,
    smoothing: 0.5,
    streamline: 0.08,
    simulatePressure: false,
    last: true,
  });
  return outlineToSvgPath(outline);
}
