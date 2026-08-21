#!/usr/bin/env bash
# Regenerate Icon.icns from Icon.svg. Run after editing the artwork; the
# generated .icns is committed too, so packaging works on a machine without
# a rasterizer installed.
#
#   Scripts/build_icon.sh
#
# Requires rsvg-convert (brew install librsvg) and iconutil (Xcode tools).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found: brew install librsvg" >&2; exit 1; }

SET=$(mktemp -d)/Icon.iconset
mkdir -p "$SET"
for pair in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" "512 512x512" "1024 512x512@2x"; do
  px=${pair%% *}
  name=${pair##* }
  rsvg-convert -w "$px" -h "$px" Icon.svg -o "$SET/icon_$name.png"
done

iconutil --convert icns --output Icon.icns "$SET"
rm -rf "$(dirname "$SET")"
echo "wrote $ROOT/Icon.icns"
