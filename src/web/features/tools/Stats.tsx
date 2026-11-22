// 單變數 / 雙變數分析（輸出對齊 TI-84 1-Var Stats、2-Var Stats、各種回歸）
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { histogramBins, oneVar, parseColumns, parseOneVarInput, regression, twoVar, type RegressionModel } from "../../../shared/stats";
import { useDevice } from "../../lib/device";
import { Button, textareaCls } from "../../components/ui";
import { Markdown } from "../../components/Markdown";
import { useUser } from "../../lib/auth";
import { readToolStorage, toolStorageKey, writeToolStorage } from "./storage";
import { LegacyToolRestore } from "./LegacyToolRestore";

const fmt = (v: number | null | undefined, d = 6) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : String(Number(v.toPrecision(d))));

function usePersisted(key: string, initial: string) {
  const owner = useUser().id, storageKey = toolStorageKey(owner, key), marker = toolStorageKey(owner, key + "-legacy-restored");
  const [value, setValue] = useState(() => readToolStorage(storageKey) ?? initial);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => { setValue(readToolStorage(storageKey) ?? initial); setStorageError(false); }, [storageKey, initial]);
  const set = (next: string) => { setValue(next); setStorageError(!writeToolStorage(storageKey, next)); };
  const legacy = readToolStorage(key);
  const restore = () => {
    if (legacy === null || !writeToolStorage(storageKey, legacy) || !writeToolStorage(marker, "1")) return false;
    setValue(legacy); setStorageError(false); return true;
  };
  return { value, set, storageError, legacyAvailable: !!legacy?.trim() && readToolStorage(marker) !== "1", restore };
}

function ResultTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-100 dark:border-slate-800">
            <td className="py-1.5 pr-3 font-mono text-slate-500">{k}</td>
            <td className="py-1.5 text-right font-mono">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- 單變數 ----------
