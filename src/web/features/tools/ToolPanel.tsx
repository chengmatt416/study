// 數學工具面板：在工具頁、閱讀器、作答頁共用。造訪過的工具保持掛載（GeoGebra 重新載入很慢）。
import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { Calculator, ChartBar, ChartLine, ChartScatter, Compass, Cube, DotsSixVertical, MathOperations, X, type Icon as PhIcon } from "@phosphor-icons/react";
import { spring } from "../../components/ui";
import { clsx } from "clsx";
import { GeoGebra, type GgbApi } from "./GeoGebra";
import { Qalculate } from "./Qalculate";
import { OneVarStats, TwoVarStats } from "./Stats";
import { capturePointer } from "../../lib/pointerCapture";

export type ToolId = "graphing" | "scientific" | "qalc" | "stats1" | "stats2" | "classic" | "3d";

export const TOOLS: { id: ToolId; label: string; short: string; icon: PhIcon }[] = [
  { id: "graphing", label: "圖形計算機", short: "圖形", icon: ChartLine },
  { id: "scientific", label: "科學計算機", short: "科學", icon: Calculator },
  { id: "qalc", label: "進階計算機", short: "進階", icon: MathOperations },
  { id: "stats1", label: "單變數分析", short: "單變數", icon: ChartBar },
  { id: "stats2", label: "雙變數分析", short: "雙變數", icon: ChartScatter },
  { id: "classic", label: "GeoGebra Classic", short: "Classic", icon: Compass },
  { id: "3d", label: "3D 繪圖", short: "3D", icon: Cube },
];

export function ToolPanel({ initial = "graphing", allowed, compactTabs, onToolChange }: { initial?: ToolId; allowed?: ToolId[]; compactTabs?: boolean; onToolChange?: (t: ToolId) => void }) {
  const list = allowed ? TOOLS.filter((t) => allowed.includes(t.id)) : TOOLS;
  const [tool, setTool] = useState<ToolId>(list.some((t) => t.id === initial) ? initial : list[0]?.id ?? "graphing");
  const [mounted, setMounted] = useState<Set<ToolId>>(() => new Set([tool]));
  const graphApi = useRef<GgbApi | null>(null);
  const pendingCmds = useRef<string[]>([]);
  const panelId = useId();
  const allowedKey = list.map((item) => item.id).join("|");
  useEffect(() => {
    const next = allowedKey.split("|").includes(initial) ? initial : allowedKey.split("|")[0] as ToolId;
    if (next) { setTool(next); setMounted((previous) => new Set(previous).add(next)); }
  }, [initial, allowedKey]);
  useEffect(() => { document.getElementById(`${panelId}-tab-${tool}`)?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [tool, panelId]);

  const select = (t: ToolId) => {
    setTool(t);
    setMounted((m) => new Set(m).add(t));
    onToolChange?.(t);
  };

  const openInGeoGebra = (cmds: string[]) => {
    select("graphing");
    if (graphApi.current) cmds.forEach((c) => graphApi.current!.evalCommand(c));
    else pendingCmds.current = cmds;
  };

  if (!list.length) return <div className="p-6 text-sm text-slate-500">此試卷不允許使用計算機。</div>;

  return (
    <div className="flex h-full flex-col bg-white dark:bg-ink-900">
      <div role="tablist" aria-label="數學工具" className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200/80 px-2 py-2 dark:border-white/10">
        {list.map((t, index) => (
          <button key={t.id} id={`${panelId}-tab-${t.id}`} role="tab" aria-selected={tool === t.id} aria-controls={`${panelId}-panel-${t.id}`} tabIndex={tool === t.id ? 0 : -1} onClick={() => select(t.id)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % list.length : event.key === "ArrowLeft" ? (index + list.length - 1) % list.length : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); select(list[next].id);
            document.getElementById(`${panelId}-tab-${list[next].id}`)?.focus();
          }} className={clsx("relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", tool === t.id ? "text-on-accent" : "text-slate-600 hover:bg-slate-900/5 dark:text-slate-300")}>
            {tool === t.id && <motion.span layoutId={`tool-tab-${panelId}`} className="absolute inset-0 rounded-xl bg-aurora shadow-[var(--shadow-glow)]" transition={spring} />}
            <t.icon size={16} weight={tool === t.id ? "fill" : "duotone"} className="relative" />
            <span className="relative">{compactTabs ? t.short : t.label}</span>
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {[...mounted].map((t) => (
          <div key={t} id={`${panelId}-panel-${t}`} role="tabpanel" aria-labelledby={`${panelId}-tab-${t}`} hidden={t !== tool} inert={t !== tool} className="absolute inset-0">
            {t === "graphing" && (
              <GeoGebra
                app="graphing"
                persistKey="ggb-graphing"
                onReady={(api) => {
                  graphApi.current = api;
                  pendingCmds.current.forEach((c) => api.evalCommand(c));
                  pendingCmds.current = [];
                }}
              />
            )}
            {t === "scientific" && <GeoGebra app="scientific" />}
            {t === "classic" && <GeoGebra app="classic" persistKey="ggb-classic" />}
            {t === "3d" && <GeoGebra app="3d" persistKey="ggb-3d" />}
            {t === "qalc" && <Qalculate />}
            {t === "stats1" && <OneVarStats />}
            {t === "stats2" && <TwoVarStats onOpenInGeoGebra={list.some((x) => x.id === "graphing") ? openInGeoGebra : undefined} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 可拖曳的浮動視窗（電腦版閱讀/作答時使用） */
export function FloatingWindow({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [pos, setPos] = useState(() => ({ x: Math.max(16, window.innerWidth - 560), y: 80 }));
  const [size, setSize] = useState({ w: 520, h: 600 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={spring} className="hairline fixed z-40 flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-20px_rgb(15_23_42/.45)] dark:bg-ink-900" style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}>
      <div
        className="flex cursor-move items-center gap-2 border-b border-slate-200/80 bg-slate-50 px-3 py-2 text-sm font-medium select-none dark:border-white/10 dark:bg-white/5"
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          capturePointer(e.target as Element, e.pointerId);
        }}
        onPointerMove={(e) => drag.current && setPos({ x: Math.max(0, e.clientX - drag.current.dx), y: Math.max(0, e.clientY - drag.current.dy) })}
        onPointerUp={() => (drag.current = null)}
      >
        <DotsSixVertical size={16} className="text-slate-400" />
        <span className="flex-1">{title}</span>
        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-900/10 dark:hover:bg-white/10" aria-label="關閉">
          <X size={16} weight="bold" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <div
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize"
        onPointerDown={(e) => {
          const start = { x: e.clientX, y: e.clientY, ...size };
          const move = (ev: PointerEvent) => setSize({ w: Math.max(320, start.w + ev.clientX - start.x), h: Math.max(320, start.h + ev.clientY - start.y) });
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
    </motion.div>
  );
}
