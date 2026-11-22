// 資料手冊檢視器（作答時在側邊/浮動視窗/底部抽屜開啟）：唯讀、可縮放與跳頁
import { useCallback, useEffect, useRef, useState } from "react";
import { MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { Button, ErrorBox, IconButton, Loading } from "../../components/ui";
import { openPdf, type PDFDocumentProxy } from "./pdf";
import { PdfViewer, type ViewerHandle } from "./PdfViewer";
import { DEFAULT_SETTINGS } from "./AnnotationToolbar";
import { MAX_ZOOM, MIN_ZOOM } from "./usePinchZoom";

const noop = () => undefined;

export function BookletViewer({ bookId }: { bookId: string }) {
  return <BookletDocument key={bookId} bookId={bookId} />;
}

function BookletDocument({ bookId }: { bookId: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [slot, setSlot] = useState({ w: 595, h: 842 });
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<ViewerHandle>(null);

  useEffect(() => {
    let active = true;
    setDoc(null); setError(null);
    const task = openPdf(`/api/books/${bookId}/file`);
    task.promise
      .then(async (d) => {
        const vp = (await d.getPage(1)).getViewport({ scale: 1 });
        if (!active) return;
        setSlot({ w: vp.width, h: vp.height });
        setDoc(d);
      })
      .catch((e) => { if (active) setError(String(e?.message ?? e)); });
    return () => { active = false; void task.destroy(); };
  }, [bookId, attempt]);

  const fit = useCallback(() => {
    if (box.current) setScale(Math.max(0.3, (box.current.clientWidth - 24) / slot.w));
  }, [slot]);
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-black/5 px-2 py-1.5 dark:border-white/10">
        <button
          className="rounded-xl bg-ink-100 px-2.5 py-1 font-mono text-xs dark:bg-white/10"
          onClick={() => {
            const v = Number(prompt(`跳到第幾頁？（1–${doc?.numPages ?? "?"}）`));
            if (v) viewer.current?.scrollToPage(Math.min(Math.max(1, v), doc?.numPages ?? 1));
          }}
        >
          {page}/{doc?.numPages ?? "…"}
        </button>
        <span className="flex-1" />
        <IconButton label="縮小" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.2))}>
          <MagnifyingGlassMinus size={18} />
        </IconButton>
        <button className="w-11 text-xs text-slate-500" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="放大" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}>
          <MagnifyingGlassPlus size={18} />
        </IconButton>
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        {error ? (
          <div className="space-y-3 p-4"><ErrorBox error={error} /><Button className="min-h-11" onClick={() => setAttempt(value => value + 1)}>重新載入資料手冊</Button></div>
        ) : !doc ? (
          <Loading label="載入資料手冊…" rows={2} />
        ) : (
          <PdfViewer
            ref={viewer}
            doc={doc}
            scale={scale * zoom}
            spread={false}
            slot={slot}
            tool="none"
            settings={DEFAULT_SETTINGS}
            penOnly={false}
            textLayer
            annotations={[]}
            onCreate={noop}
            onDelete={noop}
            onReplace={noop}
            onNoteOpen={noop}
            onPageChange={setPage}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        )}
      </div>
    </div>
  );
}
