import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, ArrowCounterClockwise, ArrowLeft, BookmarkSimple, BookOpenText, Calculator, File, Files, ListBullets, MagnifyingGlass, MagnifyingGlassMinus, MagnifyingGlassPlus, PencilSimpleLine, X } from "@phosphor-icons/react";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import type { Book } from "../lib/types";
import { BottomPanel, Button, ErrorBox, IconButton, Loading, Sheet, Spinner, spring } from "../components/ui";
import { openPdf, loadOutline, type OutlineItem, type PDFDocumentProxy } from "../features/reader/pdf";
import { PdfViewer, selectionToRects, type Annotation, type Tool, type ToolSettings, type ViewerHandle } from "../features/reader/PdfViewer";
import { AnnotationToolbar, DEFAULT_SETTINGS } from "../features/reader/AnnotationToolbar";
import { MAX_ZOOM, MIN_ZOOM } from "../features/reader/usePinchZoom";
import { useWritingMode } from "../lib/inkGuard";
import { FloatingWindow, ToolPanel } from "../features/tools/ToolPanel";
import { useAnnotations } from "../features/reader/useAnnotations";
import { clampReadingPage, initialReadingPage } from "../features/reader/reading-page";
import { useReadingProgress } from "../features/reader/useReadingProgress";
import type { ReadingProgressServer } from "../features/reader/reading-progress";
import { resolveReaderSyncStatus } from "../features/reader/sync-status";
import { readPdfPageText } from "../features/reader/text-content";

type HistoryOp = { kind: "create" | "delete"; ann: Annotation } | { kind: "replace"; removed: Annotation[]; added: Annotation[] };
type NewAnnotation = Omit<Annotation, "id" | "mine" | "visibility">;

function loadSettings(): ToolSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("annot-settings") ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function Reader() {
  const { id } = useParams();
  const user = useUser();
  return id ? <BookReader key={`${user.id}:${id}`} source={{ kind: "book", id }} /> : <ErrorBox error="找不到這本書" />;
}

/**
 * A PDF that is not a library book (a chapter's uploaded material). It reads, searches, outlines and zooms like a book.
 * Reading progress, annotations and bookmarks are stored per book, so they stay off for these files.
 */
export function PdfFileReader(file: { storageKey: string; fileUrl: string; title: string; backTo: string; backLabel: string }) {
  const user = useUser();
  return <BookReader key={`${user.id}:${file.storageKey}`} source={{ kind: "file", ...file }} />;
}

type ReaderSource = { kind: "book"; id: string } | ({ kind: "file" } & Parameters<typeof PdfFileReader>[0]);

