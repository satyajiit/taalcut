#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Release build of taalcut-mac-helper (arm64, macOS 14).
# Developer ID when TAALCUT_MAC_IDENTITY is set; ad-hoc otherwise.
# Writes dist/taalcut-mac-helper and dist/BUILDINFO.json, and prints MAC_HELPER_SHA256, the helper's signature-free
# sha256, and MAC_HELPER_TOOLCHAIN, the toolchain that built it. No pin is committed: the desktop build bakes this
# digest into the app as the helper's pin, and packaging ships only this binary (apps/desktop/packaging/mac-helper.ts;
# `pnpm package` runs this script first).
#
# Nothing about the checkout or the clock goes into the binary (SPEC, "Build, signing and delivery"):
# - SwiftPM compiles the build directory's absolute path into FluidAudio's resource-bundle accessor, so the build
#   always uses one fixed directory, $SCRATCH, whatever the checkout's path, one build at a time (a lock);
# - the linker's debug map (every object file's path and modification time) is left out with -Xlinker -S (the
#   symbol table, and so crash reports' function names, stay).
# The same object files therefore link to the same bytes anywhere. Swift 6.3.3 itself doesn't compile FluidAudio
# to the same objects twice (its optimiser's output varies from run to run), so a clean rebuild gets a new digest,
# which is why each package takes its pin from the build it ships.
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$ROOT"

REVISION="503b4bd1bbf7220882de39fe8ae6716aae4132da"
IDENTITY="${TAALCUT_MAC_IDENTITY:-}"
export MACOSX_DEPLOYMENT_TARGET=14.0

if ! swift --version | grep -q 'Swift version 6.3.3'; then
  echo "error: this helper is stamped for Swift 6.3.3" >&2
  swift --version >&2 || true
  exit 1
fi
# What MAC_HELPER_TOOLCHAIN records: the compiler, Xcode and SDK the bytes came from.
SWIFTC="$(swiftc --version 2>/dev/null | grep -o 'Apple Swift version [^)]*)' | head -1)"
XCODE="$(xcodebuild -version | awk 'NR == 1 { v = $2 } /Build version/ { b = $3 } END { print "Xcode " v " (" b ")" }')"
SDK="macOS SDK $(xcrun --sdk macosx --show-sdk-version) ($(xcrun --sdk macosx --show-sdk-build-version))"
TOOLCHAIN="$SWIFTC; $XCODE; $SDK"

python3 - "$REVISION" <<'PY'
import json, sys
revision = sys.argv[1]
doc = json.load(open("Package.resolved"))
pins = [pin for pin in doc["pins"] if pin["identity"] == "fluidaudio"]
if len(pins) != 1:
    raise SystemExit("error: Package.resolved must pin fluidaudio once")
state = pins[0]["state"]
if state.get("revision") != revision or state.get("version") != "0.17.7":
    raise SystemExit(
        f"error: FluidAudio pin is {state.get('version')} {state.get('revision')}, want 0.17.7 {revision}"
    )
PY

# The fixed build directory is compiled into the binary (see above), so it is the same path on every Mac. One build
# uses it at a time; a lock whose holder has died is taken over.
SCRATCH=/private/tmp/taalcut-mac-helper-build
LOCK="$SCRATCH.lock"
waited=""
while ! mkdir "$LOCK" 2>/dev/null; do
  holder="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  [[ -n "$waited" ]] || echo "waiting for another helper build (pid ${holder:-?}) to finish with $SCRATCH" >&2
  waited=1
  sleep 2
done
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

BUILD=(swift build -c release --arch arm64 --scratch-path "$SCRATCH" -Xlinker -S)
"${BUILD[@]}"
# --show-bin-path prints the directory and does not compile.
BIN_DIR="$("${BUILD[@]}" --show-bin-path)"
SOURCE="$BIN_DIR/taalcut-mac-helper"
[[ -f "$SOURCE" ]] || { echo "error: missing $SOURCE" >&2; exit 1; }

mkdir -p "$ROOT/dist"
cp "$SOURCE" "$ROOT/dist/taalcut-mac-helper"
chmod 755 "$ROOT/dist/taalcut-mac-helper"
BINARY="$ROOT/dist/taalcut-mac-helper"

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

if otool -L "$BINARY" | grep -q NemoTextProcessing; then
  echo "error: otool shows NemoTextProcessing" >&2
  exit 1
fi
if nm "$BINARY" | grep -q NemoTextProcessing; then
  echo "error: nm shows NemoTextProcessing" >&2
  exit 1
fi
# A path of this checkout or this user in the binary would tie its bytes to them.
for path in "$ROOT" "$HOME"; do
  if LC_ALL=C grep -q -a -F -- "$path" "$BINARY"; then
    echo "error: the helper embeds $path, so its bytes would differ in another checkout" >&2
    exit 1
  fi
done

python3 - "$BINARY" "$SIGNER" "$REVISION" "$TOOLCHAIN" <<'PY'
import hashlib, json, pathlib, struct, sys

binary, signer, revision, toolchain = sys.argv[1:]
MH_MAGIC_64 = 0xFEEDFACF
HEADER_SIZE = 32
LC_SEGMENT_64 = 0x19
LC_CODE_SIGNATURE = 0x1D

def signature_free_sha256(path):
    data = bytearray(pathlib.Path(path).read_bytes())
    def digest(buf):
        return hashlib.sha256(buf).hexdigest()
    if len(data) < HEADER_SIZE or struct.unpack_from("<I", data, 0)[0] != MH_MAGIC_64:
        raise SystemExit("error: dist binary is not a thin 64-bit Mach-O")
    commands = struct.unpack_from("<I", data, 16)[0]
    end = len(data)
    offset = HEADER_SIZE
    for _ in range(commands):
        if offset + 8 > len(data):
            raise SystemExit("error: Mach-O load commands run past the end of the file")
        command, size = struct.unpack_from("<II", data, offset)
        if size < 8 or offset + size > len(data):
            raise SystemExit("error: bad Mach-O load command size")
        if command == LC_SEGMENT_64 and size >= 72:
            raw = bytes(data[offset + 8:offset + 24])
            nul = raw.find(0)
            name = raw[: len(raw) if nul < 0 else nul].decode("latin1")
            if name == "__LINKEDIT":
                data[offset + 32:offset + 40] = b"\0" * 8
                data[offset + 48:offset + 56] = b"\0" * 8
        if command == LC_CODE_SIGNATURE and size >= 16:
            end = struct.unpack_from("<I", data, offset + 8)[0]
            data[offset + 12:offset + 16] = b"\0" * 4
        offset += size
    if end > len(data):
        raise SystemExit("error: Mach-O code signature starts past the end of the file")
    return digest(data[:end])

sha256 = signature_free_sha256(binary)
doc = {
    "arch": "arm64",
    "deploymentTarget": "14.0",
    "fluidAudio": {
        "license": "Apache-2.0",
        "revision": revision,
        "url": "https://github.com/FluidInference/FluidAudio",
        "version": "0.17.7",
    },
    "identity": signer,
    "name": "taalcut-mac-helper",
    "protocol": 2,
    "signatureFreeSha256": sha256,
    "swift": "6.3.3",
    "toolchain": toolchain,
    "version": "1.0.0",
}
path = pathlib.Path("dist/BUILDINFO.json")
path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
print(f"MAC_HELPER_SHA256={sha256}")
print(f"MAC_HELPER_TOOLCHAIN={toolchain}")
PY