export function OneVarStats() {
  const device = useDevice();
  const saved = usePersisted("stats1", "12 15 15 18 20 21 21 21 25 30"), raw = saved.value, setRaw = saved.set;
  const [useFreq, setUseFreq] = useState(false);
  const parsed = useMemo(() => {
    try {
      const { values, freqs, data } = parseOneVarInput(raw, useFreq);
      return { r: oneVar(values, freqs), data };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [raw, useFreq]);

  return (
    <div className={clsx("grid h-full gap-4 overflow-auto p-4", device === "desktop" && "grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-sm">
          <label className="flex min-h-11 cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={useFreq} onChange={(e) => setUseFreq(e.target.checked)} /> 含頻數（兩欄：數值 頻數）
          </label>
          <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setRaw("")}>
            清除
          </Button>
        </div>
        <textarea aria-label="單變數數據" className={textareaCls + " h-40"} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={useFreq ? "x f\n1 3\n2 5" : "以空白、逗號或換行分隔；可直接從 Excel 貼上"} />
        <LegacyToolRestore available={saved.legacyAvailable} onRestore={saved.restore} replace />
        {saved.storageError && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">此裝置無法儲存數據，請先複製目前輸入。</p>}
        {"error" in parsed ? <div role="status" className="text-sm text-red-600">{parsed.error}</div> : <BoxPlot r={parsed.r!} />}
        {"data" in parsed && parsed.data && <Histogram data={parsed.data} />}
      </div>
      {"r" in parsed && parsed.r && (
        <div>
          <ResultTable
            rows={[
              ["x̄", fmt(parsed.r.mean)],
              ["Σx", fmt(parsed.r.sum)],
              ["Σx²", fmt(parsed.r.sumSq)],
              ["Sx（樣本）", fmt(parsed.r.sx)],
              ["σx（母體）", fmt(parsed.r.sigmaX)],
              ["n", String(parsed.r.n)],
              ["minX", fmt(parsed.r.min)],
              ["Q1", fmt(parsed.r.q1)],
              ["Med", fmt(parsed.r.median)],
              ["Q3", fmt(parsed.r.q3)],
              ["maxX", fmt(parsed.r.max)],
              ["全距", fmt(parsed.r.range)],
              ["IQR", fmt(parsed.r.iqr)],
              ["眾數", parsed.r.modes.length ? parsed.r.modes.map((m) => fmt(m)).join(", ") : "無"],
              ["離群值（1.5×IQR）", parsed.r.outliers.length ? parsed.r.outliers.map((m) => fmt(m)).join(", ") : "無"],
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">四分位數採 TI-84 / Casio 計算機方法（中位數不含在上下半部）。</p>
        </div>
      )}
    </div>
  );
}

function BoxPlot({ r }: { r: ReturnType<typeof oneVar> }) {
  const lo = Math.min(r.min, r.lowerFence);
  const hi = Math.max(r.max, r.upperFence);
  const span = hi - lo || 1;
  const X = (v: number) => 10 + ((v - lo) / span) * 380;
  const whiskerLo = r.whiskerMin;
  const whiskerHi = r.whiskerMax;
  return (
    <svg viewBox="0 0 400 70" className="w-full" role="img" aria-label="箱形圖">
      <line x1={X(whiskerLo)} x2={X(r.q1)} y1={30} y2={30} stroke="currentColor" />
      <line x1={X(r.q3)} x2={X(whiskerHi)} y1={30} y2={30} stroke="currentColor" />
      <line x1={X(whiskerLo)} x2={X(whiskerLo)} y1={22} y2={38} stroke="currentColor" />
      <line x1={X(whiskerHi)} x2={X(whiskerHi)} y1={22} y2={38} stroke="currentColor" />
      <rect x={X(r.q1)} y={15} width={Math.max(1, X(r.q3) - X(r.q1))} height={30} fill="rgb(20 184 166 / .25)" stroke="#0d9488" />
      <line x1={X(r.median)} x2={X(r.median)} y1={15} y2={45} stroke="#0f766e" strokeWidth={2} />
      {r.outliers.map((o) => (
        <circle key={o} cx={X(o)} cy={30} r={3} fill="none" stroke="#dc2626" />
      ))}
      {[lo, r.q1, r.median, r.q3, hi].map((v, i) => (
        <text key={i} x={X(v)} y={62} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>
          {fmt(v, 4)}
        </text>
      ))}
    </svg>
  );
}

function Histogram({ data }: { data: number[] }) {
  const bins = histogramBins(data);
  const max = Math.max(...bins.map((b) => b.count));
  const w = 380 / bins.length;
  return (
    <svg viewBox="0 0 400 130" className="w-full" role="img" aria-label="直方圖">
      {bins.map((b, i) => (
        <g key={i}>
          <rect x={10 + i * w} y={110 - (b.count / max) * 95} width={w - 1} height={(b.count / max) * 95} fill="#14b8a6" opacity={0.7} />
          <text x={10 + i * w + w / 2} y={108 - (b.count / max) * 95} fontSize={9} textAnchor="middle" fill="currentColor">
            {b.count}
          </text>
        </g>
      ))}
      <text x={10} y={124} fontSize={9} fill="currentColor" opacity={0.6}>
        {fmt(bins[0].x0, 4)}
      </text>
      <text x={390} y={124} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>
        {fmt(bins.at(-1)!.x1, 4)}
      </text>
    </svg>
  );
}

// ---------- 雙變數 ----------
const MODELS: { value: RegressionModel; label: string }[] = [
  { value: "linear", label: "線性 y=ax+b" },
  { value: "quadratic", label: "二次" },
  { value: "cubic", label: "三次" },
  { value: "exponential", label: "指數 y=a·bˣ" },
  { value: "power", label: "乘冪 y=a·xᵇ" },
  { value: "logarithmic", label: "對數 y=a+b ln x" },
];

export function TwoVarStats({ onOpenInGeoGebra }: { onOpenInGeoGebra?: (cmds: string[]) => void }) {
  const device = useDevice();
  const saved = usePersisted("stats2", "1 2.1\n2 3.9\n3 6.2\n4 7.8\n5 10.1"), raw = saved.value, setRaw = saved.set;
  const [model, setModel] = useState<RegressionModel>("linear");
  const [predictX, setPredictX] = useState("");
  const res = useMemo(() => {
    try {
      const columns = parseColumns(raw);
      if (columns.length !== 2) return { error: "每一列需要 x 與 y 兩個數值" };
      const [xs = [], ys = []] = columns;
      if (xs.length !== ys.length) return { error: "每一列需要 x 與 y 兩個數值" };
      return { xs, ys, stats: twoVar(xs, ys), reg: regression(xs, ys, model) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [raw, model]);

  return (
    <div className={clsx("grid h-full gap-4 overflow-auto p-4", device === "desktop" && "grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
      <div className="space-y-2">
        <textarea aria-label="雙變數數據" className={textareaCls + " h-40"} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"x y（每列一組，空白/逗號/Tab 分隔）"} />
        <LegacyToolRestore available={saved.legacyAvailable} onRestore={saved.restore} replace />
        {saved.storageError && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">此裝置無法儲存數據，請先複製目前輸入。</p>}
        <div className="flex flex-wrap gap-1.5">
          {MODELS.map((m) => (
            <button key={m.value} aria-pressed={model === m.value} onClick={() => setModel(m.value)} className={clsx("min-h-11 rounded-lg px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2", model === m.value ? "bg-brand-700 text-white" : "bg-slate-100 dark:bg-slate-800")}>
              {m.label}
            </button>
          ))}
        </div>
        {"error" in res ? <div role="status" className="text-sm text-red-600">{res.error}</div> : <Scatter xs={res.xs!} ys={res.ys!} predict={res.reg!.predict} />}
      </div>
      {"reg" in res && res.reg && res.stats && (
        <div className="space-y-3">
          <div className="rounded-xl bg-brand-50 p-3 dark:bg-brand-800/20">
            <Markdown md={`$$${res.reg.latex}$$`} className="text-center" />
            <div className="text-center font-mono text-sm">
              {res.reg.r !== undefined && <>r = {fmt(res.reg.r)} · </>}r² = {fmt(res.reg.r2)}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            預測：x =
            <input aria-label="預測 x 值" className="h-11 w-24 rounded-lg border border-slate-300 px-2 font-mono focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-600 dark:bg-slate-800" value={predictX} onChange={(e) => setPredictX(e.target.value)} inputMode="decimal" />
            {predictX.trim() && (Number.isFinite(Number(predictX)) ? <span className="font-mono">→ y = {fmt(res.reg.predict(Number(predictX)))}</span> : <span role="status" className="text-rose-600">請輸入有效數值</span>)}
          </div>
          <ResultTable
            rows={[
              ["x̄", fmt(res.stats.meanX)],
              ["ȳ", fmt(res.stats.meanY)],
              ["Σx", fmt(res.stats.sumX)],
              ["Σy", fmt(res.stats.sumY)],
              ["Σx²", fmt(res.stats.sumX2)],
              ["Σy²", fmt(res.stats.sumY2)],
              ["Σxy", fmt(res.stats.sumXY)],
              ["Sx / σx", `${fmt(res.stats.sx)} / ${fmt(res.stats.sigmaX)}`],
              ["Sy / σy", `${fmt(res.stats.sy)} / ${fmt(res.stats.sigmaY)}`],
              ["n", String(res.stats.n)],
              ["r（線性相關係數）", fmt(res.stats.r)],
              ...Object.entries(res.reg.coefficients).map(([k, v]) => [k, fmt(v)] as [string, string]),
            ]}
          />
          {onOpenInGeoGebra && (
            <Button
              size="sm"
              onClick={() =>
                onOpenInGeoGebra([
                  `pts={${res.xs!.map((x, i) => `(${x},${res.ys![i]})`).join(",")}}`,
                  `f(x)=${regCommand(model)}`,
                  `ZoomIn(${Math.min(...res.xs!) - 1},${Math.min(...res.ys!) - 1},${Math.max(...res.xs!) + 1},${Math.max(...res.ys!) + 1})`,
                ])
              }
            >
              在 GeoGebra 開啟
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function regCommand(m: RegressionModel) {
  return { linear: "FitLine(pts)", quadratic: "FitPoly(pts,2)", cubic: "FitPoly(pts,3)", exponential: "FitExp(pts)", power: "FitPow(pts)", logarithmic: "FitLog(pts)" }[m];
}

function Scatter({ xs, ys, predict }: { xs: number[]; ys: number[]; predict: (x: number) => number }) {
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const pad = (x1 - x0) * 0.08 || 1;
  const curveX = Array.from({ length: 60 }, (_, i) => x0 - pad + ((x1 - x0 + 2 * pad) * i) / 59);
  const curveY = curveX.map(predict).filter(Number.isFinite);
  const yMin = Math.min(...ys, ...curveY);
  const yMax = Math.max(...ys, ...curveY);
  const X = (x: number) => 30 + ((x - (x0 - pad)) / (x1 - x0 + 2 * pad)) * 360;
  const Y = (y: number) => 180 - ((y - yMin) / (yMax - yMin || 1)) * 165;
  const path = curveX
    .map((x) => [x, predict(x)])
    .filter(([, y]) => Number.isFinite(y) && y >= yMin - (yMax - yMin) && y <= yMax + (yMax - yMin))
    .map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 400 200" className="w-full" role="img" aria-label="散布圖與回歸曲線">
      <line x1={30} x2={390} y1={180} y2={180} stroke="currentColor" opacity={0.3} />
      <line x1={30} x2={30} y1={10} y2={180} stroke="currentColor" opacity={0.3} />
      <path d={path} fill="none" stroke="#0f766e" strokeWidth={2} />
      {xs.map((x, i) => (
        <circle key={i} cx={X(x)} cy={Y(ys[i])} r={3.5} fill="#f59e0b" />
      ))}
      <text x={30} y={195} fontSize={9} fill="currentColor" opacity={0.6}>
        {fmt(x0 - pad, 3)}
      </text>
      <text x={390} y={195} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>
        {fmt(x1 + pad, 3)}
      </text>
      <text x={26} y={14} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>
        {fmt(yMax, 3)}
      </text>
    </svg>
  );
}
