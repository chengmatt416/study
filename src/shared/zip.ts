// A small ZIP reader for Office files (pptx/docx are ZIP archives). Uses the platform's DecompressionStream, so it works
// in the browser and in Node without another dependency. Reads the central directory; supports stored and deflated entries.

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; offset: number }

export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("不是有效的 ZIP 檔（找不到目錄）");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("ZIP 目錄損毀");
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    entries.push({ name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), method, compressedSize, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function zipRead(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`ZIP 項目 ${entry.name} 損毀`);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error(`不支援的 ZIP 壓縮方式 ${entry.method}`);
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function zipText(bytes: Uint8Array, entry: ZipEntry): Promise<string> {
  return new TextDecoder().decode(await zipRead(bytes, entry));
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlUnescape = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
  code[0] === "#" ? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)) : XML_ENTITIES[code.toLowerCase()]);

/** The text of one DrawingML part (a slide or its notes): one line per paragraph, runs joined. */
export function drawingText(xml: string): string[] {
  const lines: string[] = [];
  for (const paragraph of xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? []) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)].map((m) => m[1] === undefined ? "\n" : xmlUnescape(m[1]));
    const line = runs.join("").replace(/[ \t]+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines;
}

/** pptx → Markdown: one section per slide in slide order, with the speaker notes after it. */
export async function pptxToMarkdown(bytes: Uint8Array): Promise<{ markdown: string; sections: number }> {
  const entries = zipEntries(bytes);
  const number = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).sort((a, b) => number(a.name) - number(b.name));
  if (!slides.length) throw new Error("這個 pptx 沒有投影片");
  const parts: string[] = [];
  for (const slide of slides) {
    const n = number(slide.name);
    const lines = drawingText(await zipText(bytes, slide));
    const notesEntry = entries.find((e) => e.name === `ppt/notesSlides/notesSlide${n}.xml`);
    // Notes parts also hold the slide number placeholder; drop bare numbers.
    const notes = notesEntry ? drawingText(await zipText(bytes, notesEntry)).filter((line) => !/^\d+$/.test(line)) : [];
    const [title, ...body] = lines;
    parts.push(`## 投影片 ${n}${title ? `：${title}` : ""}\n\n${body.map((line) => `- ${line}`).join("\n")}${notes.length ? `\n\n> 講者備註：${notes.join(" ")}` : ""}`.trim());
  }
  return { markdown: parts.join("\n\n"), sections: slides.length };
}
