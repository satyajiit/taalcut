#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the `cuda-runtime-13` component (linux-x64): the CUDA 13 libraries that ONNX Runtime 1.30's CUDA provider,
# llama.cpp's CUDA build and whisper.cpp's CUDA build load, from NVIDIA's redistributable archives, unchanged.
#
#   tools/components/linux/pack-cuda-runtime.sh [out-dir]
#
# - cudart 13.4.92, cuBLAS and cuBLASLt 13.8.0.4, cuRAND 10.4.4.72 and NVRTC 13.4.92 from the CUDA 13.4.3 redist,
#   cuDNN 9.27.0.42 (its cuda13 build) from the cuDNN 9.27.0 redist. Every archive is pinned by the sha256 and size
#   NVIDIA's redistrib JSON gives, and the JSON is read again to confirm the pins.
# - Shared libraries only: no static libraries, headers, stubs (a stub libcuda.so would shadow the driver), pkg-config
#   files or nvblas. Each library keeps its versioned file and its symlinks (the soname, and the plain name ORT and
#   cuDNN dlopen).
# - libcuda.so.1 is the driver's and is never shipped; CUDA 13 needs driver 580 or later (the manifest's requires).
#
# Layout: lib/ (the libraries; acceleratorEnv puts it on LD_LIBRARY_PATH), LICENSES/ (the CUDA Toolkit EULA and
# cuDNN's licence, as the archives ship them), BUILDINFO.json (what came from where). Prints the summary JSON last.
set -eu
LINUX_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$LINUX_DIR/lib.sh"

VERSION=13.4.3-cudnn9.27.0
OUT="${1:-$CACHE/out}"
ARCHIVE="$OUT/cuda-runtime-$VERSION-linux-x64.tar.zst"
CUDA_JSON=https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.4.3.json
CUDNN_JSON=https://developer.download.nvidia.com/compute/cudnn/redist/redistrib_9.27.0.json

# key json-key json-variant version relative-path sha256 size libraries (shell patterns under lib/)
PINS="cuda_cudart cuda linux-x86_64 13.4.92 cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-13.4.92-archive.tar.xz 0ac5dbc538d04e9983bc493b410cce4b459e1ee9f5f6654b6464ef7b3e14a8b5 1704640 libcudart.so*
libcublas cuda linux-x86_64 13.8.0.4 cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-13.8.0.4-archive.tar.xz bd6ffcce561672da6abb928214a6694f392741e7d1e2d7dfde0da4bd651706b6 877123136 libcublas.so*,libcublasLt.so*
libcurand cuda linux-x86_64 10.4.4.72 cuda/redist/libcurand/linux-x86_64/libcurand-linux-x86_64-10.4.4.72-archive.tar.xz 6f725f9187dc5f675308b830f786c163f5b1b499d86986f94fb60aa701c13c0b 86992868 libcurand.so*
cuda_nvrtc cuda linux-x86_64 13.4.92 cuda/redist/cuda_nvrtc/linux-x86_64/cuda_nvrtc-linux-x86_64-13.4.92-archive.tar.xz defc747cfa5953b86f4c67414fc349d21149e9d513c096cb89c64b8ec4c0c932 72311456 libnvrtc.so*,libnvrtc-builtins.so*
cudnn cudnn linux-x86_64/cuda13 9.27.0.42 cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.27.0.42_cuda13-archive.tar.xz dd3245ba3aca8593934fc946d08649ad3a5ee8500e8da3870bc23bf7ddccd7f9 937996620 libcudnn*.so*"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE/lib" "$STAGE/LICENSES" "$WORK/json"

