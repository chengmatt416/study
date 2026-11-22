#!/usr/bin/env bash
# 建置 libqalculate WebAssembly（來源：我們 fork 的 qalculator，預設 stephtr/qalculator）
# 產物：public/vendor/qalculate/calc.js + calc.wasm（GPL-2.0+，原始碼見 fork repo）
set -euo pipefail
REPO="${QALC_REPO:-https://github.com/stephtr/qalculator.git}"
REF="${QALC_REF:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/vendor/qalculate"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 --branch "$REF" "$REPO" "$WORK/src"
cd "$WORK/src/lib"
# 以 MODULARIZE 輸出，方便在 Web Worker 中 import
docker run --rm --mount type=bind,source="$PWD",target=/src --platform linux/amd64 \
  ghcr.io/stephtr/libqalculate-wasm:main \
  emcc -I /opt/include -L /opt/lib -lqalculate -lgmp -lmpfr -lxml2 --bind /src/calc.cc \
  -o /src/calc.js -O2 -s ENVIRONMENT=web,worker -s FILESYSTEM=0 -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
  -s MODULARIZE=1 -s EXPORT_NAME=createQalculate -s ALLOW_MEMORY_GROWTH=1
mkdir -p "$OUT"
cp calc.js calc.wasm "$OUT/"
git -C "$WORK/src" rev-parse HEAD > "$OUT/SOURCE_COMMIT"
echo "$REPO" > "$OUT/SOURCE_REPO"
echo "OK -> $OUT"; ls -la "$OUT"
