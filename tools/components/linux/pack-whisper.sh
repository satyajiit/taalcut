#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# The linux-x64 whisper.cpp components from tools/whisper/build-linux.sh (a pinned Ubuntu 22.04 container):
#
#   tools/components/linux/pack-whisper.sh cpu whisper-server [out-dir]   # `whisper-server` (CPU): the file
#   tools/components/linux/pack-whisper.sh cpu whisper-cli    [out-dir]   # `whisper-cpp` (CPU): the file
#   tools/components/linux/pack-whisper.sh cuda whisper-server [out-dir]  # `whisper-server-cuda`: a tar.zst
#
# A build whose BUILDINFO.json names versions.env's commit and build image is reused (the CPU components share
# one); TAALCUT_WHISPER_REBUILD=1 builds again. The CPU binaries are hosted as single files like the macOS ones;
# the CUDA server, a few hundred MB of GPU code, is packed (whisper-server, LICENSE, BUILDINFO.json) so it
# downloads compressed. It needs cuda-runtime-13 on LD_LIBRARY_PATH. Prints the summary JSON last.
set -eu
LINUX_DIR="$(cd "$(dirname "$0")" && pwd -P)"
. "$LINUX_DIR/lib.sh"

VARIANT="${1:?usage: pack-whisper.sh cpu|cuda whisper-server|whisper-cli [out-dir]}"
BINARY="${2:?usage: pack-whisper.sh cpu|cuda whisper-server|whisper-cli [out-dir]}"
OUT="${3:-$CACHE/out}"
WHISPER="$ROOT/tools/whisper"
DIST="$WHISPER/dist/linux-$VARIANT"
# shellcheck disable=SC1091
. "$WHISPER/versions.env"

current() {
  [ -f "$DIST/BUILDINFO.json" ] && [ -f "$DIST/$BINARY" ] &&
    grep -q "\"commit\": \"$WHISPER_COMMIT\"" "$DIST/BUILDINFO.json" &&
    grep -q "\"image\": \"$LINUX_BUILD_IMAGE\"" "$DIST/BUILDINFO.json"
}
if [ "${TAALCUT_WHISPER_REBUILD:-}" = 1 ] || ! current; then
  bash "$WHISPER/build-linux.sh" "$VARIANT" >&2
fi
current || die "the $VARIANT build left no $BINARY"

mkdir -p "$OUT"
if [ "$VARIANT" = cpu ]; then
  cp "$DIST/$BINARY" "$OUT/$BINARY"
  chmod 755 "$OUT/$BINARY"
  printf '{"file":"%s","sha256":"%s","size":%s}\n' "$OUT/$BINARY" "$(sha256_of "$OUT/$BINARY")" "$(size_of "$OUT/$BINARY")"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$DIST/$BINARY" "$DIST/LICENSE" "$DIST/BUILDINFO.json" "$WORK/"
ARCHIVE="$OUT/$BINARY-$WHISPER_VERSION-cuda13-linux-x64.tar.zst"
EXTRACTED="$(pack_tree "$WORK" "$ARCHIVE")"
summary "$ARCHIVE" "$EXTRACTED"