function BookReader({ source }: { source: ReaderSource }) {
  const [params] = useSearchParams();
  const user = useUser();
  const persistent = source.kind === "book";
  // Identifies this file for per-tab state (rotation); a book uses its id, a chapter file its own key.
  const id = source.kind === "book" ? source.id : source.storageKey;
  const fileUrl = source.kind === "book" ? `/api/books/${source.id}/file` : source.fileUrl;
  const device = useDevice();
  const viewer = useRef<ViewerHandle>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pdfAttempt, setPdfAttempt] = useState(0);
  // 槽位尺寸：取第 2 頁（避開大小常與內頁不同的封面）
  const [slot, setSlot] = useState({ w: 595, h: 842 });
  const [page, setPage] = useState(1);
  const [pageRestored, setPageRestored] = useState(false);
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [spread, setSpread] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [tool, setToolState] = useState<Tool>("none");
  const [settings, setSettingsState] = useState<ToolSettings>(loadSettings);
  const [penOnly, setPenOnly] = useState(() => {
    try {
      const v = localStorage.getItem("ink-pen-only");
      return v === null ? device === "tablet" : v === "1";
    } catch {
      return device === "tablet";
    }
  });
  useEffect(() => {
    const on = () => setPenOnly(true); // 第一次偵測到觸控筆
    window.addEventListener("ink-pen-seen", on);
    return () => window.removeEventListener("ink-pen-seen", on);
  }, []);
  const [shareNew, setShareNew] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [writingMode] = useWritingMode(); // 書寫模式下手指點不到頁面，工具列保持顯示
  const [panel, setPanel] = useState<null | "outline" | "bookmarks" | "search">(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [note, setNote] = useState<Annotation | null>(null);
  const [newNote, setNewNote] = useState<NewAnnotation | null>(null);
  const [noteText, setNoteText] = useState("");
  const annotationSync = useAnnotations(user.id, persistent ? id : "");
  const { annotations, change: changeAnnotations } = annotationSync;
  const [undoStack, setUndo] = useState<HistoryOp[]>([]);
  // 暫時旋轉：只存在這個分頁的 sessionStorage（關閉分頁即恢復），不修改 PDF
  const rotKey = `rot:${id}`;
  const [rot, setRot] = useState<{ all: number; pages: Record<number, number> }>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(rotKey) ?? "") ?? { all: 0, pages: {} };
    } catch {
      return { all: 0, pages: {} };
    }
  });
  const [rotMenu, setRotMenu] = useState(false);
  const rotationAnchor = useRef<number | null>(null);
  const rotMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rotMenu) return;
    const close = (e: PointerEvent) => !rotMenuRef.current?.contains(e.target as Node) && setRotMenu(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setRotMenu(false); rotMenuRef.current?.querySelector("button")?.focus(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey, true); };
  }, [rotMenu]);
  const [syncMenu, setSyncMenu] = useState(false);
  const syncMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!syncMenu) return;
    const close = (e: PointerEvent) => !syncMenuRef.current?.contains(e.target as Node) && setSyncMenu(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSyncMenu(false); syncMenuRef.current?.querySelector("button")?.focus(); } };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", onKey, true); };
  }, [syncMenu]);
  const updateRot = useCallback(
    (next: { all: number; pages: Record<number, number> }) => {
      rotationAnchor.current = page;
      setRot(next);
      try {
        sessionStorage.setItem(rotKey, JSON.stringify(next));
      } catch {
        /* 無痕模式等 */
      }
    },
    [rotKey, page],
  );
  const [redoStack, setRedo] = useState<HistoryOp[]>([]);
  const viewport = useRef<HTMLDivElement>(null);

  const setTool = (t: Tool) => setToolState(t);
  const setSettings = (s: ToolSettings) => {
    setSettingsState(s);
    try { localStorage.setItem("annot-settings", JSON.stringify(s)); } catch { /* tool settings remain usable in this page */ }
  };

  const meta = useQuery({ queryKey: ["book", id], queryFn: () => api.get<ReadingProgressServer & { book: Book & { page_offset: number; chapter?: { id: string; title: string } | null } }>(`/api/books/${id}`), enabled: persistent, staleTime: 0, refetchOnMount: "always" });
  // A chapter file has no book record; the reader only needs its title and a page offset of zero.
  const fileBook = useMemo(
    () => (source.kind === "file" ? ({ id: "", title: source.title, kind: "file", page_offset: 0, has_text_layer: 1 } as unknown as Book & { page_offset: number; chapter?: { id: string; title: string } | null }) : undefined),
    [source],
  );
  const book = source.kind === "book" ? (meta.isFetchedAfterMount ? meta.data?.book : undefined) : fileBook;
  const readingProgress = useReadingProgress(user.id, persistent ? id : "", persistent && meta.isFetchedAfterMount ? meta.data : undefined);
  const progressReady = persistent ? readingProgress.ready : true;
  const bookId = persistent ? book?.id : fileUrl;

  // 載入 PDF
  // The PDF starts loading at once, alongside the saved reading position; it is shown when both are there,
  // so the reader opens on the saved page without first showing page 1.
  const [loadedDoc, setLoadedDoc] = useState<{ doc: PDFDocumentProxy; slot: { w: number; h: number } } | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    setLoadErr(null);
    setDoc(null);
    setLoadedDoc(null);
    setPageRestored(false);
    const task = openPdf(fileUrl);
    task.promise
      .then(async (d) => {
        const ref = await d.getPage(Math.min(2, d.numPages));
        if (!alive) return;
        const vp = ref.getViewport({ scale: 1 });
        setLoadedDoc({ doc: d, slot: { w: vp.width, h: vp.height } });
      })
      .catch((e) => { if (alive) setLoadErr(String(e?.message ?? e)); });
    return () => { alive = false; void task.destroy(); };
  }, [bookId, fileUrl, pdfAttempt]);
  useEffect(() => {
    if (!loadedDoc || !progressReady) return;
    setSlot(loadedDoc.slot);
    setDoc(loadedDoc.doc);
  }, [loadedDoc, progressReady]);

  // 全部頁面旋轉 90/270 度時，槽位改為橫向
  const viewSlot = useMemo(() => (rot.all % 180 ? { w: slot.h, h: slot.w } : slot), [rot.all, slot]);
  const rotations = useMemo(() => {
    if (!doc || (!rot.all && !Object.keys(rot.pages).length)) return undefined;
    const map: Record<number, number> = {};
    for (let p = 1; p <= doc.numPages; p++) {
      const r = (rot.all + (rot.pages[p] ?? 0)) % 360;
      if (r) map[p] = r;
    }
    return map;
  }, [doc, rot]);
  const rotatePage = useCallback((p: number) => updateRot({ ...rot, pages: { ...rot.pages, [p]: ((rot.pages[p] ?? 0) + 90) % 360 } }), [rot, updateRot]);
  const rotateAll = useCallback(() => updateRot({ all: (rot.all + 90) % 360, pages: rot.pages }), [rot, updateRot]);
  const isRotated = rot.all !== 0 || Object.values(rot.pages).some(Boolean);

  // 縮放：單頁＝適寬；雙頁＝整個跨頁放進畫面。zoom 為使用者額外倍率
  const fittedScale = useCallback(() => {
    const el = viewport.current;
    if (!el) return null;
    const w = el.clientWidth - (device === "phone" ? 16 : 48);
    const h = el.clientHeight - (spread ? 32 : 0);
    const base = spread ? Math.min(h / viewSlot.h, (w - 4) / (viewSlot.w * 2)) : Math.min(w / viewSlot.w, device === "phone" ? Infinity : (w * 0.9) / viewSlot.w);
    return Math.max(0.25, base);
  }, [viewSlot, device, spread]);
  useLayoutEffect(() => {
    const fit = () => { const next = fittedScale(); if (next !== null) setScale(next); };
    fit();
    const ro = new ResizeObserver(fit);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [fittedScale, bookId]);
  const effScale = scale * zoom;
  useEffect(() => {
    const anchor = rotationAnchor.current;
    const fitted = fittedScale();
    if (!doc || anchor === null || fitted === null || Math.abs(scale - fitted) > 0.0001) return;
    viewer.current?.scrollToPage(anchor);
    setPage(anchor);
    rotationAnchor.current = null;
  }, [doc, rot, scale, fittedScale]);

  // 初始頁：?page= 或 ?printed=（套用頁碼偏移）或上次進度
  useEffect(() => {
    if (!doc || !book) return;
    const p = initialReadingPage(params, readingProgress.initialPage, book.page_offset ?? 0, doc.numPages);
    setPage(p);
    setPageRestored(true);
    const timer = setTimeout(() => viewer.current?.scrollToPage(p), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, params, readingProgress.initialPage]);

  // Device persistence is immediate; remote writes are debounced and serialized by the progress outbox.
  useEffect(() => {
    if (doc && pageRestored && persistent && readingProgress.ready) readingProgress.save(page);
  }, [page, doc, pageRestored, persistent, readingProgress.ready, readingProgress.save]);

  const persistCreate = useCallback(
    (a: Annotation) => changeAnnotations([], [a]),
    [changeAnnotations],
  );
  const persistDelete = useCallback(
    (annId: string) => changeAnnotations(annotations.filter(annotation => annotation.id === annId), []),
    [annotations, changeAnnotations],
  );

  /** 批次：刪除 removed、建立 added（一般橡皮擦與其復原/重做） */
  const persistSwap = useCallback(
    (removed: Annotation[], added: Annotation[]) => changeAnnotations(removed, added),
    [changeAnnotations],
  );

  const replace = useCallback(
    (removed: Annotation[], added: Annotation[]) => {
      if (!removed.length) return;
      void persistSwap(removed, added);
      setUndo((s) => [...s.slice(-99), { kind: "replace", removed, added }]);
      setRedo([]);
    },
    [persistSwap],
  );

  const create = useCallback(
    (a: NewAnnotation) => {
      if (a.type === "note" && !a.data.text) { setNewNote(a); setNoteText(""); return; }
      const ann: Annotation = { ...a, id: crypto.randomUUID(), mine: true, visibility: shareNew ? "shared" : "private", author: user.name };
      void persistCreate(ann);
      setUndo((s) => [...s.slice(-99), { kind: "create", ann }]);
      setRedo([]);
    },
    [persistCreate, shareNew, user.name],
  );
  const remove = useCallback(
    (annId: string) => {
      const ann = annotations.find((a) => a.id === annId);
      if (!ann) return;
      void persistDelete(annId);
      setUndo((s) => [...s.slice(-99), { kind: "delete", ann }]);
      setRedo([]);
    },
    [annotations, persistDelete],
  );
  const undo = useCallback(() => {
    const op = undoStack.at(-1);
    if (!op) return;
    setUndo((s) => s.slice(0, -1));
    setRedo((s) => [...s, op]);
    if (op.kind === "replace") void persistSwap(op.added, op.removed);
    else if (op.kind === "create") void persistDelete(op.ann.id);
    else void persistCreate(op.ann);
  }, [undoStack, persistCreate, persistDelete, persistSwap]);
  const redo = useCallback(() => {
    const op = redoStack.at(-1);
    if (!op) return;
    setRedo((s) => s.slice(0, -1));
    setUndo((s) => [...s, op]);
    if (op.kind === "replace") void persistSwap(op.removed, op.added);
    else if (op.kind === "create") void persistCreate(op.ann);
    else void persistDelete(op.ann.id);
  }, [redoStack, persistCreate, persistDelete, persistSwap]);

  // 文字工具：選取文字放開 → 螢光/底線/刪除線
  useEffect(() => {
    if (tool !== "text") return;
    const onUp = () =>
      setTimeout(() => {
        const sel = selectionToRects();
        if (sel) {
          create({ page: sel.page, type: settings.text.mode, data: { rects: sel.rects }, color: settings.text.mode === "highlight" ? settings.text.color : "#dc2626" });
          window.getSelection()?.removeAllRanges();
        }
      }, 10);
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, [tool, settings.text, create]);

  // 鍵盤（電腦）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input,textarea,select,button,a,[contenteditable],[role=dialog]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (spread && (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ")) (e.preventDefault(), viewer.current?.turn(1));
      else if (spread && (e.key === "ArrowLeft" || e.key === "PageUp")) (e.preventDefault(), viewer.current?.turn(-1));
      else if (!spread && (e.key === "ArrowRight" || e.key === "PageDown")) viewer.current?.scrollToPage(Math.min(page + 1, doc?.numPages ?? 1), true);
      else if (!spread && (e.key === "ArrowLeft" || e.key === "PageUp")) viewer.current?.scrollToPage(Math.max(page - 1, 1), true);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(MAX_ZOOM, z * 1.2));
      else if (e.key === "-") setZoom((z) => Math.max(MIN_ZOOM, z / 1.2));
      else if (e.key === "0") setZoom(1);
      else if (e.key === "Escape") setToolState("none");
      else if (!mod && (e.key === "r" || e.key === "R") && !annotating) (e.shiftKey ? rotateAll() : rotatePage(page));
      else if (!mod && annotating) {
        const map: Record<string, Tool> = { p: "pen", h: "highlighter", e: "eraser", r: "shape", t: "text", n: "sticky", v: "none" };
        if (map[e.key]) setToolState(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, doc, spread, undo, redo, annotating, rotateAll, rotatePage]);

  const hasText = book?.has_text_layer !== 0;
  const isMath = useMemo(() => book?.subject_id === "sub-math", [book]);
  const printedPage = book ? page - (book.page_offset ?? 0) : page;

  if (meta.error) return <div className="space-y-3 p-4"><ErrorBox error={meta.error} /><Button onClick={() => void meta.refetch()}>重新讀取書籍</Button></div>;
  if (!book) return <Loading />;

  const goto = (p: number) => {
    viewer.current?.scrollToPage(clampReadingPage(p, doc?.numPages ?? 1));
    if (device === "phone") setPanel(null);
  };
  // A chapter's PDF goes back to its chapter.
  const backTo = source.kind === "file" ? source.backTo : book.chapter ? `/chapters/${encodeURIComponent(book.chapter.id)}` : book.ib_document_type ? (user.role === "admin" ? "/admin/ib-resources" : "/") : book.kind === "syllabus" ? "/syllabus" : "/books";
  const backLabel = source.kind === "file" ? source.backLabel : book.chapter ? "回到章節" : book.ib_document_type ? (user.role === "admin" ? "返回 IB 參考資料" : "返回首頁") : book.kind === "syllabus" ? "返回學期課綱" : "返回書架";
  const toggleAnnotate = () => {
    setAnnotating((v) => {
      setToolState(v ? "none" : tool === "none" ? "pen" : tool);
      return !v;
    });
  };

  const syncStatus = resolveReaderSyncStatus(annotationSync, readingProgress);

  const toolbar = (
    <div className={clsx("glass relative z-20 flex shrink-0 items-center border-x-0 border-t-0 px-2 py-1.5", device !== "desktop" && "safe-top", device === "phone" ? "flex-wrap justify-between gap-0.5 [&_button]:min-h-11 [&_button]:min-w-11" : "gap-1")}>
      <div className={clsx("flex min-w-0 flex-1 items-center gap-1", device === "phone" && "basis-full")}>
      <Link to={backTo} aria-label={backLabel}>
        <IconButton label={backLabel}>
          <ArrowLeft size={20} />
        </IconButton>
      </Link>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold">{book.title}</div>
      <button
        className="shrink-0 rounded-xl bg-ink-100 px-2.5 py-1 font-mono text-xs hover:bg-ink-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:bg-white/10 dark:focus-visible:ring-white"
        aria-label="跳至頁碼"
        disabled={!doc}
        onClick={() => {
          setJumpValue(String(page)); setJumpError(null); setJumpOpen(true);
        }}
      >
        {page}
        {spread && page > 1 && doc && page + 1 <= doc.numPages ? `–${page + 1}` : ""}/{doc?.numPages ?? "…"}
        {book.page_offset ? <span className="ml-1 text-slate-400">(P{printedPage})</span> : null}
      </button>
      </div>
      {device !== "phone" && (
        <>
          <IconButton label="縮小（-）" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))}>
            <MagnifyingGlassMinus size={18} />
          </IconButton>
          <button className="w-11 rounded-lg py-1 text-xs font-medium text-slate-600 hover:bg-ink-100 dark:text-slate-300 dark:hover:bg-white/10" onClick={() => setZoom(1)} title="重設縮放（0）">
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="放大（+）" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}>
            <MagnifyingGlassPlus size={18} />
          </IconButton>
          <IconButton label={spread ? "單頁捲動" : "雙頁"} active={spread} onClick={() => (setSpread((s) => !s), setZoom(1))}>
            {spread ? <BookOpenText size={18} weight="fill" /> : <File size={18} />}
          </IconButton>
        </>
      )}
      <IconButton label="目錄" active={panel === "outline"} onClick={() => setPanel(panel === "outline" ? null : "outline")}>
        <ListBullets size={18} />
      </IconButton>
      {hasText && (
        <IconButton label="全文搜尋" active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
          <MagnifyingGlass size={18} />
        </IconButton>
      )}
      {persistent && <IconButton label="書籤" active={panel === "bookmarks"} onClick={() => setPanel(panel === "bookmarks" ? null : "bookmarks")}>
        <BookmarkSimple size={18} />
      </IconButton>}
      <div className="relative" ref={rotMenuRef}>
        <IconButton label="旋轉頁面（R）" active={rotMenu || isRotated} aria-expanded={rotMenu} aria-controls="reader-rotation-menu" onClick={() => (setSyncMenu(false), setRotMenu((v) => !v))}>
          <ArrowClockwise size={18} />
        </IconButton>
        <AnimatePresence>
          {rotMenu && (
            <>
              <motion.div
                id="reader-rotation-menu"
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={spring}
                className="absolute top-full right-0 z-40 mt-2 w-56 rounded-2xl border border-black/5 bg-white p-1.5 text-sm shadow-[0_20px_50px_-15px_rgb(0_0_0/.4)] dark:border-white/10 dark:bg-ink-900"
              >
                <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/10" onClick={() => rotatePage(page)}>
                  <ArrowClockwise size={18} /> 旋轉此頁 90°<kbd className="ml-auto text-[10px] text-slate-400">R</kbd>
                </button>
                <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-ink-100 dark:hover:bg-white/10" onClick={rotateAll}>
                  <Files size={18} /> 旋轉全部頁面 90°<kbd className="ml-auto text-[10px] text-slate-400">⇧R</kbd>
                </button>
                <button
                  disabled={!isRotated}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-ink-100 disabled:opacity-40 dark:hover:bg-white/10"
                  onClick={() => (updateRot({ all: 0, pages: {} }), setRotMenu(false))}
                >
                  <ArrowCounterClockwise size={18} /> 恢復原方向
                </button>
                <p className="px-3 pt-1 pb-1.5 text-[11px] leading-4 text-slate-500">暫時旋轉只影響這次閱讀，關閉分頁後恢復；標注不受影響。</p>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
      <IconButton label="數學工具" active={toolsOpen} onClick={() => setToolsOpen((v) => !v)}>
        <Calculator size={18} />
      </IconButton>
      {persistent && <>
        <span className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/10" />
        <IconButton label={annotating ? "結束標注" : "標注"} active={annotating} onClick={toggleAnnotate} disabled={!annotationSync.ready}>
          <PencilSimpleLine size={18} weight={annotating ? "fill" : "regular"} />
        </IconButton>
        <div className="relative" ref={syncMenuRef}>
          <IconButton
            label={`同步狀態：${syncStatus.label}`}
            aria-expanded={syncMenu}
            aria-controls="reader-sync-menu"
            data-sync-tone={syncStatus.tone}
            className={syncMenu ? "bg-ink-100 dark:bg-white/10" : undefined}
            onClick={() => (setRotMenu(false), setSyncMenu((v) => !v))}
          >
            <span
              aria-hidden="true"
              className={clsx(
                "h-2.5 w-2.5 rounded-full ring-4 transition-colors",
                syncStatus.tone === "green" && "bg-emerald-500 ring-emerald-500/20",
                syncStatus.tone === "orange" && "bg-orange-500 ring-orange-500/20",
                syncStatus.tone === "red" && "bg-red-500 ring-red-500/20",
                syncStatus.pulse && "animate-pulse",
              )}
            />
          </IconButton>
          <AnimatePresence>
            {syncMenu && (
              <motion.div
                id="reader-sync-menu"
                role={syncStatus.tone === "red" ? "alert" : "status"}
                initial={{ opacity: 0, y: -6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={spring}
                className="absolute top-full right-0 z-40 mt-2 w-72 rounded-2xl border border-black/5 bg-white p-3 text-xs text-slate-600 shadow-[0_20px_50px_-15px_rgb(0_0_0/.4)] dark:border-white/10 dark:bg-ink-900 dark:text-slate-300"
              >
                <div className="mb-2 flex items-center gap-2 font-medium text-ink-900 dark:text-white">
                  <span
                    aria-hidden="true"
                    className={clsx(
                      "h-2 w-2 shrink-0 rounded-full",
                      syncStatus.tone === "green" && "bg-emerald-500",
                      syncStatus.tone === "orange" && "bg-orange-500",
                      syncStatus.tone === "red" && "bg-red-500",
                      syncStatus.pulse && "animate-pulse",
                    )}
                  />
                  <span>{syncStatus.label}</span>
                </div>
                <div className="space-y-2.5 border-t border-black/5 pt-2.5 dark:border-white/10">
                  <div>
                    <div className="font-medium text-ink-900 dark:text-white">筆記標注</div>
                    <p className="mt-0.5 leading-relaxed">{syncStatus.annotationText}</p>
                    {syncStatus.annotationActionLabel && (
                      <Button size="sm" className="mt-2 w-full" onClick={() => void annotationSync.retry()}>
                        {syncStatus.annotationActionLabel}
                      </Button>
                    )}
                  </div>
                  <div className="border-t border-black/5 pt-2 dark:border-white/10">
                    <div className="font-medium text-ink-900 dark:text-white">閱讀位置</div>
                    <p className="mt-0.5 leading-relaxed">{syncStatus.progressText}</p>
                    {syncStatus.progressActionLabel && (
                      <Button size="sm" className="mt-2 w-full" onClick={() => void readingProgress.retry()}>
                        {syncStatus.progressActionLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </>}
    </div>
  );

  const annotationBar = (
    <AnimatePresence>
      {annotating && (
        <div className={clsx("pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3", device === "phone" ? "bottom-3" : "top-3")} style={device === "phone" ? { bottom: "max(12px, var(--safe-bottom))" } : undefined}>
          <div className="pointer-events-auto">
            <AnnotationToolbar
              tool={tool}
              setTool={setTool}
              settings={settings}
              setSettings={setSettings}
              hasText={hasText}
              penOnly={penOnly}
              setPenOnly={(v: boolean) => {
                setPenOnly(v);
                try {
                  localStorage.setItem("ink-pen-only", v ? "1" : "0");
                } catch {
                  /* 無痕模式 */
                }
              }}
              share={shareNew}
              setShare={setShareNew}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onUndo={undo}
              onRedo={redo}
              showPenOnly={device === "tablet"}
              compact={device === "phone"}
            />
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  const viewerEl = (
    <div ref={viewport} className="relative min-h-0 min-w-0 flex-1">
      {loadErr ? (
        <div className="space-y-3 p-4"><ErrorBox error={loadErr} /><Button onClick={() => setPdfAttempt(value => value + 1)}>重新載入 PDF</Button></div>
      ) : !doc ? (
        <Loading label="載入 PDF…" />
      ) : (
        <PdfViewer
          ref={viewer}
          doc={doc}
          initialPage={initialReadingPage(params, readingProgress.initialPage, book.page_offset ?? 0, doc.numPages)}
          scale={effScale}
          spread={spread}
          slot={viewSlot}
          rotations={rotations}
          tool={annotating && annotationSync.ready ? tool : "none"}
          settings={settings}
          penOnly={penOnly}
          textLayer={hasText}
          annotations={annotations}
          onCreate={create}
          onDelete={remove}
          onReplace={replace}
          onNoteOpen={setNote}
          onPageChange={setPage}
          onTap={() => device === "phone" && !annotating && setChrome((c) => !c)}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      )}
      {annotationBar}
      <AnimatePresence>
        {Math.abs(zoom - 1) > 0.02 && (
          <motion.div
            key="zoom-badge"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={spring}
            className={clsx("absolute right-3 z-20 flex items-center gap-1 rounded-full bg-ink-900/85 p-1 pl-3 text-xs font-medium text-white shadow-lg backdrop-blur", device !== "phone" && "bottom-4")}
            style={device === "phone" ? { bottom: annotating ? "calc(5.25rem + var(--safe-bottom))" : "calc(1rem + var(--safe-bottom))" } : undefined}
          >
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            {device === "phone" && (
              <>
                <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15" aria-label="縮小" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}>
                  −
                </button>
                <button className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/15" aria-label="放大" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}>
                  +
                </button>
              </>
            )}
            <button className="rounded-full bg-white px-2.5 py-1 text-ink-900" onClick={() => setZoom(1)}>
              重設
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const sidePanel = panel && doc && <SidePanel kind={panel} doc={doc} bookId={id!} page={page} onGo={goto} onClose={() => setPanel(null)} />;

  return (
    <div className="flex h-full flex-col bg-ink-100 dark:bg-ink-950">
      <AnimatePresence initial={false}>
        {(chrome || writingMode || device !== "phone") && (
          <motion.div key="top" initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }} transition={spring}>
            {toolbar}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {device !== "phone" && sidePanel && (
            <motion.div key="side" initial={{ width: 0, opacity: 0 }} animate={{ width: 288, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={spring} className="shrink-0 overflow-hidden border-r border-black/5 bg-white dark:border-white/10 dark:bg-ink-900">
              <div className="h-full w-72">{sidePanel}</div>
            </motion.div>
          )}
        </AnimatePresence>
        {viewerEl}
        <AnimatePresence initial={false}>
          {device === "tablet" && toolsOpen && (
            <motion.div key="tools" initial={{ width: 0 }} animate={{ width: "42%" }} exit={{ width: 0 }} transition={spring} className="max-w-xl shrink-0 overflow-hidden border-l border-black/5 dark:border-white/10">
              <div className="h-full min-w-80">
                <ToolPanel initial={isMath ? "graphing" : "scientific"} compactTabs />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {device === "phone" && (
        <Sheet open={!!panel} onClose={() => setPanel(null)} title={{ outline: "目錄", bookmarks: "書籤", search: "搜尋" }[panel ?? "outline"]} side="bottom">
          <div className="h-[60vh]">{sidePanel}</div>
        </Sheet>
      )}
      <Sheet open={jumpOpen} onClose={() => setJumpOpen(false)} title="跳至頁碼">
        <form className="space-y-3 p-5" onSubmit={event => {
          event.preventDefault();
          const value = jumpValue.trim(), match = /^(p)?(\d+)$/i.exec(value);
          const target = match ? Number(match[2]) + (match[1] ? book.page_offset ?? 0 : 0) : NaN;
          if (!doc || !Number.isSafeInteger(target) || target < 1 || target > doc.numPages) { setJumpError(`請輸入 1–${doc?.numPages ?? 1} 的 PDF 頁碼，或有效的印刷頁碼（如 p58）。`); return; }
          goto(target); setJumpOpen(false);
        }}>
          <label className="block space-y-2 text-sm"><span>PDF 頁碼或印刷頁碼</span><input autoFocus className="h-11 w-full rounded-xl border border-slate-300 px-3 dark:border-slate-600 dark:bg-slate-800" value={jumpValue} onChange={event => { setJumpValue(event.target.value); setJumpError(null); }} aria-invalid={!!jumpError} aria-describedby="reader-jump-help" /></label>
          <p id="reader-jump-help" className="text-xs text-slate-500">PDF 共 {doc?.numPages ?? "…"} 頁。輸入 p58 可跳到課本印刷頁 58。</p>
          {jumpError && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{jumpError}</p>}
          <Button type="submit" variant="primary" className="min-h-11">前往該頁</Button>
        </form>
      </Sheet>
      {device === "phone" && (
        <BottomPanel open={toolsOpen} onClose={() => setToolsOpen(false)} title="數學工具">
          <ToolPanel initial={isMath ? "graphing" : "scientific"} compactTabs />
        </BottomPanel>
      )}
      {device === "desktop" && toolsOpen && (
        <FloatingWindow title="數學工具" onClose={() => setToolsOpen(false)}>
          <ToolPanel initial={isMath ? "graphing" : "scientific"} />
        </FloatingWindow>
      )}
      {note && (
        <Sheet open onClose={() => setNote(null)} title="便利貼">
          <div className="space-y-3 p-5">
            <div className="rounded-2xl p-4 whitespace-pre-wrap shadow-inner" style={{ background: note.color }}>
              <span className="text-ink-900">{note.data.text}</span>
            </div>
            <div className="text-xs text-slate-500">
              {note.author ?? ""} · 第 {note.page} 頁 {note.visibility === "shared" ? "· 已分享" : ""}
            </div>
            {note.mine && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  remove(note.id);
                  setNote(null);
                }}
              >
                刪除
              </Button>
            )}
          </div>
        </Sheet>
      )}
      <Sheet open={!!newNote} onClose={() => setNewNote(null)} title="新增便利貼">
        <form className="space-y-3 p-5" onSubmit={event => {
          event.preventDefault();
          if (!newNote || !noteText.trim() || !annotationSync.ready) return;
          create({ ...newNote, data: { ...newNote.data, text: noteText.trim() } }); setNewNote(null);
        }}>
          <label className="block space-y-2 text-sm"><span>便利貼內容</span><textarea autoFocus rows={5} maxLength={10000} className="w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" value={noteText} onChange={event => setNoteText(event.target.value)} /></label>
          <Button type="submit" variant="primary" className="min-h-11" disabled={!noteText.trim() || !annotationSync.ready}>儲存便利貼</Button>
        </form>
      </Sheet>
    </div>
  );
}

function SidePanel({ kind, doc, bookId, page, onGo, onClose }: { kind: "outline" | "bookmarks" | "search"; doc: PDFDocumentProxy; bookId: string; page: number; onGo: (p: number) => void; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="hidden items-center border-b border-slate-200 px-3 py-2 text-sm font-semibold md:flex dark:border-slate-800">
        <span className="flex-1">{{ outline: "目錄", bookmarks: "書籤", search: "全文搜尋" }[kind]}</span>
        <IconButton label="關閉" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {kind === "outline" && <Outline doc={doc} onGo={onGo} />}
        {kind === "bookmarks" && <Bookmarks bookId={bookId} page={page} onGo={onGo} />}
        {kind === "search" && <TextSearch doc={doc} onGo={onGo} />}
      </div>
    </div>
  );
}

function Outline({ doc, onGo }: { doc: PDFDocumentProxy; onGo: (p: number) => void }) {
  const [items, setItems] = useState<OutlineItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError(null);
    loadOutline(doc).then(value => { if (active) setItems(value); }).catch(cause => { if (active) setError(cause); });
    return () => { active = false; };
  }, [doc, attempt]);
  if (error) return <div className="space-y-3 p-3"><ErrorBox error={error} /><Button onClick={() => setAttempt(value => value + 1)}>重新讀取目錄</Button></div>;
  if (!items) return <Loading />;
  if (!items.length) return <div className="p-4 text-sm text-slate-500">此 PDF 沒有內建目錄</div>;
  const render = (list: OutlineItem[], depth: number) =>
    list.map((it, i) => (
      <div key={i}>
        <button className="block min-h-11 w-full truncate px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800" style={{ paddingLeft: 12 + depth * 14 }} disabled={!it.page} onClick={() => it.page && onGo(it.page)}>
          {it.title} <span className="text-xs text-slate-400">{it.page}</span>
        </button>
        {render(it.items, depth + 1)}
      </div>
    ));
  return <div className="py-1">{render(items, 0)}</div>;
}

function Bookmarks({ bookId, page, onGo }: { bookId: string; page: number; onGo: (p: number) => void }) {
  const user = useUser();
  const q = useQuery({ queryKey: ["bookmarks", bookId], queryFn: () => api.get<{ bookmarks: { id: string; page: number; label: string | null }[] }>(`/api/books/${bookId}/bookmarks`) });
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [targetPage, setTargetPage] = useState(page);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const save = async (work: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await work(); await q.refetch(); return true; }
    catch (cause) { setError(cause); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return (
    <div className="space-y-2 p-2">
      <Button size="sm" className="min-h-11 w-full" disabled={busy || !q.data} onClick={() => { setTargetPage(page); setLabel(`第 ${page} 頁`); setAdding(true); setError(null); }}>
        <BookmarkSimple size={16} /> 將第 {page} 頁加入書籤
      </Button>
      {adding && <form className="space-y-2 rounded-xl bg-ink-100 p-3 dark:bg-white/5" onSubmit={async event => {
        event.preventDefault();
        if (await save(() => api.post(`/api/books/${bookId}/bookmarks`, { owner_id: user.id, page: targetPage, label }))) setAdding(false);
      }}>
        <label className="block text-xs">書籤名稱（可留空）<input autoFocus className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm dark:border-slate-600 dark:bg-slate-800" value={label} onChange={event => setLabel(event.target.value)} disabled={busy} /></label>
        <div className="flex gap-2"><Button size="sm" className="min-h-11" type="submit" disabled={busy}>{busy ? "儲存中…" : "儲存書籤"}</Button><Button size="sm" className="min-h-11" type="button" disabled={busy} onClick={() => setAdding(false)}>取消</Button></div>
      </form>}
      {q.isLoading && <Loading label="讀取書籤…" />}
      {!!(q.error || error) && <div role="alert"><ErrorBox error={error ?? q.error} />{q.error && <Button size="sm" className="min-h-11" onClick={() => void q.refetch()}>重新讀取書籤</Button>}</div>}
      {q.data?.bookmarks.length === 0 && <p className="p-2 text-sm text-slate-500">尚未新增書籤。可將正在閱讀的頁面加入書籤。</p>}
      {q.data?.bookmarks.map((bookmark) => (
        <div key={bookmark.id} className="flex items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <button className="min-h-11 min-w-0 flex-1 px-2 py-1.5 text-left text-sm" onClick={() => onGo(bookmark.page)}>
            <span className="inline-flex items-center gap-2"><BookmarkSimple size={16} weight="fill" className="shrink-0 text-brand-500" /><span className="break-words">{bookmark.label || `第 ${bookmark.page} 頁`}</span></span>
          </button>
          <button className="grid h-11 w-11 shrink-0 place-items-center text-slate-400 hover:text-rose-500 disabled:opacity-40" aria-label={`刪除書籤 ${bookmark.label || `第 ${bookmark.page} 頁`}`} disabled={busy} onClick={() => void save(() => api.del(`/api/books/${bookId}/bookmarks/${bookmark.id}`))}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TextSearch({ doc, onGo }: { doc: PDFDocumentProxy; onGo: (p: number) => void }) {
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState<{ page: number; snippet: string }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const runId = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const run = async () => {
    const term = q.trim().toLowerCase();
    if (!term) return;
    const token = ++runId.current;
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    setSearched(q.trim()); setResults([]); setError(null);
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        if (token !== runId.current) return;
        setProgress(p);
        const page = await doc.getPage(p);
        if (token !== runId.current) return;
        const text = await readPdfPageText(page, controller.signal);
        if (token !== runId.current) return;
        const index = text.toLowerCase().indexOf(term);
        if (index >= 0) setResults(current => [...current, { page: p, snippet: text.slice(Math.max(0, index - 30), index + term.length + 40) }]);
      }
    } catch (cause) { if (token === runId.current) setError(cause); }
    finally { if (token === runId.current) setProgress(null); }
  };
  useEffect(() => () => { runId.current++; searchController.current?.abort(); }, [doc]);
  return (
    <div className="p-2">
      <form onSubmit={event => { event.preventDefault(); void run(); }} className="mb-2 flex gap-1">
        <input aria-label="PDF 搜尋關鍵字" className="h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={q} onChange={event => setQ(event.target.value)} placeholder="關鍵字" />
        <Button size="sm" className="min-h-11" type="submit" disabled={!q.trim()}>搜尋</Button>
      </form>
      {progress !== null && (
        <div className="mb-2 flex items-center gap-2 text-xs text-slate-500" role="status">
          <Spinner className="h-3 w-3" /> 第 {progress}/{doc.numPages} 頁
          <button className="ml-auto min-h-11 px-2 underline" onClick={() => { runId.current++; searchController.current?.abort(); setProgress(null); }}>停止</button>
        </div>
      )}
      {!!error && <div role="alert" className="mb-2 text-sm text-rose-600 dark:text-rose-300">{errorMessage(error)}，可重新搜尋。</div>}
      {results.map((result, index) => (
        <button key={index} className="block min-h-11 w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => onGo(result.page)}>
          <span className="font-semibold">p.{result.page}</span> …{result.snippet}…
        </button>
      ))}
      {progress === null && searched && !error && results.length === 0 && <div className="text-xs text-slate-500">找不到「{searched}」的結果</div>}
    </div>
  );
}
