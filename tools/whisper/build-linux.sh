#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# whisper-server and whisper-cli for linux-x64, CPU or CUDA, built in a pinned Ubuntu 22.04 container (glibc 2.35)
# from the same whisper.cpp tarball as build.sh (versions.env):
#
#   tools/whisper/build-linux.sh cpu|cuda
#
# Writes dist/linux-<variant>/{whisper-server,whisper-cli,LICENSE,BUILDINFO.json}. Docker runs the build as this
# user, capped (TAALCUT_BUILD_CPUS, default 12; TAALCUT_BUILD_MEMORY, default 16g; JOBS, default 12); the
# container is named taalcut-whisper-<variant>-<pid> and removed when it ends. No nvcc is needed on the host.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
VARIANT="${1:?usage: build-linux.sh cpu|cuda}"
[[ "$VARIANT" == cpu || "$VARIANT" == cuda ]] || { echo "error: cpu or cuda" >&2; exit 1; }
# shellcheck disable=SC1091
source "$ROOT/versions.env"
BUILD="$ROOT/.build/linux-$VARIANT"
DIST="$ROOT/dist/linux-$VARIANT"
mkdir -p "$BUILD" "$DIST" "$ROOT/.build"

sha256_file() { sha256sum "$1" | cut -d' ' -f1; }
fetch() {
  local url="$1" sha="$2" dest="$3"
  if [[ ! -f "$dest" ]] || [[ "$(sha256_file "$dest")" != "$sha" ]]; then
    curl -fsSL --retry 3 -o "$dest.partial" "$url"
    mv "$dest.partial" "$dest"
  fi
  [[ "$(sha256_file "$dest")" == "$sha" ]] || { echo "error: $url sha256 mismatch" >&2; exit 1; }
}
fetch "$WHISPER_URL" "$WHISPER_SHA256" "$ROOT/.build/whisper-${WHISPER_COMMIT}.tar.gz"
fetch "$LINUX_CMAKE_URL" "$LINUX_CMAKE_SHA256" "$ROOT/.build/cmake-linux-x86_64.tar.gz"
cp "$ROOT/.build/whisper-${WHISPER_COMMIT}.tar.gz" "$BUILD/whisper.tar.gz"
cp "$ROOT/.build/cmake-linux-x86_64.tar.gz" "$BUILD/cmake.tar.gz"

docker run --rm --name "taalcut-whisper-$VARIANT-$$" \
  --cpus="${TAALCUT_BUILD_CPUS:-12}" --memory="${TAALCUT_BUILD_MEMORY:-16g}" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e JOBS="${JOBS:-12}" --network none \
  -v "$ROOT:/whisper:ro" -v "$BUILD:/build" \
  "$LINUX_BUILD_IMAGE" bash /whisper/linux-in-container.sh "$VARIANT"

rm -f "$DIST"/*
cp "$BUILD/out/whisper-server" "$BUILD/out/whisper-cli" "$BUILD/out/LICENSE" "$DIST/"
chmod 755 "$DIST/whisper-server" "$DIST/whisper-cli"
# Runs on Ubuntu 22.04 and later: nothing newer than glibc 2.35, no search path, and only these libraries.
ALLOWED='^(libc\.so\.6|libm\.so\.6|libpthread\.so\.0|libdl\.so\.2|librt\.so\.1|ld-linux-x86-64\.so\.2|libcuda\.so\.1|libcudart\.so\.13|libcublas\.so\.13|libcublasLt\.so\.13)$'
for name in whisper-server whisper-cli; do
  bin="$DIST/$name"
  need="$(readelf -V --wide "$bin" | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -n 1)"
  [[ "$(printf '%s\n2.35\n' "$need" | sort -V | tail -n 1)" == 2.35 ]] || { echo "error: $name needs glibc $need" >&2; exit 1; }
  if readelf -d "$bin" | grep -qE 'RPATH|RUNPATH'; then echo "error: $name has a search path" >&2; exit 1; fi
  for lib in $(readelf -d "$bin" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'); do
    [[ "$lib" =~ $ALLOWED ]] || { echo "error: $name links $lib" >&2; exit 1; }
  done
done
SERVER_SHA="$(sha256_file "$DIST/whisper-server")"
CLI_SHA="$(sha256_file "$DIST/whisper-cli")"
cat >"$DIST/BUILDINFO.json" <<JSON
{
  "name": "whisper-server",
  "variant": "$VARIANT",
  "platform": "linux-x64",
  "version": "${WHISPER_VERSION}",
  "commit": "${WHISPER_COMMIT}",
  "image": "${LINUX_BUILD_IMAGE}",
  "cudaArchitectures": "$([[ "$VARIANT" == cuda ]] && echo "$LINUX_CUDA_ARCHITECTURES")",
  "sha256": "${SERVER_SHA}",
  "cli": { "name": "whisper-cli", "sha256": "${CLI_SHA}" }
}
JSON
echo "whisper-server ${SERVER_SHA}"
echo "whisper-cli ${CLI_SHA}"
