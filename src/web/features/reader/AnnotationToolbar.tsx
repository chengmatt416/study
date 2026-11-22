// 仿 GoodNotes 6 的浮動標注工具列：
// [復原 重做] | 鋼筆 螢光筆 擦子 形狀 文字 便利貼 | 三個常用顏色 | 三種粗細 | 只用觸控筆
// 再點一次已選取的工具 → 開啟細部設定（完整色盤、粗細滑桿、模式）
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowArcLeft, ArrowArcRight, Eraser, Highlighter, HandPointing, NotePencil, PenNib, Square, TextAUnderline, ShareNetwork, type Icon } from "@phosphor-icons/react";
import type { TextMode, Tool, ToolSettings } from "./PdfViewer";
import { spring } from "../../components/ui";
import { useWritingLock, WritingLockGlyph } from "../../components/WritingLock";

export const PALETTE = {
  pen: ["#111111", "#1d4ed8", "#dc2626", "#047857", "#7c3aed", "#ea580c", "#0891b2", "#be185d", "#4b5563", "#a16207", "#16a34a", "#ffffff"],
  highlighter: ["#fde047", "#86efac", "#f9a8d4", "#93c5fd", "#fdba74", "#c4b5fd", "#5eead4", "#fca5a5", "#d9f99d", "#e5e7eb", "#fcd34d", "#a5f3fc"],
};

export const DEFAULT_SETTINGS: ToolSettings = {
  pen: { color: "#111111", width: 1.6 },
  highlighter: { color: "#fde047", width: 12, straight: false },
  shape: { color: "#1d4ed8" },
  text: { color: "#fde047", mode: "highlight" },
  sticky: { color: "#fde68a" },
  eraser: { size: 10, mode: "partial" },
};

const TOOLS: { id: Tool; label: string; icon: Icon; needsText?: boolean }[] = [
  { id: "none", label: "瀏覽", icon: HandPointing },
  { id: "pen", label: "鋼筆", icon: PenNib },
  { id: "highlighter", label: "螢光筆", icon: Highlighter },
  { id: "eraser", label: "擦子", icon: Eraser },
  { id: "shape", label: "框選", icon: Square },
  { id: "text", label: "文字螢光", icon: TextAUnderline, needsText: true },
  { id: "sticky", label: "便利貼", icon: NotePencil },
];

const WIDTHS: Record<"pen" | "highlighter" | "eraser", number[]> = { pen: [1, 1.6, 2.8], highlighter: [8, 12, 18], eraser: [6, 10, 22] };

