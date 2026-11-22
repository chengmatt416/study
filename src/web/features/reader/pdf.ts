import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export { pdfjs };
export type PDFDocumentProxy = pdfjs.PDFDocumentProxy;
export type PDFPageProxy = pdfjs.PDFPageProxy;

/** 以 Range 分段載入（大檔不需整本下載）；CJK cMap / 標準字型 / wasm 解碼器自架於 /vendor/pdfjs */
export function openPdf(url: string) {
  return pdfjs.getDocument({
    url,
    withCredentials: true,
    // 2 MB per range: large scanned books (500 MB, 1000+ pages) need half as many round trips as with 1 MB.
    rangeChunkSize: 2 << 20,
    disableAutoFetch: true,
    disableStream: true,
    cMapUrl: "/vendor/pdfjs/cmaps/",
    standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
    wasmUrl: "/vendor/pdfjs/wasm/",
    iccUrl: "/vendor/pdfjs/iccs/",
  });
}

export interface OutlineItem {
  title: string;
  page: number | null;
  items: OutlineItem[];
}

export async function loadOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
  const raw = await doc.getOutline();
  if (!raw) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const d = typeof dest === "string" ? await doc.getDestination(dest) : (dest as unknown[]);
      if (!d) return null;
      const ref = d[0];
      return typeof ref === "number" ? ref + 1 : (await doc.getPageIndex(ref as never)) + 1;
    } catch {
      return null;
    }
  };
  const walk = async (items: typeof raw): Promise<OutlineItem[]> =>
    Promise.all(items.map(async (it) => ({ title: it.title, page: await resolve(it.dest), items: await walk(it.items ?? []) })));
  return walk(raw);
}
