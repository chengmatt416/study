// .docx → Markdown（mammoth）。圖片上傳到 R2；可移除 NotebookLM 引用標記 [1, 2]、[11-13]。
import { api } from "../../lib/api";

export const stripCitations = (md: string) => md.replace(/\s?\\?\[\d+(?:\s*[-–,]\s*\d+)*\\?\]/g, "");

export async function docxToMarkdown(file: File, opts: { stripCitations: boolean }): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const mammoth = (await import("mammoth")).default;
  const m = mammoth as unknown as {
    convertToMarkdown: (input: { arrayBuffer: ArrayBuffer }, options?: unknown) => Promise<{ value: string }>;
    images: { imgElement: (fn: (img: { contentType: string; read: (enc: "arraybuffer") => Promise<ArrayBuffer> }) => Promise<{ src: string }>) => unknown };
  };
  const result = await m.convertToMarkdown(
    { arrayBuffer },
    {
      convertImage: m.images.imgElement(async (img) => {
        const buf = await img.read("arraybuffer");
        const r = await api.post<{ url: string }>("/api/assets", new Blob([buf], { type: img.contentType }), { headers: { "content-type": img.contentType } });
        return { src: r.url };
      }),
    },
  );
  let md = result.value
    // mammoth 會跳脫許多符號；還原常見且安全的情況
    .replace(/\\([()\-!+'"])/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
  if (opts.stripCitations) md = stripCitations(md);
  return md.trim() + "\n";
}
