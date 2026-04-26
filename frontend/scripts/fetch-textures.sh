#!/bin/sh
# Download Poly Haven CC0 textures the frontend uses for PBR materials.
# Run from the container build step; idempotent (skips existing files).
set -eu

OUT_DIR="${OUT_DIR:-/app/public/textures}"
mkdir -p "$OUT_DIR"

# List of (asset_id, map_type) pairs — we grab diff / nor_gl / rough for each.
IDS="medieval_blocks_03 castle_brick_07 wood_floor_worn concrete_wall_008 large_grey_tiles"
MAPS="diff nor_gl rough"

base="https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k"

for id in $IDS; do
  mkdir -p "$OUT_DIR/$id"
  for map in $MAPS; do
    file="${id}_${map}_1k.jpg"
    dest="$OUT_DIR/$id/$file"
    if [ -s "$dest" ]; then
      echo "skip  $dest"
      continue
    fi
    url="${base}/${id}/${file}"
    echo "fetch $url"
    curl -fsSL -o "$dest" "$url" || {
      echo "FAILED to fetch $url" >&2
      rm -f "$dest"
      exit 1
    }
  done
done

echo "Done. Textures in $OUT_DIR"
