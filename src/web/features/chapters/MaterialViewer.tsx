import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { PPTXViewer } from "pptxviewjs";
import { Button, Card, ErrorBox, Loading } from "../../components/ui";
import { Markdown } from "../../components/Markdown";
import type { MaterialFormat } from "../../../shared/chapter";

type Status = { status: "loading" } | { status: "ready" } | { status: "error"; error: unknown };
type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: unknown };

/** The original file as the browser fetched it. Failing here usually means the material was deleted or the chapter is no longer visible. */
async function fetchOriginal(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`讀取原檔失敗（HTTP ${res.status}）`);
  return res.arrayBuffer();
}

function useLoaded<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    load().then((value) => { if (alive) setState({ status: "ready", value }); }, (error: unknown) => { if (alive) setState({ status: "error", error }); });
    return () => { alive = false; };
    // The loader is re-created on each render; the key is what changes the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/**
 * Shows the uploaded file itself, not only its extracted text: docx through docx-preview (pages, tables, images, styles),
 * pptx through pptxviewjs (each slide drawn on a canvas), md as rendered Markdown and html in a sandboxed frame.
 * The libraries load only when a file of that kind is opened.
 */
export function MaterialViewer({ format, fileUrl, filename }: { format: Exclude<MaterialFormat, "pdf">; fileUrl: string; filename: string }) {
  if (format === "docx") return <DocxView url={fileUrl} />;
  if (format === "pptx") return <PptxView url={fileUrl} />;
  if (format === "md") return <MarkdownView url={fileUrl} />;
  return <HtmlView url={fileUrl} title={filename} />;
}

function DocxView({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Status>({ status: "loading" });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let alive = true;
    setState({ status: "loading" });
    (async () => {
      const [{ renderAsync }, buffer] = await Promise.all([import("docx-preview"), fetchOriginal(url)]);
      if (!alive) return;
      el.replaceChildren();
      await renderAsync(buffer, el, undefined, { inWrapper: true, breakPages: true });
      // Word draws list bullets with the Symbol font's private-use characters, which browsers do not have (they show as boxes).
      // Swap them for ordinary bullet characters that any font can draw.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue ?? "";
        if (/[]/.test(text)) node.nodeValue = text.replace(//g, "•").replace(//g, "▪").replace(//g, "➢");
      }
      if (alive) setState({ status: "ready" });
    })().catch((error: unknown) => { if (alive) setState({ status: "error", error }); });
    return () => { alive = false; el.replaceChildren(); };
  }, [url]);
  return <div className="relative">
    {state.status === "loading" && <Loading label="排版文件" rows={5} />}
    {state.status === "error" && <ErrorBox error={state.error} />}
    <div ref={host} className="docx-viewer overflow-auto rounded-2xl bg-slate-100 dark:bg-ink-950" aria-label="文件內容" />
  </div>;
}

function PptxView({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<PPTXViewer | null>(null);
  const [state, setState] = useState<Status>({ status: "loading" });
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  indexRef.current = index;

  // The library draws a slide at its own default size (600 px wide), too small to read on a laptop or a phone.
  // Draw at the width the frame has, times the screen's pixel density, so the text stays sharp and fills the frame.
  const draw = (v: PPTXViewer, slide: number) => {
    const width = frame.current?.clientWidth ?? 600;
    const scale = Math.min(4, Math.max(0.5, (width * (window.devicePixelRatio || 1)) / 600));
    return v.renderSlide(slide, canvas.current, { scale });
  };

  // Redraw the current slide when the frame changes width (window resize, phone rotation).
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let last = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === last || !viewer.current) return;
      last = el.clientWidth;
      void draw(viewer.current, indexRef.current);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // draw reads only refs and the window, so the first closure stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    let instance: PPTXViewer | null = null;
    setState({ status: "loading" });
    (async () => {
      const [{ PPTXViewer: Viewer }, buffer] = await Promise.all([import("pptxviewjs"), fetchOriginal(url)]);
      if (!alive || !canvas.current) return;
      instance = new Viewer({ canvas: canvas.current, slideSizeMode: "fit" });
      await instance.loadFile(buffer);
      if (!alive) { instance.destroy(); return; }
      viewer.current = instance;
      setCount(instance.getSlideCount());
      await draw(instance, 0);
      if (alive) { setIndex(0); setState({ status: "ready" }); }
    })().catch((error: unknown) => { if (alive) setState({ status: "error", error }); });
    return () => { alive = false; viewer.current = null; instance?.destroy(); };
  }, [url]);

  const go = async (next: number) => {
    const v = viewer.current;
    if (!v || busy || next < 0 || next >= count) return;
    setBusy(true);
    try { await draw(v, next); setIndex(next); }
    catch (error) { setState({ status: "error", error }); }
    finally { setBusy(false); }
  };

  // Arrow keys turn slides when the page itself has focus, not when a field is being typed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") void go(index + 1);
      if (event.key === "ArrowLeft" || event.key === "PageUp") void go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // go reads the latest index and count through the closure on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, busy]);

  return <div className="space-y-3">
    {state.status === "loading" && <Loading label="排版投影片" rows={4} />}
    {state.status === "error" && <ErrorBox error={state.error} />}
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={index <= 0 || busy} onClick={() => void go(index - 1)} aria-label="上一張"><CaretLeft size={16} />上一張</Button>
      <span className="mr-auto text-center text-sm tabular-nums text-slate-500" role="status">第 {count ? index + 1 : 0} / {count} 張</span>
      <Button size="sm" disabled={index >= count - 1 || busy} onClick={() => void go(index + 1)} aria-label="下一張">下一張<CaretRight size={16} /></Button>
    </div>
    <Card className="bg-slate-100 p-3 dark:bg-ink-950"><div ref={frame} className="w-full">
      <canvas ref={canvas} className="block h-auto w-full bg-white shadow-sm" aria-label={`投影片 ${index + 1}`} />
    </div></Card>
  </div>;
}

function MarkdownView({ url }: { url: string }) {
  const state = useLoaded(async () => new TextDecoder().decode(await fetchOriginal(url)), url);
  if (state.status === "loading") return <Loading label="讀取文件" rows={5} />;
  if (state.status === "error") return <ErrorBox error={state.error} />;
  return <Card className="p-5 md:p-8"><Markdown md={state.value} /></Card>;
}

function HtmlView({ url, title }: { url: string; title: string }) {
  const state = useLoaded(async () => new TextDecoder().decode(await fetchOriginal(url)), url);
  if (state.status === "loading") return <Loading label="讀取網頁" rows={5} />;
  if (state.status === "error") return <ErrorBox error={state.error} />;
  // An empty sandbox runs no scripts and gives the page its own origin, so an uploaded page cannot reach the app or its data.
  // Its styles and images still render; scripts do not.
  return <iframe title={title} sandbox="" srcDoc={state.value} className="block min-h-[70dvh] w-full rounded-2xl bg-white" />;
}
