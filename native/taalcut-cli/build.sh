#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Release build of the taalcut command-line tool (arm64, macOS 14): the MCP stdio shim and the update guard.
# Developer ID when TAALCUT_MAC_IDENTITY is set; ad-hoc otherwise. Hardened runtime, empty entitlements.
# Writes dist/taalcut and dist/BUILDINFO.json, and prints TAALCUT_CLI_SHA256, the signature-free sha256, and
# TAALCUT_CLI_TOOLCHAIN, the toolchain that built it.
#
# Nothing about the checkout or the clock goes into the binary (SPEC, "Build and packaging"), as for the mac helper:
# - the build always uses one fixed directory, $SCRATCH, whatever the checkout's path, one build at a time (a lock);
# - the linker's debug map (every object file's path and modification time) is left out with -Xlinker -S (the
#   symbol table, and so crash reports' function names, stay);
# - a binary that still contains the checkout's or the home folder's path is refused.
# So the same sources and toolchain give the same bytes before the signature in any checkout, at any time.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$ROOT"

IDENTITY="${TAALCUT_MAC_IDENTITY:-}"
export MACOSX_DEPLOYMENT_TARGET=14.0

if ! swift --version | grep -q 'Swift version 6.3.3'; then
  echo "error: the taalcut tool is stamped for Swift 6.3.3" >&2
  swift --version >&2 || true
  exit 1
fi
# What TAALCUT_CLI_TOOLCHAIN records: the compiler, Xcode and SDK the bytes came from.
SWIFTC="$(swiftc --version 2>/dev/null | grep -o 'Apple Swift version [^)]*)' | head -1)"
XCODE="$(xcodebuild -version | awk 'NR == 1 { v = $2 } /Build version/ { b = $3 } END { print "Xcode " v " (" b ")" }')"
SDK="macOS SDK $(xcrun --sdk macosx --show-sdk-version) ($(xcrun --sdk macosx --show-sdk-build-version))"
TOOLCHAIN="$SWIFTC; $XCODE; $SDK"

# One fixed build directory on every Mac, used by one build at a time; a lock whose holder has died is taken over.
SCRATCH=/private/tmp/taalcut-cli-build
LOCK="$SCRATCH.lock"
waited=""
while ! mkdir "$LOCK" 2>/dev/null; do
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  [[ -n "$waited" ]] || echo "waiting for another taalcut build (pid ${holder:-?}) to finish with $SCRATCH" >&2
  waited=1
  sleep 2
done
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

BUILD=(swift build -c release --arch arm64 --scratch-path "$SCRATCH" -Xlinker -S)
"${BUILD[@]}" --product taalcut
# --show-bin-path prints the directory and does not compile.
BIN_DIR="$("${BUILD[@]}" --show-bin-path)"
SOURCE="$BIN_DIR/taalcut"
[[ -f "$SOURCE" ]] || { echo "error: missing $SOURCE" >&2; exit 1; }

mkdir -p "$ROOT/dist"
BINARY="$ROOT/dist/taalcut"
cp "$SOURCE" "$BINARY"
chmod 755 "$BINARY"

if [[ -n "$IDENTITY" ]]; then
  codesign --force --sign "$IDENTITY" --options runtime --timestamp \
    --entitlements "$ROOT/entitlements.plist" "$BINARY"
  SIGNER="$IDENTITY"
else
  codesign --force --sign - --options runtime \
    --entitlements "$ROOT/entitlements.plist" "$BINARY"
  SIGNER="ad-hoc"
fi
codesign --verify --strict "$BINARY"

# The tool talks to 127.0.0.1 and moves files; it must never link the helper's media frameworks.
if otool -L "$BINARY" | grep -Eq 'Vision|ImageCaptureCore|AVFoundation'; then
  echo "error: otool shows a media framework in taalcut" >&2
  otool -L "$BINARY" >&2
  exit 1
fi
if ! lipo -archs "$BINARY" | grep -qx arm64; then
  echo "error: taalcut is not a thin arm64 binary" >&2
  exit 1
fi
# A path of this checkout or this user in the binary would tie its bytes to them.
for path in "$ROOT" "$HOME"; do
  if LC_ALL=C grep -q -a -F -- "$path" "$BINARY"; then
    echo "error: taalcut embeds $path, so its bytes would differ in another checkout" >&2
    exit 1
  fi
done

SHA256="$(python3 "$ROOT/scripts/signature-free-sha256.py" "$BINARY")"
VERSION="$("$BINARY" --version | awk '{print $2}')"
python3 - "$SIGNER" "$SHA256" "$VERSION" "$TOOLCHAIN" <<'PY'
import json, pathlib, sys
signer, sha256, version, toolchain = sys.argv[1:]
doc = {
    "arch": "arm64",
    "deploymentTarget": "14.0",
    "identity": signer,
    "name": "taalcut",
    "signatureFreeSha256": sha256,
    "swift": "6.3.3",
    "toolchain": toolchain,
    "version": version,
}
pathlib.Path("dist/BUILDINFO.json").write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
PY
echo "built $BINARY ($SIGNER)"
echo "TAALCUT_CLI_SHA256=$SHA256"
echo "TAALCUT_CLI_TOOLCHAIN=$TOOLCHAIN"
