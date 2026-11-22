#!/usr/bin/env bash
# 掃描 PDF 前處理：OCR 加上隱藏文字層（可選字、搜尋、文字螢光）+ 壓縮影像 + linearize（加速首頁顯示）
# 用法：bash scripts/preprocess-pdf.sh 輸入.pdf [輸出.pdf] [語言，預設 eng+chi_tra]
# 需要 Docker（使用官方 ocrmypdf 映像，不需在本機安裝 Tesseract）
set -euo pipefail
IN="${1:?用法：preprocess-pdf.sh 輸入.pdf [輸出.pdf] [語言]}"
OUT="${2:-${IN%.pdf}.ocr.pdf}"
LANGS="${3:-eng+chi_tra}"
DIR="$(cd "$(dirname "$IN")" && pwd)"
docker run --rm -v "$DIR:/data" -w /data jbarlow83/ocrmypdf-alpine \
  --skip-text --rotate-pages --deskew --optimize 2 --output-type pdf -l "$LANGS" \
  "$(basename "$IN")" "$(basename "$OUT")"
echo "完成：$OUT（$(du -h "$DIR/$(basename "$OUT")" | cut -f1)）"
