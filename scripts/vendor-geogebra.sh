#!/usr/bin/env bash
# 下載 GeoGebra Math Apps Bundle 並放到 public/vendor/geogebra/（Workers Static Assets 免費託管）
# 若改用自己 fork 的建置產物，設定 GGB_BUNDLE_URL 指向 fork CI 產出的 zip。
# 授權：GeoGebra 非商業授權 + 原始碼 EUPL-1.2，見 https://www.geogebra.org/license
set -euo pipefail
URL="${GGB_BUNDLE_URL:-https://download.geogebra.org/package/geogebra-math-apps-bundle}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/vendor/geogebra"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/ggb.zip" -w "%{url_effective}\n" "$URL" | tee "$TMP/url"
unzip -q "$TMP/ggb.zip" -d "$TMP/x"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -R "$TMP/x/GeoGebra/." "$OUT/"
# 移除不需要的大型檔案（Java applet 時代遺留、單機 HTML 範例）
rm -f "$OUT/HTML5/5.0/GeoGebra.html"
basename "$(cat "$TMP/url")" > "$OUT/VERSION"
echo "OK -> $OUT ($(cat "$OUT/VERSION")), $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
