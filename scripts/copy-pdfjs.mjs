// 將 pdf.js 的 CJK cMaps、標準字型、wasm 解碼器、ICC 色彩檔複製到 public/pdfjs（中文 PDF 必需）
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = new URL("../node_modules/pdfjs-dist/", import.meta.url);
const dst = new URL("../public/vendor/pdfjs/", import.meta.url);
mkdirSync(dst, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = new URL(dir + "/", src);
  if (existsSync(from)) cpSync(from, new URL(dir + "/", dst), { recursive: true });
}
console.log("pdf.js assets copied to public/vendor/pdfjs");

// MathLive（考試公式輸入）字型
const mlFonts = new URL("../node_modules/mathlive/fonts/", import.meta.url);
if (existsSync(mlFonts)) {
  cpSync(mlFonts, new URL("../public/vendor/mathlive/fonts/", import.meta.url), { recursive: true });
  console.log("mathlive fonts copied to public/vendor/mathlive/fonts");
}