# The pins against NVIDIA's own JSON: the archive path, sha256 and size each one names.
curl -fsSL --retry 5 -o "$WORK/json/cuda.json" "$CUDA_JSON"
curl -fsSL --retry 5 -o "$WORK/json/cudnn.json" "$CUDNN_JSON"
echo "$PINS" | while read -r key json variant version path sha size _libs; do
  node -e '
    const [file, key, variant, version, path, sha, size] = process.argv.slice(1);
    const entry = JSON.parse(require("node:fs").readFileSync(file, "utf8"))[key];
    const artifact = variant.split("/").reduce((at, part) => at?.[part], entry);
    const want = { version, path: path.replace(/^(cuda|cudnn)\/redist\//, ""), sha, size: Number(size) };
    const got = { version: entry?.version, path: artifact?.relative_path, sha: artifact?.sha256, size: Number(artifact?.size) };
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      console.error(`${key}: the pin ${JSON.stringify(want)} is not what NVIDIA lists: ${JSON.stringify(got)}`);
      process.exit(1);
    }' "$WORK/json/$json.json" "$key" "$variant" "$version" "$path" "$sha" "$size"
done

echo "$PINS" | while read -r key _json _variant version path sha size libs; do
  archive="$(fetch_pin "https://developer.download.nvidia.com/compute/$path" "$sha" "$size")"
  into="$WORK/src/$key"
  mkdir -p "$into"
  tar -xJf "$archive" -C "$into" --strip-components=1 --no-same-owner --no-same-permissions
  for pattern in $(echo "$libs" | tr ',' ' '); do
    # shellcheck disable=SC2086
    for lib in "$into"/lib/$pattern; do
      [ -e "$lib" ] || [ -L "$lib" ] || die "$key: nothing matches lib/$pattern"
      cp -P "$lib" "$STAGE/lib/"
    done
  done
  cp "$into/LICENSE" "$WORK/$key.LICENSE"
  printf '{"name":"%s","version":"%s","url":"https://developer.download.nvidia.com/compute/%s","sha256":"%s","size":%s}\n' \
    "$key" "$version" "$path" "$sha" "$size" >>"$WORK/sources.jsonl"
done

# The CUDA archives ship one licence, the CUDA Toolkit EULA (its Attachment A lists these libraries as
# redistributable); cuDNN ships its own. Each is quoted once.
for key in libcublas libcurand cuda_nvrtc; do
  cmp -s "$WORK/cuda_cudart.LICENSE" "$WORK/$key.LICENSE" || die "$key's LICENSE is not cudart's: quote it on its own"
done
cp "$WORK/cuda_cudart.LICENSE" "$STAGE/LICENSES/CUDA-Toolkit-EULA.txt"
cp "$WORK/cudnn.LICENSE" "$STAGE/LICENSES/cuDNN-LICENSE.txt"

# Every symlink resolves inside lib/, and nothing but shared libraries came along.
for link in $(find "$STAGE/lib" -type l); do
  [ -e "$link" ] || die "dangling symlink $(basename "$link")"
done
[ -z "$(find "$STAGE/lib" -name '*.a' -o -name '*stub*' -o -name 'libcuda.so*' -o -name 'libnvblas*')" ] || die "a file that must not ship"

ELF="$(check_elf_tree "$STAGE/lib" 2.35)"
# What ORT's CUDA provider links is all here (libcuda.so.1 is the driver's).
for soname in libcudart.so.13 libcublas.so.13 libcublasLt.so.13 libcurand.so.10 libnvrtc.so.13 libcudnn.so.9; do
  [ -e "$STAGE/lib/$soname" ] || die "missing $soname"
done

node -e '
  const lines = require("node:fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const info = {
    name: "cuda-runtime-13",
    version: process.argv[2],
    platform: "linux-x64",
    driver: "NVIDIA driver 580 or later (libcuda.so.1 is the driver'"'"'s, not shipped)",
    sources: lines,
  };
  require("node:fs").writeFileSync(process.argv[3], JSON.stringify(info, null, 2) + "\n");
' "$WORK/sources.jsonl" "$VERSION" "$STAGE/BUILDINFO.json"

EXTRACTED="$(pack_tree "$STAGE" "$ARCHIVE")"
summary "$ARCHIVE" "$EXTRACTED" "\"elfFiles\":$ELF"
