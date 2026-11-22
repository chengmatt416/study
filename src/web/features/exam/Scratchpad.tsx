// 書寫板（考試演算紙）：向量筆跡（perfect-freehand 壓感）、螢光筆、一般橡皮擦、復原/重做、多頁、方格/橫線底紙。
// 偵測到 Apple Pencil 時自動開啟防誤觸（手指只捲動）。
// 兩種用法：storageKey → 演算紙，存在本機 IndexedDB；value/onChange → 手寫作答（由呼叫端存進作答）。
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { clsx } from "clsx";
import { getStroke } from "perfect-freehand";
import { ArrowArcLeft, ArrowArcRight, Eraser, GridFour, Highlighter, PenNib, Plus, Rows, Square, Trash } from "@phosphor-icons/react";
import { useWritingLock, WritingLockGlyph } from "../../components/WritingLock";
import { idb } from "../../lib/idb";
import { isPenActive } from "../../lib/inkGuard";
import { splitInk, type InkBg as Bg, type InkDoc as ScratchData, type InkPage as Page, type InkPt as Pt, type InkStroke as Stroke } from "../../../shared/ink";
import { capturePointer } from "../../lib/pointerCapture";

const W = 1000;
const A4_H = 1414;
const COMMIT_ANSWER_INK = "commit-answer-ink";

export function flushExamInk(container: HTMLElement | null) {
  container?.querySelectorAll("[data-exam-answer-ink]").forEach(pad => pad.dispatchEvent(new Event(COMMIT_ANSWER_INK)));
}

/** 最後一個使用中的書寫區（⌘Z 只作用在它） */
let activePad = "";

/** 觸控筆偵測結果全站共用：在任一書寫區用過 Apple Pencil 後，其他書寫區也預設防誤觸 */
const PEN_KEY = "ink-pen-only";
const penSeen = () => {
  try {
    return localStorage.getItem(PEN_KEY) === "1";
  } catch {
    return false;
  }
};

const PEN_COLORS = ["#111111", "#1d4ed8", "#dc2626"];
const HL_COLOR = "#fde047";
const SIZES = { pen: [3, 5, 9], highlighter: [22, 32, 46], eraser: [12, 24, 48] } as const;
const newPage = (): Page => ({ id: crypto.randomUUID(), strokes: [] });
export const emptyInk = (h = A4_H, bg: Bg = "grid"): ScratchData => ({ version: 1, bg, h, pages: [newPage()] });

/** perfect-freehand 外框 → SVG path */
function outlinePath(stroke: Stroke): string {
  const pts = getStroke(stroke.points, {
    size: stroke.size,
    thinning: stroke.kind === "pen" ? 0.6 : 0,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: stroke.points.every((p) => p[2] === 0.5),
    last: true,
  });
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d += ` Q${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`;
  }
  return d + "Z";
}

const pathCache = new WeakMap<Stroke, string>();
const pathOf = (s: Stroke) => {
  let d = pathCache.get(s);
  if (d === undefined) {
    d = outlinePath(s);
    pathCache.set(s, d);
  }
  return d;
};

const StrokeView = memo(function StrokeView({ stroke }: { stroke: Stroke }) {
  return <path d={pathOf(stroke)} fill={stroke.color} fillOpacity={stroke.kind === "highlighter" ? 0.35 : 1} style={stroke.kind === "highlighter" ? { mixBlendMode: "multiply" } : undefined} />;
});

