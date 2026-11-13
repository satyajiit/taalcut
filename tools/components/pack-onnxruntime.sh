#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
#
# Packs the `onnxruntime` component (packages/vision SPEC, Components): onnxruntime-node 1.30.0's
# darwin-arm64 N-API binding and runtime library, as the workspace installed them (pnpm checked the
# npm tarball's integrity), signed with the Developer ID before packing (README.md, "Releasing
# components", step 2): the app's hardened runtime loads only libraries signed by its own team.
#
#   TAALCUT_MAC_IDENTITY="Developer ID Application: …" tools/components/pack-onnxruntime.sh [out-dir]
#
# Layout inside the archive is onnxruntime-node's own (bin/napi-v6/darwin/arm64/…), so the app points
# onnxruntime-node's binding at <component>/bin (apps/desktop src/utility/component-natives.ts).
# Archive recipe as for the other components: sorted names, ustar, uid/gid 0, mode 0644, mtime 0 (UTC),
# no macOS metadata, zstd -19 -T1. The codesign timestamp differs per run, so each run is a new
# artifact: record the printed sha256, size and extractedSize in the manifest.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
IDENTITY="${TAALCUT_MAC_IDENTITY:?set TAALCUT_MAC_IDENTITY to the Developer ID Application identity}"
OUT="${1:-$ROOT/packages/vision/.cache/components}"
VERSION=1.30.0
SRC="$(cd "$ROOT/packages/vision" && node -p "require('node:path').dirname(require.resolve('onnxruntime-node/package.json'))")/bin/napi-v6/darwin/arm64"
REL=bin/napi-v6/darwin/arm64
DYLIB="libonnxruntime.$VERSION.dylib"
ARCHIVE="$OUT/onnxruntime-node-$VERSION-darwin-arm64.tar.zst"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$REL" "$OUT"
cp "$SRC/$DYLIB" "$SRC/onnxruntime_binding.node" "$STAGE/$REL/"
(cd "$STAGE/$REL" && ln -s "$DYLIB" libonnxruntime.1.dylib)

# Inside-out: the runtime library, then the binding that loads it.
for file in "$DYLIB" onnxruntime_binding.node; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$STAGE/$REL/$file"
  codesign --verify --strict "$STAGE/$REL/$file"
done

FILES="$REL/$DYLIB $REL/libonnxruntime.1.dylib $REL/onnxruntime_binding.node"
(cd "$STAGE" && for f in $FILES; do [ -L "$f" ] || chmod 0644 "$f"; TZ=UTC touch -h -t 197001010000.00 "$f"; done)
# shellcheck disable=SC2086
(cd "$STAGE" && COPYFILE_DISABLE=1 SOURCE_DATE_EPOCH=0 tar --format ustar --uid 0 --gid 0 --numeric-owner \
  --no-xattrs --no-mac-metadata --no-acls --no-fflags -cf - $FILES) | zstd -19 -T1 -q -f -o "$ARCHIVE"

SIZE="$(stat -f %z "$ARCHIVE")"
SHA="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
EXTRACTED="$(zstd -dc "$ARCHIVE" | tar -tvf - | awk '$1 !~ /^l/ {s += $5} END {print s}')"
TEAM="$(codesign -dv "$STAGE/$REL/$DYLIB" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
echo "{\"archive\":\"$ARCHIVE\",\"sha256\":\"$SHA\",\"size\":$SIZE,\"extractedSize\":$EXTRACTED,\"team\":\"$TEAM\"}"
