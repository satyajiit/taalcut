#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Runs inside LINUX_BUILD_IMAGE (build-linux.sh starts it): builds whisper-server and whisper-cli for linux-x64
# from the pinned tarball, CPU or CUDA. /whisper is this folder (read-only), /build the build tree (written).
# whisper.cpp and ggml are linked in (BUILD_SHARED_LIBS=OFF); the CUDA build links cudart and cuBLAS shared, from
# the cuda-runtime-13 component. GGML_NATIVE=OFF targets AVX2 x86-64 rather than this machine's CPU; OpenMP is
# off (ggml's own thread pool), libgcc and libstdc++ are static and no search path is written, so the binaries need
# glibc 2.35 and nothing else beyond libm, libpthread and (CUDA) the driver's libcuda.
set -euo pipefail
VARIANT="$1"
# shellcheck disable=SC1091
source /whisper/versions.env
export SOURCE_DATE_EPOCH TZ=UTC LC_ALL=C
export GIT_CEILING_DIRECTORIES=/build

rm -rf /build/src /build/work /build/out /build/cmake
mkdir -p /build/src /build/work /build/out /build/cmake
tar -xzf "/build/cmake.tar.gz" -C /build/cmake --strip-components=1
tar -xzf "/build/whisper.tar.gz" -C /build/src --strip-components=1
CMAKE=/build/cmake/bin/cmake

FLAGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DGGML_NATIVE=OFF
  -DGGML_OPENMP=OFF
  -DBUILD_SHARED_LIBS=OFF
  -DWHISPER_BUILD_TESTS=OFF
  -DWHISPER_BUILD_SERVER=ON
  -DWHISPER_BUILD_EXAMPLES=ON
  -DWHISPER_BUILD_NUMBER="$WHISPER_BUILD_NUMBER"
  -DWHISPER_BUILD_COMMIT="$WHISPER_COMMIT"
  -DCMAKE_SKIP_RPATH=ON
  "-DCMAKE_C_FLAGS=-ffile-prefix-map=/build/src=."
  "-DCMAKE_CXX_FLAGS=-ffile-prefix-map=/build/src=."
  "-DCMAKE_EXE_LINKER_FLAGS=-static-libgcc -static-libstdc++ -Wl,--build-id=none"
)
if [[ "$VARIANT" == cuda ]]; then
  # NCCL (multi-GPU) is not in cuda-runtime-13: off.
  FLAGS+=(-DGGML_CUDA=ON -DGGML_CUDA_NCCL=OFF "-DCMAKE_CUDA_ARCHITECTURES=$LINUX_CUDA_ARCHITECTURES"
    -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc)
fi
"$CMAKE" -S /build/src -B /build/work "${FLAGS[@]}"
"$CMAKE" --build /build/work --target whisper-server whisper-cli -j "${JOBS:-12}"
for name in whisper-server whisper-cli; do
  cp "/build/work/bin/$name" "/build/out/$name"
done
cp /build/src/LICENSE /build/out/LICENSE