interface Props {
  tool: Tool;
  setTool: (t: Tool) => void;
  settings: ToolSettings;
  setSettings: (s: ToolSettings) => void;
  hasText: boolean;
  penOnly: boolean;
  setPenOnly: (v: boolean) => void;
  share: boolean;
  setShare: (v: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showPenOnly: boolean;
  compact: boolean;
}

function colorOf(tool: Tool, s: ToolSettings): string | null {
  if (tool === "pen" || tool === "highlighter" || tool === "shape" || tool === "text" || tool === "sticky") return s[tool].color;
  return null;
}

export function AnnotationToolbar(p: Props) {
  const lock = useWritingLock();
  const [popover, setPopover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const color = colorOf(p.tool, p.settings);
  const palette = p.tool === "highlighter" || p.tool === "text" || p.tool === "sticky" ? PALETTE.highlighter : PALETTE.pen;
  // 常用三色：目前顏色 + 色盤前兩個（GoodNotes 的快速色票）
  const quick = color ? [color, ...palette.filter((c) => c !== color)].slice(0, 3) : [];
  const widthKey = p.tool === "pen" || p.tool === "highlighter" || p.tool === "eraser" ? p.tool : null;

  useEffect(() => {
    if (!popover) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setPopover(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [popover]);

  const setColor = (c: string) => {
    if (p.tool === "pen" || p.tool === "highlighter" || p.tool === "shape" || p.tool === "text" || p.tool === "sticky") p.setSettings({ ...p.settings, [p.tool]: { ...p.settings[p.tool], color: c } });
  };
  const setWidth = (w: number) => {
    if (widthKey === "eraser") p.setSettings({ ...p.settings, eraser: { ...p.settings.eraser, size: w } });
    else if (widthKey) p.setSettings({ ...p.settings, [widthKey]: { ...p.settings[widthKey], width: w } });
  };
  const currentWidth = widthKey === "eraser" ? p.settings.eraser.size : widthKey ? p.settings[widthKey].width : 0;

  return (
    <div ref={ref} className="relative">
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.96 }}
        transition={spring}
        className="no-scrollbar flex max-w-[calc(100vw-1.5rem)] items-center gap-0.5 overflow-x-auto rounded-[22px] border border-black/5 bg-white/95 p-1.5 shadow-[0_10px_40px_-10px_rgb(0_0_0/.35)] backdrop-blur-xl dark:border-white/10 dark:bg-ink-900/95"
      >
        <ToolbarButton label="復原" disabled={!p.canUndo} onClick={p.onUndo}>
          <ArrowArcLeft size={20} weight="bold" />
        </ToolbarButton>
        <ToolbarButton label="重做" disabled={!p.canRedo} onClick={p.onRedo}>
          <ArrowArcRight size={20} weight="bold" />
        </ToolbarButton>
        <Divider />
        {TOOLS.filter((t) => p.hasText || !t.needsText).map((t) => {
          const active = p.tool === t.id;
          const c = colorOf(t.id, p.settings);
          return (
            <button
              key={t.id}
              title={t.label}
              aria-label={t.label}
              aria-pressed={active}
              onClick={() => (active && t.id !== "none" ? setPopover((v) => !v) : (p.setTool(t.id), setPopover(false)))}
              className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl"
            >
              {active && <motion.span layoutId="gn-tool" className="absolute inset-0 rounded-2xl bg-ink-100 dark:bg-white/10" transition={spring} />}
              <motion.span className="relative" animate={{ y: active ? -2 : 0 }} transition={spring}>
                <t.icon size={22} weight={active ? "fill" : "regular"} className={active ? "text-ink-900 dark:text-white" : "text-slate-500 dark:text-slate-400"} />
              </motion.span>
              {c && <span className="absolute bottom-1 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full" style={{ background: c, opacity: active ? 1 : 0.55 }} />}
            </button>
          );
        })}
        {(quick.length > 0 || widthKey) && <Divider />}
        {quick.map((c) => (
          <button key={c} aria-label={`顏色 ${c}`} onClick={() => setColor(c)} className="grid h-10 w-9 shrink-0 place-items-center">
            <motion.span
              animate={{ scale: c === color ? 1 : 0.78 }}
              transition={spring}
              className={clsx("h-6 w-6 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-ink-900", c === color && "ring-2 ring-ink-900 dark:ring-white", c === "#ffffff" && "border border-black/15")}
              style={{ background: c }}
            />
          </button>
        ))}
        {widthKey &&
          WIDTHS[widthKey].map((w, i) => (
            <button key={w} aria-label={`粗細 ${i + 1}`} onClick={() => setWidth(w)} className={clsx("grid h-10 w-9 shrink-0 place-items-center rounded-xl", currentWidth === w && "bg-ink-100 dark:bg-white/10")}>
              <span className="rounded-full bg-ink-900 dark:bg-white" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        <Divider />
        {p.showPenOnly && (
          <ToolbarButton label="只用觸控筆畫（手指可捲動）" active={p.penOnly} onClick={() => p.setPenOnly(!p.penOnly)}>
            <PenNib size={18} weight="duotone" />
            <span className="ml-0.5 text-[10px] font-semibold">only</span>
          </ToolbarButton>
        )}
        <span className="contents" {...lock.bind}>
          <ToolbarButton label={lock.label} active={lock.locked} onClick={lock.onActivate}>
            <WritingLockGlyph lock={lock} size={18} idleWeight="duotone" />
            <span className="ml-0.5 text-[10px] font-semibold">書寫</span>
          </ToolbarButton>
        </span>
        <ToolbarButton label={p.share ? "新標注：分享給成員" : "新標注：僅自己可見"} active={p.share} onClick={() => p.setShare(!p.share)}>
          <ShareNetwork size={18} weight={p.share ? "fill" : "regular"} />
        </ToolbarButton>
      </motion.div>

      <AnimatePresence>
        {popover && p.tool !== "none" && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={spring}
            className={clsx(
              "absolute left-1/2 z-30 w-72 -translate-x-1/2 rounded-3xl border border-black/5 bg-white p-4 shadow-[0_20px_60px_-15px_rgb(0_0_0/.4)] dark:border-white/10 dark:bg-ink-900",
              p.compact ? "bottom-full mb-2" : "top-full mt-2",
            )}
          >
            <div className="mb-3 text-sm font-semibold">{TOOLS.find((t) => t.id === p.tool)?.label}</div>
            {color && (
              <div className="mb-4 grid grid-cols-6 gap-2">
                {palette.map((c) => (
                  <button key={c} aria-label={`顏色 ${c}`} onClick={() => setColor(c)} className={clsx("h-8 w-8 rounded-full ring-offset-2 ring-offset-white transition hover:scale-110 dark:ring-offset-ink-900", c === color && "ring-2 ring-ink-900 dark:ring-white", c === "#ffffff" && "border border-black/15")} style={{ background: c }} />
                ))}
              </div>
            )}
            {widthKey && (
              <label className="mb-3 block text-xs text-slate-500">
                {widthKey === "eraser" ? "擦子大小" : "粗細"}
                <input type="range" min={widthKey === "pen" ? 0.6 : widthKey === "eraser" ? 4 : 4} max={widthKey === "pen" ? 5 : widthKey === "eraser" ? 40 : 28} step={0.2} value={currentWidth} onChange={(e) => setWidth(Number(e.target.value))} className="mt-1 w-full accent-ink-900 dark:accent-white" />
              </label>
            )}
            {p.tool === "highlighter" && (
              <label className="flex items-center justify-between text-sm">
                畫直線
                <Switch on={p.settings.highlighter.straight} onChange={(v) => p.setSettings({ ...p.settings, highlighter: { ...p.settings.highlighter, straight: v } })} />
              </label>
            )}
            {p.tool === "text" && (
              <div className="grid grid-cols-3 gap-1 rounded-2xl bg-ink-100 p-1 dark:bg-white/5">
                {(
                  [
                    ["highlight", "螢光"],
                    ["underline", "底線"],
                    ["strike", "刪除線"],
                  ] as [TextMode, string][]
                ).map(([m, l]) => (
                  <button key={m} onClick={() => p.setSettings({ ...p.settings, text: { ...p.settings.text, mode: m } })} className={clsx("rounded-xl py-1.5 text-xs font-medium", p.settings.text.mode === m ? "bg-white shadow-sm dark:bg-white/15" : "text-slate-500")}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {p.tool === "eraser" && (
              <>
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-2xl bg-ink-100 p-1 dark:bg-white/5">
                  {(
                    [
                      ["partial", "一般橡皮擦"],
                      ["stroke", "整筆擦除"],
                    ] as const
                  ).map(([m, l]) => (
                    <button key={m} onClick={() => p.setSettings({ ...p.settings, eraser: { ...p.settings.eraser, mode: m } })} className={clsx("rounded-xl py-1.5 text-xs font-medium", (p.settings.eraser.mode ?? "partial") === m ? "bg-white shadow-sm dark:bg-white/15" : "text-slate-500")}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">{(p.settings.eraser.mode ?? "partial") === "partial" ? "像真的橡皮擦一樣，只擦掉經過的部分。" : "碰到的筆跡會整筆刪除。"}只會擦除你自己的標注。</p>
              </>
            )}
            {p.tool === "text" && <p className="mt-2 text-xs text-slate-500">選取文字後放開即套用。</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolbarButton({ children, label, onClick, disabled, active }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={spring}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx("flex h-10 min-w-10 shrink-0 items-center justify-center rounded-2xl px-2 text-slate-600 transition-colors disabled:opacity-30 dark:text-slate-300", active ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "hover:bg-ink-100 dark:hover:bg-white/10")}
    >
      {children}
    </motion.button>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={clsx("relative h-7 w-12 rounded-full transition-colors", on ? "bg-ink-900 dark:bg-white" : "bg-slate-300 dark:bg-white/20")}>
      <motion.span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow dark:bg-ink-900" animate={{ left: on ? 24 : 4 }} transition={spring} />
    </button>
  );
}
