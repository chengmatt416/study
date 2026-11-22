import type { PracticeItem } from "../../../shared/practice";

export type PracticePreview = Record<string, string>;

export function createPracticePreview() {
  const cache = new WeakMap<PracticeItem, PracticePreview>();
  const pending = new Map<number, PracticeItem>();
  let queued = new WeakSet<PracticeItem>();
  let worker: Worker | undefined;
  let nextId = 0;
  let unavailable = false;

  function close() {
    worker?.terminate();
    worker = undefined;
    pending.clear();
    queued = new WeakSet();
  }

  function prepare(item: PracticeItem) {
    if (unavailable || cache.has(item) || queued.has(item) || pending.size >= 8) return;
    try {
      if (!worker) {
        worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }: MessageEvent<{ id: number; html: PracticePreview }>) => {
          const item = pending.get(data.id);
          if (item) cache.set(item, data.html);
          pending.delete(data.id);
        };
        worker.onerror = () => { unavailable = true; close(); };
      }
      const fields: [string, string][] = [["prompt", item.prompt_md]];
      if (item.passage_md) fields.push(["passage", item.passage_md]);
      if (item.instructions) fields.push(["instructions", item.instructions]);
      for (const option of item.options ?? []) fields.push([`option-${option.id}`, option.md]);
      const id = ++nextId;
      pending.set(id, item);
      queued.add(item);
      worker.postMessage({ id, fields });
    } catch {
      unavailable = true;
      close();
    }
  }

  return { prepare, get: (item: PracticeItem) => cache.get(item), close };
}
