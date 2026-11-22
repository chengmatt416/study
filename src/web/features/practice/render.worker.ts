import { renderMarkdown } from "../../../shared/markdown";

const worker = self as DedicatedWorkerGlobalScope;
worker.onmessage = ({ data }: MessageEvent<{ id: number; fields: [string, string][] }>) => {
  const html: Record<string, string> = {};
  for (const [key, markdown] of data.fields) {
    try { html[key] = renderMarkdown(markdown); }
    catch { /* The regular Markdown component handles rendering errors. */ }
  }
  worker.postMessage({ id: data.id, html });
};
