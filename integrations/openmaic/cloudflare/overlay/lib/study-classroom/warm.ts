// Small helpers for work done ahead of time, kept free of Core imports so they can be tested on their own.

/** A single-use cache for promises started before they are needed. Entries expire so a stale read is never served. */
export function createWarmCache<T>(ttlMs = 120_000, now: () => number = Date.now) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return {
    /** Starts `load` unless this key is already warm. A failed load is forgotten so the real caller retries it. */
    warm(key: string, load: () => Promise<T>): void {
      for (const [stale, entry] of entries) if (now() - entry.at > ttlMs) entries.delete(stale);
      if (entries.has(key)) return;
      const value = load();
      entries.set(key, { at: now(), value });
      value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
    },
    /** Hands over the warmed promise once; later callers load fresh state. */
    take(key: string): Promise<T> | undefined {
      const entry = entries.get(key);
      entries.delete(key);
      return entry && now() - entry.at <= ttlMs ? entry.value : undefined;
    },
    get size() { return entries.size; },
  };
}

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/** Image URLs written into any text of a quiz (stem, options, explanation), as Markdown or HTML, without inline data. */
export function collectImageUrls(value: unknown, limit = 24): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (found.size >= limit || depth > 6 || node === null || node === undefined) return;
    if (typeof node === 'string') {
      for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
        pattern.lastIndex = 0;
        for (const match of node.matchAll(pattern)) {
          const url = match[1];
          if (url && !/^(?:data|blob|javascript):/i.test(url) && found.size < limit) found.add(url);
        }
      }
    } else if (Array.isArray(node)) for (const item of node) visit(item, depth + 1);
    else if (typeof node === 'object') for (const item of Object.values(node)) visit(item, depth + 1);
  };
  visit(value, 0);
  return [...found];
}
