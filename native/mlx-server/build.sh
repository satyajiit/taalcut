#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Release build of taalcut-mlx-server (arm64, macOS 14) with xcodebuild: SwiftPM's `swift build` can't compile MLX's
# Metal shaders, xcodebuild can. Writes dist/taalcut-mlx-server, dist/mlx.metallib (MLX loads the library beside its
# binary), dist/LICENSES/ and dist/BUILDINFO.json, and with --tarball the component archive
# dist/taalcut-mlx-server-<version>-darwin-arm64.tar.zst (flat; tools/components/hosting/plan/local-llm-mlx.mjs).
# Developer ID with hardened runtime when TAALCUT_MAC_IDENTITY is set; ad hoc otherwise.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$ROOT"
VERSION="1.0.0"
IDENTITY="${TAALCUT_MAC_IDENTITY:-}"
export MACOSX_DEPLOYMENT_TARGET=14.0
# Xcode's derived data (MLX's sources and objects, ~3 GB) outside the checkout, one folder per checkout: the repo's
# source scans walk native/ (MLX1). TAALCUT_MLX_SERVER_DERIVED overrides it.
DERIVED="${TAALCUT_MLX_SERVER_DERIVED:-$HOME/Library/Caches/Taalcut-dev/mlx-server/$(printf %s "$ROOT" | shasum | cut -c1-12)}"
PRODUCTS="$DERIVED/Build/Products/Release"
mkdir -p "$(dirname "$DERIVED")"

if ! xcodebuild -version | head -1 | grep -q '^Xcode 26\.'; then
  echo "error: build with Xcode 26" >&2
  xcodebuild -version >&2 || true
  exit 1
fi

xcodebuild build \
  -scheme TaalcutMLXServer \
  -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DERIVED" \
  -skipMacroValidation -skipPackagePluginValidation \
  ONLY_ACTIVE_ARCH=YES \
  LD_RUNPATH_SEARCH_PATHS='/usr/lib/swift @executable_path' \
  >"$DERIVED.log" 2>&1 || {
  grep -E 'error:' "$DERIVED.log" | sort -u | head -40 >&2
  echo "error: xcodebuild failed; see $DERIVED.log" >&2
  exit 1
}

rm -rf dist
mkdir -p dist/LICENSES
cp "$PRODUCTS/taalcut-mlx-server" dist/
cp "$PRODUCTS/mlx-swift_Cmlx.bundle/Contents/Resources/default.metallib" dist/mlx.metallib
cp LICENSES/* dist/LICENSES/
# Swift's Span back-deployment library, weakly linked: macOS 26 and later have it in /usr/lib/swift (searched
# first); macOS 14 and 15 load this copy from beside the binary.
SPAN="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx/libswiftCompatibilitySpan.dylib"
cp "$SPAN" dist/

# Nothing but system frameworks and libraries, and that one back-deployment library.
if otool -L dist/taalcut-mlx-server | tail -n +2 | grep -v -E '^\s+(/System/Library/|/usr/lib/|@rpath/libswiftCompatibilitySpan.dylib)'; then
  echo "error: taalcut-mlx-server links a library outside the system" >&2
  exit 1
fi

for file in dist/libswiftCompatibilitySpan.dylib dist/taalcut-mlx-server; do
  if [[ -n "$IDENTITY" ]]; then
    codesign --force --options runtime --timestamp --sign "$IDENTITY" "$file"
  else
    codesign --force --sign - "$file"
  fi
  codesign --verify --strict "$file"
done

SHA="$(shasum -a 256 dist/taalcut-mlx-server | awk '{print $1}')"
python3 - "$VERSION" "$SHA" <<'PY'
import json, subprocess, sys
version, sha = sys.argv[1], sys.argv[2]
pins = {p["identity"]: p["state"] for p in json.load(open("Package.resolved"))["pins"]}
info = {
    "name": "taalcut-mlx-server",
    "version": version,
    "sha256": sha,
    "xcode": subprocess.run(["xcodebuild", "-version"], capture_output=True, text=True).stdout.split("\n")[0],
    "sdk": subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-version"], capture_output=True, text=True).stdout.strip(),
    "packages": {k: v.get("version") or v.get("revision") for k, v in sorted(pins.items())},
}
json.dump(info, open("dist/BUILDINFO.json", "w"), indent=2)
PY
echo "MLX_SERVER_SHA256=$SHA"

if [[ "${1:-}" == "--tarball" ]]; then
  # Flat (stripComponents 0), as tools/components/hosting's script recipe installs it; its last line is the JSON
  # summary that recipe reads.
  ARCHIVE="dist/taalcut-mlx-server-$VERSION-darwin-arm64.tar.zst"
  # No AppleDouble (._*) entries for the files' extended attributes, and no builder's name.
  (cd dist && COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata --no-acls --uid 0 --gid 0 --uname '' --gname '' \
    -cf - taalcut-mlx-server mlx.metallib libswiftCompatibilitySpan.dylib LICENSES BUILDINFO.json) |
    zstd -19 -T0 -q -f -o "$ARCHIVE"
  echo "{\"archive\": \"native/mlx-server/$ARCHIVE\"}"
fi
