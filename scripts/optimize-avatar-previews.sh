#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/apps/char-img"
OUT_DIR="$ROOT_DIR/apps/char-img/optimized"

mkdir -p "$OUT_DIR"

# The in-game picker renders avatars at 56x64 CSS pixels. We ship 1x and 2x
# variants at matching aspect ratio (2:3) to keep quality while minimizing
# transfer and decode memory.
for n in 1 2 3 4; do
  sips -s format jpeg -s formatOptions 90 -z 336 224 "$SRC_DIR/char${n}.png" \
    --out "$OUT_DIR/char${n}-1x.jpg" >/dev/null
  sips -s format jpeg -s formatOptions 90 -z 672 448 "$SRC_DIR/char${n}.png" \
    --out "$OUT_DIR/char${n}-2x.jpg" >/dev/null
done

echo "Optimized previews written to $OUT_DIR"
