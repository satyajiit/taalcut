#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs ONNX Runtime 1.30.0 for linux-x64, in one of two builds:
#
#   tools/components/linux/pack-onnxruntime.sh cpu  [out-dir]   # `onnxruntime`: CPU and WebGPU
#   tools/components/linux/pack-onnxruntime.sh cuda [out-dir]   # `onnxruntime-cuda`: the same, and the CUDA provider
#
# - onnxruntime_binding.node and libonnxruntime.so.1 from the onnxruntime-node 1.30.0 npm tarball (pinned by sha256;
#   its sha512 is the integrity pnpm-lock.yaml records), unchanged.
# - The CUDA build adds libonnxruntime_providers_shared.so and libonnxruntime_providers_cuda.so from NuGet's
#   Microsoft.ML.OnnxRuntime.Gpu.Linux 1.30.0 (pinned), the package onnxruntime-node's own install script fetches
#   on Linux. They need CUDA 13 (cudart, cuBLAS/Lt, cuRAND, NVRTC, cuDNN 9): the `cuda-runtime-13` component, found
#   through LD_LIBRARY_PATH (apps/desktop acceleratorEnv). The TensorRT provider stays out: it needs TensorRT 10
#   (libnvinfer, libnvonnxparser, over a GB), which no component carries yet (plan/linux-round-1.md, "Later").
#
# Layout is onnxruntime-node's own (bin/napi-v6/linux/x64/...), so apps/desktop's component-natives.ts points the
# binding request at the same path inside the component; libonnxruntime.so.1 finds the providers beside itself.
# Prints the summary JSON last.
set -eu
LINUX_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$LINUX_DIR/lib.sh"

BUILD="${1:?usage: pack-onnxruntime.sh cpu|cuda [out-dir]}"
OUT="${2:-$CACHE/out}"
VERSION=1.30.0
NPM_URL=https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.30.0.tgz
NPM_SHA256=6e3390d6b783e7be946fad629292799da28d0b42f84856e50d2c1b0383291e75
NPM_SIZE=113507888
NUGET_URL=https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.gpu.linux/1.30.0/microsoft.ml.onnxruntime.gpu.linux.1.30.0.nupkg
NUGET_SHA256=77ca23682fc164789e67cd0fa4ce022b1b1c94e1978046c6446eee5fb0a3a3d6
NUGET_SIZE=236037232
REL=bin/napi-v6/linux/x64

case "$BUILD" in
  cpu) ARCHIVE="$OUT/onnxruntime-node-$VERSION-linux-x64.tar.zst" ;;
  cuda) ARCHIVE="$OUT/onnxruntime-node-$VERSION-cuda13-linux-x64.tar.zst" ;;
  *) die "unknown build $BUILD (cpu or cuda)" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE/$REL" "$WORK/npm"

NPM="$(fetch_pin "$NPM_URL" "$NPM_SHA256" "$NPM_SIZE")"
tar -xzf "$NPM" -C "$WORK/npm" --no-same-owner \
  "package/$REL/onnxruntime_binding.node" "package/$REL/libonnxruntime.so.1"
cp "$WORK/npm/package/$REL/onnxruntime_binding.node" "$WORK/npm/package/$REL/libonnxruntime.so.1" "$STAGE/$REL/"

if [ "$BUILD" = cuda ]; then
  NUGET="$(fetch_pin "$NUGET_URL" "$NUGET_SHA256" "$NUGET_SIZE")"
  for lib in libonnxruntime_providers_shared.so libonnxruntime_providers_cuda.so; do
    unzip -p "$NUGET" "runtimes/linux-x64/native/$lib" >"$STAGE/$REL/$lib"
    [ -s "$STAGE/$REL/$lib" ] || die "$lib is not in the NuGet package"
  done
fi

ELF="$(check_elf_tree "$STAGE" 2.35)"
EXTRACTED="$(pack_tree "$STAGE" "$ARCHIVE")"
summary "$ARCHIVE" "$EXTRACTED" "\"elfFiles\":$ELF,\"build\":\"$BUILD\""
