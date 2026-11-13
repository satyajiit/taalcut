#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the `transnetv2-coreml` component (packages/vision SPEC, "Shot boundaries on Core ML"): TransNetV2 with
# upstream's weights as one fp32 Core ML model, for the mac helper's shots service (macOS 14+). Runs Core ML
# predictions on the GPU (the gate): run it through the VideoToolbox lock like any GPU work.
#
#   [PYTHON=python3.12] tools/components/pack-transnetv2-coreml.sh [footage-dir] [onnx] [out-dir]
#
# 1. Fetches upstream (soCzech/TransNetV2) at a pinned revision: the PyTorch port, its weight converter, the TF
#    SavedModel weights (git LFS) and the licence, each checked against transnetv2-coreml/checksums.txt.
# 2. In a venv with the pinned transnetv2-coreml/requirements.txt (build tools only, none shipped): upstream's
#    weights into upstream's port, the Core ML rewrite, the conversion (transnetv2-coreml/build.py).
# 3. Compiles it with `xcrun coremlcompiler`, so nothing compiles from an .mlpackage on a user's Mac.
# 4. The parity gate (transnetv2-coreml/gate.py): the compiled model on the GPU against the shipped ONNX
#    (default packages/vision/.cache/transnetv2/transnetv2.onnx, checked by sha256) on every window of footage-dir
#    (default ~/TaalcutBench/footage/ix-v1): the same transition runs and spans, max |diff| under 1e-3. Stops here
#    when it fails. Writes the helper's test fixture (transnetv2-coreml/fixture.py).
# 5. Packs TransNetV2.mlmodelc and upstream's LICENSE with the components' archive recipe (sorted names, ustar,
#    uid/gid 0, mode 0644/0755, mtime 0 UTC, no macOS metadata, zstd -19 -T1) into out-dir (default
#    packages/vision/.cache/components), and unpacks the same files into packages/vision/.cache/transnetv2-coreml
#    for tests, evals and the helper's own tests.
# Prints the archive's sha256, size and extractedSize for the manifest.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HERE="$ROOT/tools/components/transnetv2-coreml"
FOOTAGE="${1:-$HOME/TaalcutBench/footage/ix-v1}"
ONNX="${2:-$ROOT/packages/vision/.cache/transnetv2/transnetv2.onnx}"
OUT="${3:-$ROOT/packages/vision/.cache/components}"
DEV="$ROOT/packages/vision/.cache/transnetv2-coreml"
FIXTURE="$ROOT/native/mac-helper/Tests/Fixtures/transnetv2-synthetic.json"
REPO=soCzech/TransNetV2
REVISION=85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed
ONNX_SHA=c4d54a682bace32f25136ef83ca2c9d403e8f8193775efeb995172a0d95a8e0c
NAME=transnetv2-coreml-fp32-85cef72
ARCHIVE="$OUT/$NAME.tar.zst"
WORK="$ROOT/packages/vision/.cache/transnetv2-coreml-build"
FFMPEG="${TAALCUT_FFMPEG:-$ROOT/tools/ffmpeg/dist/ffmpeg}"
FFPROBE="${TAALCUT_FFPROBE:-$ROOT/tools/ffmpeg/dist/ffprobe}"

[ "$(shasum -a 256 "$ONNX" | cut -d' ' -f1)" = "$ONNX_SHA" ] || {
  echo "error: $ONNX is not the shipped transnetv2.onnx ($ONNX_SHA)" >&2
  exit 1
}
[ -d "$FOOTAGE" ] || {
  echo "error: no footage at $FOOTAGE (tools/bench-footage makes ix-v1)" >&2
  exit 1
}
mkdir -p "$WORK/upstream" "$OUT"

# 1. Upstream, checked.
FILES="$(cut -c67- "$HERE/checksums.txt")"
for f in $FILES; do
  if [ ! -f "$WORK/upstream/$f" ]; then
    mkdir -p "$(dirname "$WORK/upstream/$f")"
    case "$f" in
      inference/transnetv2-weights/*) HOST="https://media.githubusercontent.com/media" ;;
      *) HOST="https://raw.githubusercontent.com" ;;
    esac
    curl -fsSL --retry 3 -o "$WORK/upstream/$f" "$HOST/$REPO/$REVISION/$f"
  fi
done
(cd "$WORK/upstream" && shasum -a 256 -c "$HERE/checksums.txt")

# 2. The model.
if [ ! -x "$WORK/venv/bin/python" ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv -q --python "${PYTHON:-python3.12}" "$WORK/venv"
  else
    "${PYTHON:-python3.12}" -m venv "$WORK/venv"
  fi
fi
if command -v uv >/dev/null 2>&1; then
  uv pip install -q --python "$WORK/venv/bin/python" -r "$HERE/requirements.txt"
else
  "$WORK/venv/bin/python" -m pip install -q -r "$HERE/requirements.txt"
fi
rm -rf "$WORK/model"
"$WORK/venv/bin/python" -I "$HERE/build.py" "$WORK/upstream" "$WORK/model"

# 3. Compiled.
STAGE="$WORK/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
xcrun coremlcompiler compile "$WORK/model/TransNetV2.mlpackage" "$STAGE" >/dev/null
cp "$WORK/upstream/LICENSE" "$STAGE/LICENSE"

# 4. The gate, and the helper's fixture.
"$WORK/venv/bin/python" -I "$HERE/gate.py" "$STAGE/TransNetV2.mlmodelc" "$ONNX" "$FOOTAGE" "$FFMPEG" "$FFPROBE" \
  "$WORK/gate.json" cpuAndGPU
"$WORK/venv/bin/python" -I "$HERE/fixture.py" "$ONNX" "$FIXTURE"

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
