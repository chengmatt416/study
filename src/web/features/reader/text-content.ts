import type { PDFPageProxy } from "./pdf";

/** PDF.js uses stream async iteration, which is not available in every supported Safari engine. */
export async function readPdfPageText(page: Pick<PDFPageProxy, "streamTextContent">, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const reader = page.streamTextContent().getReader();
  const parts: string[] = [];
  let complete = false;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) { complete = true; break; }
      for (const item of value.items as { str?: string }[]) parts.push(item.str ?? "");
    }
    return parts.join(" ");
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
