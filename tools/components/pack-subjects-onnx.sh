#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the `subjects-onnx` component (packages/vision SPEC, "Subjects without the helper"): RTMO-s (MMPose, COCO
# keypoints only) exported to ONNX for poses, and YOLOX-Nano (Megvii's release, unchanged) for people.
#
#   [PYTHON=python3.11] [SUBJECTS_ONNX_VENV=<venv>] tools/components/pack-subjects-onnx.sh [out-dir]
#
# 1. Fetches the pinned sources, each checked by sha256 (mmdeploy by its tag's commit): the RTMO-s COCO checkpoint,
#    mmdeploy 1.3.1, mmcv 2.1.0's sdist, YOLOX-Nano's ONNX.
# 2. A venv with the pinned subjects-onnx/requirements.txt (build tools only, none shipped), mmcv built with ops,
#    mmpose 1.3.2 without its dependencies, and mmdeploy's TorchScript extension built in place. SUBJECTS_ONNX_VENV
#    names a venv that already has these and skips the installs.
# 3. Exports RTMO-s with mmdeploy's tools/deploy.py (pose-detection_rtmo_onnxruntime_dynamic, opset 11; NMS in the
#    graph), then makes its six grouped convs dense (subjects-onnx/densify.py): onnxruntime's WebGPU provider computes
#    a grouped Conv wrongly when its channels per group aren't a multiple of 4. Both are checked against the bytes
#    first exported (a different torch or mmdeploy changes them: stop and compare the model's outputs).
# 4. Packs rtmo_s_coco.onnx and yolox_nano.onnx with the components' archive recipe (sorted names, ustar, uid/gid 0,
#    mode 0644, mtime 0 UTC, no macOS metadata, zstd -19 -T1) into out-dir (default packages/vision/.cache/components).
# Prints the archive's sha256, size and extractedSize for the manifest.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HERE="$ROOT/tools/components/subjects-onnx"
OUT="${1:-$ROOT/packages/vision/.cache/components}"
WORK="$ROOT/packages/vision/.cache/subjects-onnx-build"
NAME=subjects-onnx-rtmo-s-coco-yolox-nano
ARCHIVE="$OUT/$NAME.tar.zst"

CHECKPOINT=rtmo-s_8xb32-600e_coco-640x640-8db55a59_20231211.pth
CHECKPOINT_URL="https://download.openmmlab.com/mmpose/v1/projects/rtmo/$CHECKPOINT"
CHECKPOINT_SHA=8db55a5974d4d31164cc327805c57932cc7b4f79874b5e5bfbbfa32a7d4e5b05
MMCV_URL=https://files.pythonhosted.org/packages/a7/19/f97f0fd4d432113a232e75f965335be6b7bb6557ae9faf8051e9a012cadd/mmcv-2.1.0.tar.gz
MMCV_SHA=d387bcab66b467479b6660310e23746cfc79c6e57acf04094680adb499a5cd3f
MMDEPLOY_REPO=https://github.com/open-mmlab/mmdeploy.git
MMDEPLOY_COMMIT=bc75c9d6c8940aa03d0e1e5b5962bd930478ba77
# deploy.py runs the model once on an image: upstream's own test image, as the first export did.
IMAGE_URL=https://raw.githubusercontent.com/open-mmlab/mmpose/v1.3.2/tests/data/coco/000000197388.jpg
IMAGE_SHA=dec0fbb931cb609bf481e56b89cd2fbbab79839f22832c3bbe69a8fae2769cdd
YOLOX_URL=https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx
YOLOX_SHA=c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d
EXPORT_SHA=4b5d3e663769effa29df3538f29f66584135f662031109ddd6794b738ebf11c7
DENSE_SHA=191f8f2c87dddbb875102b61cf788ec3810a570efc40595f743220aae72adc83
# mmcv 2.1 and torch 2.1's headers under a newer clang.
FLAGS=-Wno-invalid-specialization

fetch() { # url sha256 file
  if [ ! -f "$3" ] || [ "$(shasum -a 256 "$3" | cut -d' ' -f1)" != "$2" ]; then
    curl -fsSL --retry 3 -o "$3.part" "$1"
    mv "$3.part" "$3"
  fi
  [ "$(shasum -a 256 "$3" | cut -d' ' -f1)" = "$2" ] || {
    echo "error: $1 is not the pinned file ($2)" >&2
    exit 1
  }
}
checked() { # file sha256 what
  [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$2" ] || {
    echo "error: $3 differs from the pinned bytes ($2): compare the model's outputs before taking it" >&2
    exit 1
  }
}