function Background({ bg, h, uid }: { bg: Bg; h: number; uid: string }) {
  if (bg === "blank") return null;
  return (
    <>
      <defs>
        {bg === "grid" ? (
          <pattern id={`${uid}-grid`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="1" />
          </pattern>
        ) : (
          <pattern id={`${uid}-lines`} width={W} height="48" patternUnits="userSpaceOnUse">
            <path d={`M0 47.5H${W}`} stroke="#94a3b8" strokeOpacity="0.45" strokeWidth="1" />
          </pattern>
        )}
      </defs>
      <rect width={W} height={h} fill={`url(#${uid}-${bg})`} />
    </>
  );
}

interface Props {
  /** 演算紙：存在本機 IndexedDB */
  storageKey?: string;
  /** 手寫作答：受控初始值與變更回呼（停筆 0.5 秒後回呼） */
  value?: ScratchData | null;
  onChange?: (doc: ScratchData) => void;
  readOnly?: boolean;
  /** sheet：填滿容器、內部捲動；answer：嵌在題目中，高度隨頁數 */
  variant?: "sheet" | "answer";
}

export function Scratchpad({ storageKey, value, onChange, readOnly, variant = "sheet" }: Props) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<HTMLDivElement>(null);
  const embedded = variant === "answer";
  const lock = useWritingLock();
  const [data, setData] = useState<ScratchData | null>(() => (storageKey ? null : (value ?? emptyInk(500, "lines"))));
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser">("pen");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [sizeIdx, setSizeIdx] = useState<Record<"pen" | "highlighter" | "eraser", number>>({ pen: 1, highlighter: 1, eraser: 1 });
  const [penOnly, setPenOnlyState] = useState(penSeen);
  const setPenOnly = (v: boolean | ((x: boolean) => boolean)) =>
    setPenOnlyState((cur) => {
      const next = typeof v === "function" ? v(cur) : v;
      try {
        localStorage.setItem(PEN_KEY, next ? "1" : "0");
      } catch {
        /* 無痕模式 */
      }
      return next;
    });
  const [undo, setUndo] = useState<Page[][]>([]);
  const [redo, setRedo] = useState<Page[][]>([]);
  const [draft, setDraft] = useState<{ pageId: string; stroke: Stroke } | null>(null);
  const [eraser, setEraser] = useState<{ pageId: string; x: number; y: number } | null>(null);
  const erasing = useRef(false);
  const saveTimer = useRef<number>(0);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loaded = useRef<ScratchData | null>(data);
  const pending = useRef<ScratchData | null>(null);
  const flush = useCallback(
    (doc: ScratchData) => {
      pending.current = null;
      if (storageKey) void idb.set(storageKey, doc);
      onChangeRef.current?.(doc);
    },
    [storageKey],
  );

  useEffect(() => {
    if (!storageKey) return;
    let alive = true;
    idb.get<ScratchData>(storageKey).then((d) => {
      if (!alive) return;
      const doc = d?.version === 1 ? d : emptyInk();
      loaded.current = doc;
      setData(doc);
    });
    return () => {
      alive = false;
    };
  }, [storageKey]);

  // 唯讀檢視：跟著外部值更新
  useEffect(() => {
    if (!storageKey && readOnly && value) setData(value);
  }, [storageKey, readOnly, value]);

  // 自動儲存（停筆 0.5 秒）；載入當下的內容不回存
  useEffect(() => {
    if (!data || readOnly || data === loaded.current) return;
    pending.current = data;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flush(data), 500);
    return () => window.clearTimeout(saveTimer.current);
  }, [data, readOnly, flush]);
  // 卸載（切換作答方式、交卷）前把尚未存的筆跡送出
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const element = root.current;
    if (!embedded || readOnly || !element) return;
    function commitAnswer() {
      if (!pending.current) return;
      window.clearTimeout(saveTimer.current);
      flushRef.current(pending.current);
    }
    element.addEventListener(COMMIT_ANSWER_INK, commitAnswer);
    return () => element.removeEventListener(COMMIT_ANSWER_INK, commitAnswer);
  }, [embedded, readOnly]);
  useEffect(
    () => () => {
      if (pending.current) flushRef.current(pending.current);
    },
    [],
  );
  const H = data?.h ?? A4_H;

  const commit = useCallback((pages: Page[], prev: Page[]) => {
    setUndo((u) => [...u.slice(-49), prev]);
    setRedo([]);
    setData((d) => (d ? { ...d, pages } : d));
  }, []);

  const toPage = (e: { clientX: number; clientY: number }, svg: SVGSVGElement): [number, number] => {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };

  const size = SIZES[tool][sizeIdx[tool]];

  const eraseAt = (pageId: string, x: number, y: number) => {
    setData((d) => {
      if (!d) return d;
      let changed = false;
      const pages = d.pages.map((pg) => {
        if (pg.id !== pageId) return pg;
        const strokes = pg.strokes.flatMap((s) => {
          const near = s.points.some((p, i) => Math.hypot(p[0] - x, p[1] - y) <= size + s.size || (i > 0 && segDist(x, y, s.points[i - 1], p) <= size + s.size / 2));
          if (!near) return [s];
          const parts = splitInk(s.points, s.size, x, y, size);
          changed = true;
          return parts.map((points, i) => ({ ...s, id: `${s.id}.${i}`, points }));
        });
        return changed ? { ...pg, strokes } : pg;
      });
      return changed ? { ...d, pages } : d;
    });
  };

  const down = (pageId: string) => (e: RPointerEvent<SVGSVGElement>) => {
    if (readOnly || !data) return;
    activePad = uid;
    if (e.pointerType === "pen" && !penOnly) setPenOnly(true); // 偵測到觸控筆：自動防誤觸
    if ((penOnly || isPenActive()) && e.pointerType === "touch") return;
    e.preventDefault();
    capturePointer(e.currentTarget as Element, e.pointerId);
    const [x, y] = toPage(e, e.currentTarget);
    if (tool === "eraser") {
      erasing.current = true;
      setUndo((u) => [...u.slice(-49), data.pages]);
      setRedo([]);
      setEraser({ pageId, x, y });
      eraseAt(pageId, x, y);
      return;
    }
    setDraft({
      pageId,
      stroke: { id: crypto.randomUUID(), kind: tool, color: tool === "highlighter" ? HL_COLOR : color, size, points: [[+x.toFixed(1), +y.toFixed(1), e.pointerType === "pen" ? e.pressure || 0.5 : 0.5]] },
    });
  };

  const move = (pageId: string) => (e: RPointerEvent<SVGSVGElement>) => {
    if (readOnly) return;
    if (tool === "eraser") {
      if ((penOnly || isPenActive()) && e.pointerType === "touch") return;
      const [x, y] = toPage(e, e.currentTarget);
      setEraser({ pageId, x, y });
      if (erasing.current) eraseAt(pageId, x, y);
      return;
    }
    if (!draft || draft.pageId !== pageId) return;
    if ((penOnly || isPenActive()) && e.pointerType === "touch") return; // 手掌不延伸筆跡
    // 合併事件（coalesced events）讓 Apple Pencil 筆跡更平滑
    const events = (e.nativeEvent.getCoalescedEvents?.() ?? []).length ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    const pts: Pt[] = events.map((ev) => {
      const [x, y] = toPage(ev, e.currentTarget);
      return [+x.toFixed(1), +y.toFixed(1), ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5];
    });
    setDraft({ pageId, stroke: { ...draft.stroke, points: [...draft.stroke.points, ...pts] } });
  };

  const up = () => {
    if (tool === "eraser") {
      erasing.current = false;
      return;
    }
    if (!draft || !data) return;
    const stroke = draft.stroke.points.length === 1 ? { ...draft.stroke, points: [...draft.stroke.points, [draft.stroke.points[0][0] + 0.1, draft.stroke.points[0][1] + 0.1, 0.5] as Pt] } : draft.stroke;
    commit(
      data.pages.map((pg) => (pg.id === draft.pageId ? { ...pg, strokes: [...pg.strokes, stroke] } : pg)),
      data.pages,
    );
    setDraft(null);
  };

  const doUndo = () => {
    if (!data || !undo.length) return;
    setRedo((r) => [...r, data.pages]);
    setData({ ...data, pages: undo[undo.length - 1] });
    setUndo((u) => u.slice(0, -1));
  };
  const doRedo = () => {
    if (!data || !redo.length) return;
    setUndo((u) => [...u, data.pages]);
    setData({ ...data, pages: redo[redo.length - 1] });
    setRedo((r) => r.slice(0, -1));
  };

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (activePad !== uid || (e.target as HTMLElement).closest("input,textarea,[contenteditable],math-field")) return;
      const pad = root.current;
      if (!pad?.getClientRects().length || pad.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const strokeCount = useMemo(() => data?.pages.reduce((s, p) => s + p.strokes.length, 0) ?? 0, [data]);

  if (!data) return <div className="grid h-full place-items-center text-sm text-slate-500">載入中…</div>;

  return (
    <div ref={root} data-exam-answer-ink={embedded && !readOnly ? "" : undefined} className={clsx("flex flex-col", embedded ? "overflow-hidden rounded-2xl border border-slate-200 bg-ink-100/60 dark:border-white/10 dark:bg-ink-950" : "h-full bg-ink-100 dark:bg-ink-950")}>
      {!readOnly && (
        <div className="no-scrollbar flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-black/5 bg-white/95 px-2 py-1.5 backdrop-blur dark:border-white/10 dark:bg-ink-900/95">
          <TbBtn label="復原" disabled={!undo.length} onClick={doUndo}>
            <ArrowArcLeft size={18} weight="bold" />
          </TbBtn>
          <TbBtn label="重做" disabled={!redo.length} onClick={doRedo}>
            <ArrowArcRight size={18} weight="bold" />
          </TbBtn>
          <Sep />
          {(
            [
              ["pen", "筆", PenNib],
              ["highlighter", "螢光筆", Highlighter],
              ["eraser", "橡皮擦", Eraser],
            ] as const
          ).map(([t, label, Icon]) => (
            <TbBtn key={t} label={label} active={tool === t} onClick={() => setTool(t)}>
              <Icon size={20} weight={tool === t ? "fill" : "regular"} />
            </TbBtn>
          ))}
          <Sep />
          {tool === "pen" &&
            PEN_COLORS.map((c) => (
              <button key={c} aria-label={`顏色 ${c}`} onClick={() => setColor(c)} className="grid h-9 w-8 shrink-0 place-items-center">
                <span className={clsx("h-5 w-5 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-ink-900", color === c && "ring-2 ring-ink-900 dark:ring-white")} style={{ background: c }} />
              </button>
            ))}
          {SIZES[tool].map((_, i) => (
            <button key={i} aria-label={`粗細 ${i + 1}`} onClick={() => setSizeIdx((s) => ({ ...s, [tool]: i }))} className={clsx("grid h-9 w-8 shrink-0 place-items-center rounded-lg", sizeIdx[tool] === i && "bg-ink-100 dark:bg-white/10")}>
              <span className={clsx("rounded-full", tool === "eraser" ? "border border-ink-900 dark:border-white" : "bg-ink-900 dark:bg-white")} style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
          <Sep />
          <TbBtn label={`底紙：${{ grid: "方格", lines: "橫線", blank: "空白" }[data.bg]}`} onClick={() => setData({ ...data, bg: data.bg === "grid" ? "lines" : data.bg === "lines" ? "blank" : "grid" })}>
            {data.bg === "grid" ? <GridFour size={18} /> : data.bg === "lines" ? <Rows size={18} /> : <Square size={18} />}
          </TbBtn>
          <TbBtn label="只用觸控筆書寫（手指捲動）" active={penOnly} onClick={() => setPenOnly((v) => !v)}>
            <PenNib size={16} />
            <span className="text-[10px] font-semibold">only</span>
          </TbBtn>
          <span className="contents" {...lock.bind}>
            <TbBtn label={lock.label} active={lock.locked} onClick={lock.onActivate}>
              <WritingLockGlyph lock={lock} />
              <span className="text-[10px] font-semibold">書寫</span>
            </TbBtn>
          </span>
          <span className="flex-1" />
          <TbBtn
            label="新增一頁"
            onClick={() => {
              commit([...data.pages, newPage()], data.pages);
              setTimeout(() => document.getElementById(`sp-end-${uid}`)?.scrollIntoView({ behavior: "smooth" }), 50);
            }}
          >
            <Plus size={18} />
          </TbBtn>
          <TbBtn
            label="清除全部"
            disabled={!strokeCount}
            onClick={() => confirm("清除書寫板上的所有筆跡？（可用復原找回）") && commit(data.pages.map((p) => ({ ...p, strokes: [] })), data.pages)}
          >
            <Trash size={18} />
          </TbBtn>
        </div>
      )}
      <div data-ink-zone="" className={clsx(embedded ? "p-2" : "min-h-0 flex-1 overflow-auto overscroll-contain p-3")} style={{ touchAction: penOnly || readOnly ? "pan-x pan-y" : "none" }}>
        <div className={clsx("mx-auto flex flex-col", embedded ? "gap-2" : "max-w-3xl gap-3")}>
          {data.pages.map((pg, i) => (
            <div key={pg.id} className="relative overflow-hidden rounded-xl bg-white shadow-[var(--shadow-soft)]">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className={clsx("block h-auto w-full select-none", !readOnly && (tool === "eraser" ? "cursor-none" : "cursor-crosshair"))}
                data-ink={readOnly ? undefined : ""}
                style={{ touchAction: penOnly || readOnly ? "pan-x pan-y" : "none", WebkitTouchCallout: "none" }}
                onPointerDown={down(pg.id)}
                onPointerMove={move(pg.id)}
                onPointerUp={up}
                onPointerCancel={up}
                onPointerLeave={() => setEraser(null)}
              >
                <rect width={W} height={H} fill="#fff" />
                <Background bg={data.bg} h={H} uid={uid} />
                {pg.strokes.map((s) => (
                  <StrokeView key={s.id} stroke={s} />
                ))}
                {draft?.pageId === pg.id && <path d={outlinePath(draft.stroke)} fill={draft.stroke.color} fillOpacity={draft.stroke.kind === "highlighter" ? 0.35 : 1} />}
                {tool === "eraser" && eraser?.pageId === pg.id && <circle cx={eraser.x} cy={eraser.y} r={size} fill="rgb(255 255 255 / .5)" stroke="#111" strokeOpacity={0.5} strokeWidth={2} />}
              </svg>
              <div className="pointer-events-none absolute right-3 bottom-2 text-[10px] text-slate-400">
                {i + 1}/{data.pages.length}
              </div>
            </div>
          ))}
          <div id={`sp-end-${uid}`} />
        </div>
      </div>
    </div>
  );
}

function segDist(px: number, py: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function TbBtn({ children, label, onClick, active, disabled }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex h-9 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-xl px-1.5 transition-colors disabled:opacity-30",
        active ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "text-slate-600 hover:bg-ink-100 dark:text-slate-300 dark:hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

/** 是否有書寫板內容（成績頁決定是否顯示「查看書寫板」） */
export async function hasScratch(storageKey: string): Promise<boolean> {
  const d = await idb.get<ScratchData>(storageKey);
  return !!d?.pages?.some((p) => p.strokes.length);
}
