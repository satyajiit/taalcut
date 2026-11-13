#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Reproducible Metal whisper-cli and whisper-server for macOS arm64 (deployment
# target 14.0). whisper-cli runs one file per process; whisper-server keeps the
# model loaded between requests (packages/audio, the persistent whisper). The
# unpacked tree is not a git repo, so the build number and commit are passed on
# the cmake line. Build trees stay under .build next to this script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$ROOT"
[[ "$ROOT" != *[[:space:]]* ]] || { echo "error: build path contains whitespace: $ROOT" >&2; exit 1; }
# shellcheck disable=SC1091
source "$ROOT/versions.env"

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH missing from versions.env}"
: "${MACOS_MIN:?MACOS_MIN missing from versions.env}"
: "${WHISPER_COMMIT:?WHISPER_COMMIT missing from versions.env}"
: "${WHISPER_SHA256:?WHISPER_SHA256 missing from versions.env}"
: "${WHISPER_URL:?WHISPER_URL missing from versions.env}"
: "${WHISPER_BUILD_NUMBER:?WHISPER_BUILD_NUMBER missing from versions.env}"

export SOURCE_DATE_EPOCH
export ZERO_AR_DATE=1
export PYTHONHASHSEED=0
export TZ=UTC
export LC_ALL=C
export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN"
export COPYFILE_DISABLE=1

BUILD="$ROOT/.build"
SRC="$BUILD/src"
WORK="$BUILD/work"
TARBALL="$BUILD/whisper-${WHISPER_COMMIT}.tar.gz"
# Stop git rev-parse inside the unpacked tree from walking into this repo.
export GIT_CEILING_DIRECTORIES="$BUILD"

mkdir -p "$BUILD" "$ROOT/dist"

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }

if [[ ! -f "$TARBALL" ]] || [[ "$(sha256_file "$TARBALL")" != "$WHISPER_SHA256" ]]; then
  curl -fsSL --retry 3 -o "$TARBALL.partial" "$WHISPER_URL"
  mv "$TARBALL.partial" "$TARBALL"
fi
[[ "$(sha256_file "$TARBALL")" == "$WHISPER_SHA256" ]] || {
  echo "error: whisper.cpp tarball sha256 mismatch" >&2
  exit 1
}

rm -rf "$SRC" "$WORK"
mkdir -p "$SRC" "$WORK"
tar -xzf "$TARBALL" -C "$SRC" --strip-components=1

cmake -S "$SRC" -B "$WORK" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN" \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=ON \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_NUMBER="$WHISPER_BUILD_NUMBER" \
  -DWHISPER_BUILD_COMMIT="$WHISPER_COMMIT"

JOBS="$(sysctl -n hw.ncpu)"
cmake --build "$WORK" --target whisper-cli whisper-server -j "$JOBS"

# Each binary is one file: whisper.cpp and ggml are linked in (BUILD_SHARED_LIBS=OFF), so nothing may be
# loaded through @rpath (a shared build points it at .build, which no Mac has). Ad-hoc signed unless a
# Developer ID is set (then hardened runtime and a secure timestamp, as for every component binary).
IDENTITY="${TAALCUT_MAC_IDENTITY:--}"
place() {
  local name="$1"
  local bin
  bin="$(find "$WORK" -type f -name "$name" -perm +111 | head -n 1)"
  [[ -n "$bin" ]] || { echo "error: $name was not produced" >&2; exit 1; }
  cp "$bin" "$ROOT/dist/$name"
  chmod 755 "$ROOT/dist/$name"
  if otool -L "$ROOT/dist/$name" | tail -n +2 | grep -q '@rpath'; then
    echo "error: $name links a shared library through @rpath" >&2
    exit 1
  fi
  if [[ "$IDENTITY" == "-" ]]; then
    codesign --force --sign - "$ROOT/dist/$name"
  else
    codesign --force --options runtime --timestamp --sign "$IDENTITY" "$ROOT/dist/$name"
  fi
}
place whisper-cli
place whisper-server

# BUILDINFO hashes the signed binaries.
CLI_SHA="$(sha256_file "$ROOT/dist/whisper-cli")"
SERVER_SHA="$(sha256_file "$ROOT/dist/whisper-server")"
cat >"$ROOT/dist/BUILDINFO.json" <<EOF
{
  "name": "whisper-cli",
  "version": "${WHISPER_VERSION}",
  "commit": "${WHISPER_COMMIT}",
  "buildNumber": "${WHISPER_BUILD_NUMBER}",
  "sha256": "${CLI_SHA}",
  "server": { "name": "whisper-server", "sha256": "${SERVER_SHA}" }
}
EOF
echo "whisper-cli ${CLI_SHA}"
echo "whisper-server ${SERVER_SHA}"