# 1. Sources.
mkdir -p "$WORK/upstream" "$OUT"
fetch "$CHECKPOINT_URL" "$CHECKPOINT_SHA" "$WORK/upstream/$CHECKPOINT"
fetch "$YOLOX_URL" "$YOLOX_SHA" "$WORK/upstream/yolox_nano.onnx"
fetch "$IMAGE_URL" "$IMAGE_SHA" "$WORK/upstream/000000197388.jpg"
if [ "$(git -C "$WORK/mmdeploy" rev-parse HEAD 2>/dev/null || true)" != "$MMDEPLOY_COMMIT" ]; then
  rm -rf "$WORK/mmdeploy"
  git -c advice.detachedHead=false clone -q --depth 1 --branch v1.3.1 "$MMDEPLOY_REPO" "$WORK/mmdeploy"
  [ "$(git -C "$WORK/mmdeploy" rev-parse HEAD)" = "$MMDEPLOY_COMMIT" ] || {
    echo "error: mmdeploy v1.3.1 is not commit $MMDEPLOY_COMMIT" >&2
    exit 1
  }
fi

# 2. The venv.
if [ -n "${SUBJECTS_ONNX_VENV:-}" ]; then
  PY="$SUBJECTS_ONNX_VENV/bin/python"
else
  PY="$WORK/venv/bin/python"
  if [ ! -x "$PY" ]; then
    if command -v uv >/dev/null 2>&1; then
      uv venv -q --python "${PYTHON:-python3.11}" "$WORK/venv"
    else
      "${PYTHON:-python3.11}" -m venv "$WORK/venv"
    fi
  fi
  if command -v uv >/dev/null 2>&1; then
    PIP="uv pip install -q --python $PY"
  else
    PIP="$PY -m pip install -q"
  fi
  $PIP -r "$HERE/requirements.txt"
  if ! "$PY" -c "import mmcv.ops" 2>/dev/null; then
    fetch "$MMCV_URL" "$MMCV_SHA" "$WORK/upstream/mmcv-2.1.0.tar.gz"
    rm -rf "$WORK/mmcv-2.1.0"
    tar -xzf "$WORK/upstream/mmcv-2.1.0.tar.gz" -C "$WORK"
    MMCV_WITH_OPS=1 CFLAGS="$FLAGS" CXXFLAGS="$FLAGS" $PIP --no-build-isolation "$WORK/mmcv-2.1.0"
  fi
  $PIP --no-deps mmpose==1.3.2
fi
if ! (cd "$WORK/mmdeploy" && "$PY" -c "from mmdeploy.backend.torchscript import ts_optimizer" 2>/dev/null); then
  (cd "$WORK/mmdeploy" && CFLAGS="$FLAGS" CXXFLAGS="$FLAGS" "$PY" setup.py -q build_ext --inplace >/dev/null)
fi

# 3. The export.
CONFIG="$("$PY" -c "import mmpose, os; print(os.path.join(os.path.dirname(mmpose.__file__), '.mim/configs/body_2d_keypoint/rtmo/coco/rtmo-s_8xb32-600e_coco-640x640.py'))")"
rm -rf "$WORK/export"
mkdir -p "$WORK/export"
(cd "$WORK/mmdeploy" && PYTHONPATH="$WORK/mmdeploy" "$PY" tools/deploy.py \
  configs/mmpose/pose-detection_rtmo_onnxruntime_dynamic.py "$CONFIG" "$WORK/upstream/$CHECKPOINT" \
  "$WORK/upstream/000000197388.jpg" --work-dir "$WORK/export" --device cpu >"$WORK/export.log" 2>&1) || {
  tail -20 "$WORK/export.log" >&2
  exit 1
}
checked "$WORK/export/end2end.onnx" "$EXPORT_SHA" "the RTMO-s export"
STAGE="$WORK/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
"$PY" -I "$HERE/densify.py" "$WORK/export/end2end.onnx" "$STAGE/rtmo_s_coco.onnx"
checked "$STAGE/rtmo_s_coco.onnx" "$DENSE_SHA" "the dense RTMO-s"
cp "$WORK/upstream/yolox_nano.onnx" "$STAGE/yolox_nano.onnx"

# 4. Packed.
(cd "$STAGE" && chmod 0644 ./*.onnx && TZ=UTC touch -h -t 197001010000.00 . ./*.onnx)
(cd "$STAGE" && COPYFILE_DISABLE=1 SOURCE_DATE_EPOCH=0 tar --format ustar --uid 0 --gid 0 --numeric-owner \
  --no-xattrs --no-mac-metadata --no-acls --no-fflags -cf - rtmo_s_coco.onnx yolox_nano.onnx) |
  zstd -19 -T1 -q -f -o "$ARCHIVE"
SIZE="$(stat -f %z "$ARCHIVE")"
SHA="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
EXTRACTED="$(zstd -dc "$ARCHIVE" | tar -tvf - | awk '$1 !~ /^l/ {s += $5} END {print s}')"
echo "{\"archive\":\"$ARCHIVE\",\"sha256\":\"$SHA\",\"size\":$SIZE,\"extractedSize\":$EXTRACTED}"
