// Turns an uploaded teaching file into Markdown text a chatbot can read over MCP. Runs in the browser, which already has
// pdf.js (PDF) and mammoth (docx); pptx is read with the small ZIP reader, html with DOMParser.
import { materialFormat, type MaterialFormat } from "../../../shared/chapter";
import { pptxToMarkdown } from "../../../shared/zip";

export interface Extracted { format: MaterialFormat; text: string; sections: number }

export async function extractMaterial(file: File, onProgress?: (message: string) => void): Promise<Extracted> {
  const format = materialFormat(file.name);
  if (!format) throw new Error("只支援 pptx、docx、md、pdf、html 檔案");
  if (format === "md") { const text = await file.text(); return { format, text, sections: (text.match(/^#{1,3}\s/gm) ?? []).length }; }
  if (format === "html") return { format, ...htmlToMarkdown(await file.text()) };
  if (format === "pptx") { const { markdown, sections } = await pptxToMarkdown(new Uint8Array(await file.arrayBuffer())); return { format, text: markdown, sections }; }
  if (format === "docx") {
    const mammoth = (await import("mammoth")).default as unknown as {
      convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }, options?: unknown) => Promise<{ value: string }>;
      images: { imgElement: (fn: () => Promise<{ src: string }>) => unknown };
    };
    // Images are dropped from the text; the original file is kept for the chatbot to fetch when a figure matters.
    const result = await mammoth.convertToMarkdown({ arrayBuffer: await file.arrayBuffer() }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
    const text = result.value.replace(/!\[[^\]]*\]\(\)/g, "［圖片］").replace(/\\([()\-!+'"])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
    return { format, text, sections: (text.match(/^#{1,3}\s/gm) ?? []).length };
  }
  const { pdfjs } = await import("../reader/pdf");
  const { readPdfPageText } = await import("../reader/text-content");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: "/vendor/pdfjs/cmaps/", standardFontDataUrl: "/vendor/pdfjs/standard_fonts/", wasmUrl: "/vendor/pdfjs/wasm/", iccUrl: "/vendor/pdfjs/iccs/" }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.(`擷取 PDF 文字 ${n} / ${doc.numPages}`);
      const page = await doc.getPage(n);
      const text = (await readPdfPageText(page)).trim();
      pages.push(`## 第 ${n} 頁\n\n${text || "（此頁沒有可擷取的文字）"}`);
      page.cleanup();
    }
    return { format, text: pages.join("\n\n"), sections: doc.numPages };
  } finally { void doc.cleanup(); }
}

/** Readable Markdown from an HTML page: headings, paragraphs, lists and table rows; scripts and styles removed. */
export function htmlToMarkdown(html: string): { text: string; sections: number } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,template,iframe,svg").forEach((node) => node.remove());
  const lines: string[] = [];
  let sections = 0;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (/^h[1-6]$/.test(tag)) { if (text) { lines.push(`${"#".repeat(Number(tag[1]))} ${text}`); sections++; } }
      else if (tag === "p" || tag === "blockquote" || tag === "pre" || tag === "figcaption") { if (text) lines.push(tag === "blockquote" ? `> ${text}` : text); }
      else if (tag === "li") { if (text) lines.push(`- ${text}`); }
      else if (tag === "tr") { const cells = Array.from(child.children).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()); if (cells.some(Boolean)) lines.push(`| ${cells.join(" | ")} |`); }
      else if (child.children.length) walk(child);
      else if (text) lines.push(text);
    }
  };
  walk(doc.body);
  return { text: lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(), sections };
}
