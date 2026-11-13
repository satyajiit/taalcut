#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the `embeddinggemma-2-coreml` component (packages/vision SPEC, "Core ML backend"): EmbeddingGemma 2 compiled
# for Core ML with the weights of the ONNX component the app ships, for the mac helper's embed service (macOS 15+).
#
#   [PYTHON=python3.12] tools/components/pack-embeddinggemma-coreml.sh [onnx-dir] [out-dir]
#
# 1. Fetches FluidInference/embeddinggemma-2-coreml at a pinned revision (the two .mlpackage graphs and the position
#    table; Apache-2.0) and checks each file against embeddinggemma-coreml/checksums.txt.
# 2. Writes the ONNX component's q4 weights into them (embeddinggemma-coreml/q4_surgery.py, in a venv with the pinned
#    embeddinggemma-coreml/requirements.txt), from onnx-dir (default packages/vision/.cache/embeddinggemma-2, the
#    unpacked `embeddinggemma-2` component).
# 3. Compiles both with `xcrun coremlcompiler`, so nothing compiles from an .mlpackage on a user's Mac (only Core ML's
#    own per-device step at the first load).
# 4. Takes the weights out (IX3-N3): token_table.py writes the token table as the ONNX component's 4-bit table
#    (embeddings.q4, checked to dequantise to embeddings.f16 byte for byte), and weight_recipe.py replaces both
#    weights/weight.bin files and embeddings.q4 with weights.json and weights.raw, a recipe that writes them again
#    from the `embeddinggemma-2` component on first use (vision embed/coreml-weights.ts), checked here byte for byte.
# 5. Packs EmbeddingGemma2Text.mlmodelc and EmbeddingGemma2Vision.mlmodelc (without weights), position_embeddings.f16,
#    weights.json and weights.raw with the components' archive recipe (sorted names, ustar, uid/gid 0, mode 0644/0755,
#    mtime 0 UTC, no macOS metadata, zstd -19 -T1) into out-dir (default packages/vision/.cache/components), and
#    unpacks the same files into packages/vision/.cache/embeddinggemma-2-coreml for tests, studies and the helper's
#    own tests (the first load there writes the weights into its expanded/ folder).
# Prints the archive's sha256, size and extractedSize for the manifest.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HERE="$ROOT/tools/components/embeddinggemma-coreml"
ONNX="${1:-$ROOT/packages/vision/.cache/embeddinggemma-2}"
OUT="${2:-$ROOT/packages/vision/.cache/components}"
DEV="$ROOT/packages/vision/.cache/embeddinggemma-2-coreml"
REPO=FluidInference/embeddinggemma-2-coreml
REVISION=3f978ddf92cac9aa07eb2dcf6eb36cf450f3dba4
NAME=embeddinggemma-2-coreml-q4recipe-daa72c5
ARCHIVE="$OUT/$NAME.tar.zst"
WORK="$ROOT/packages/vision/.cache/coreml-build"

[ -f "$ONNX/onnx/model_q4.onnx" ] && [ -f "$ONNX/onnx/vision_encoder_q4f16.onnx" ] || {
  echo "error: $ONNX is not the unpacked embeddinggemma-2 component" >&2
  exit 1
}
mkdir -p "$WORK/fluid" "$OUT"

# 1. The Fluid graphs, checked.
FILES="$(cut -c67- "$HERE/checksums.txt")"
for f in $FILES; do
  if [ ! -f "$WORK/fluid/$f" ]; then
    mkdir -p "$(dirname "$WORK/fluid/$f")"
    curl -fsSL --retry 3 -o "$WORK/fluid/$f" "https://huggingface.co/$REPO/resolve/$REVISION/$f"
  fi
done
(cd "$WORK/fluid" && shasum -a 256 -c "$HERE/checksums.txt")

# 2. Our weights in their graphs.
[ -x "$WORK/venv/bin/python" ] || "${PYTHON:-python3}" -m venv "$WORK/venv"
"$WORK/venv/bin/python" -m pip install -q -r "$HERE/requirements.txt"
rm -rf "$WORK/q4"
"$WORK/venv/bin/python" -I "$HERE/q4_surgery.py" "$ONNX" "$WORK/fluid" "$WORK/q4"

# 3. Compiled.
STAGE="$WORK/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
for package in EmbeddingGemma2Text EmbeddingGemma2Vision; do
  xcrun coremlcompiler compile "$WORK/q4/$package.mlpackage" "$STAGE" >/dev/null
done

# 4. The weights as a recipe.
"$WORK/venv/bin/python" -I "$HERE/token_table.py" "$ONNX" "$WORK/q4"
cp "$WORK/q4/embeddings.q4" "$WORK/q4/position_embeddings.f16" "$STAGE/"
"$WORK/venv/bin/python" -I "$HERE/weight_recipe.py" "$ONNX" "$STAGE"

# 5. Packed and unpacked.
(cd "$STAGE" && find . -type d -exec chmod 0755 {} + && find . -type f -exec chmod 0644 {} + &&
  find . -exec env TZ=UTC touch -h -t 197001010000.00 {} +)
LIST="$(cd "$STAGE" && find . -type f | sed 's|^\./||' | LC_ALL=C sort)"
# shellcheck disable=SC2086
(cd "$STAGE" && COPYFILE_DISABLE=1 SOURCE_DATE_EPOCH=0 tar --format ustar --uid 0 --gid 0 --numeric-owner \
  --no-xattrs --no-mac-metadata --no-acls --no-fflags -cf - $LIST) | zstd -19 -T1 -q -f -o "$ARCHIVE"
rm -rf "$DEV"
mkdir -p "$DEV"
zstd -dc "$ARCHIVE" | tar -xf - -C "$DEV"

SIZE="$(stat -f %z "$ARCHIVE")"
SHA="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
EXTRACTED="$(zstd -dc "$ARCHIVE" | tar -tvf - | awk '$1 !~ /^l/ {s += $5} END {print s}')"
echo "{\"archive\":\"$ARCHIVE\",\"sha256\":\"$SHA\",\"size\":$SIZE,\"extractedSize\":$EXTRACTED}"
