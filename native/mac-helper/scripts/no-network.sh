#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Every helper method under sandbox-exec with the network denied.
# The profile allows the default so Vision and ImageIO still run.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"
export MACOSX_DEPLOYMENT_TARGET=14.0

# --show-bin-path prints the directory and does not compile.
swift build --arch arm64
BIN_DIR="$(swift build --arch arm64 --show-bin-path)"
HELPER="$BIN_DIR/taalcut-mac-helper"
[[ -x "$HELPER" ]] || { echo "error: missing $HELPER" >&2; exit 1; }

PROFILE="$(mktemp)"
WORK="$(mktemp -d)"
cleanup() {
  rm -f "$PROFILE"
  rm -rf "$WORK"
}
trap cleanup EXIT

cat > "$PROFILE" <<'EOF'
(version 1)
(allow default)
(deny network*)
EOF

python3 - "$HELPER" "$PROFILE" "$WORK" <<'PY'
import json, os, struct, subprocess, sys, zlib

helper, profile, work = sys.argv[1:]

def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

def write_png(path):
    width, height = 64, 64
    pixel = b"\xff\xff\xff"
    raw = b"".join(b"\x00" + pixel * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)

def die(message):
    print(message, file=sys.stderr)
    sys.exit(1)

def sandboxed(args, lines, timeout=90):
    return subprocess.run(
        ["sandbox-exec", "-f", profile, helper, *args],
        input="".join(line + "\n" for line in lines),
        text=True,
        capture_output=True,
        timeout=timeout,
    )

def messages(stdout):
    parsed = []
    for line in stdout.splitlines():
        text = line.strip()
        if text:
            parsed.append(json.loads(text))
    return parsed

def request(identity, method, params):
    return json.dumps({"id": identity, "type": "request", "method": method, "params": params})

version = sandboxed(["--version"], [])
if version.returncode != 0:
    die(f"--version exit {version.returncode}: {version.stderr}")
body = messages(version.stdout)
if len(body) != 1 or body[0].get("protocol") != 2 or body[0].get("version") != "1.0.0":
    die(f"--version output: {version.stdout!r}")

png = os.path.join(work, "dot.png")
write_png(png)
outside = "/no/such/taalcut-outside.png"
ocr = sandboxed(
    ["serve", "--services", "ocr,image", "--allow-root", work],
    [
        request("lang", "ocr.languages", {}),
        request("out", "ocr.recognize", {"paths": [outside]}),
        request("img", "ocr.recognize", {"paths": [png]}),
        request("still", "image.properties", {"path": png}),
    ],
)
if ocr.returncode != 0:
    die(f"ocr serve exit {ocr.returncode}\n{ocr.stderr}\n{ocr.stdout}")
ocr_messages = messages(ocr.stdout)
if not ocr_messages or ocr_messages[0].get("type") != "ready":
    die(f"ocr ready missing: {ocr.stdout!r}")
by_id = {item["id"]: item for item in ocr_messages if item.get("type") == "response"}
if not by_id.get("lang", {}).get("ok"):
    die(f"ocr.languages: {by_id.get('lang')}")
outside_error = (by_id.get("out") or {}).get("error") or {}
if outside_error.get("code") != "helper.path_not_allowed":
    die(f"outside path: {by_id.get('out')}")
if not by_id.get("img", {}).get("ok"):
    die(f"ocr.recognize: {by_id.get('img')}")
still = by_id.get("still") or {}
if not still.get("ok") or (still.get("result") or {}).get("width") != 64:
    die(f"image.properties: {still}")

missing = os.path.join(work, "missing-models")
asr = sandboxed(
    ["serve", "--services", "asr", "--models", missing, "--allow-root", work],
    [
        request("tr", "asr.transcribe", {"path": png}),
        request("load", "asr.load", {"version": "v3", "encoderPrecision": "int8"}),
    ],
)
if asr.returncode != 0:
    die(f"asr serve exit {asr.returncode}\n{asr.stderr}\n{asr.stdout}")
asr_messages = messages(asr.stdout)
if not asr_messages or asr_messages[0].get("type") != "ready":
    die(f"asr ready missing: {asr.stdout!r}")
asr_by_id = {item["id"]: item for item in asr_messages if item.get("type") == "response"}
transcribe_error = (asr_by_id.get("tr") or {}).get("error") or {}
if transcribe_error.get("code") != "asr.not_loaded":
    die(f"asr.transcribe: {asr_by_id.get('tr')}")
load_error = (asr_by_id.get("load") or {}).get("error") or {}
if load_error.get("code") != "asr.model_missing":
    die(f"asr.load: {asr_by_id.get('load')}")

devices = sandboxed(
    ["serve", "--services", "devices", "--idle-exit", "0", "--allow-root", work],
    [
        request("start", "devices.start", {}),
        request("missing", "devices.list", {"handle": "missing-handle"}),
    ],
    timeout=30,
)
if devices.returncode != 0:
    die(f"devices serve exit {devices.returncode}\n{devices.stderr}\n{devices.stdout}")
devices_messages = messages(devices.stdout)
ready = devices_messages[0] if devices_messages else {}
if ready.get("type") != "ready" or (ready.get("serviceVersions") or {}).get("devices") != 1:
    die(f"devices ready: {devices.stdout!r}")
devices_by_id = {item["id"]: item for item in devices_messages if item.get("type") == "response"}
if not devices_by_id.get("start", {}).get("ok"):
    die(f"devices.start: {devices_by_id.get('start')}")
missing_device = (devices_by_id.get("missing") or {}).get("error") or {}
if missing_device.get("code") != "devices.not_found":
    die(f"devices.list: {devices_by_id.get('missing')}")

track = sandboxed(
    ["serve", "--services", "track", "--allow-root", work],
    [request("shot", "track.shot", {
        "path": os.path.join(work, "missing.mov"),
        "start": {"value": 0, "rate": 1},
        "end": {"value": 1, "rate": 1},
    })],
)
if track.returncode != 0:
    die(f"track serve exit {track.returncode}\n{track.stderr}\n{track.stdout}")
track_by_id = {item["id"]: item for item in messages(track.stdout) if item.get("type") == "response"}
track_error = (track_by_id.get("shot") or {}).get("error") or {}
if track_error.get("code") != "track.unreadable":
    die(f"track.shot: {track_by_id.get('shot')}")

cube_path = os.path.join(work, "bad.cube")
open(cube_path, "w").write("LUT_3D_SIZE 2\n")
grade = sandboxed(
    ["serve", "--services", "grade", "--allow-root", work],
    [request("cube", "video.applyCube", {
        "input": os.path.join(work, "missing.mov"),
        "output": os.path.join(work, "out.mov"),
        "cube": cube_path,
        "colourSpace": "bt709",
    })],
)
if grade.returncode != 0:
    die(f"grade serve exit {grade.returncode}\n{grade.stderr}\n{grade.stdout}")
grade_by_id = {item["id"]: item for item in messages(grade.stdout) if item.get("type") == "response"}
grade_error = (grade_by_id.get("cube") or {}).get("error") or {}
if grade_error.get("code") != "grade.cube_invalid":
    die(f"video.applyCube: {grade_by_id.get('cube')}")

import shutil
font_src = next((
    path for path in (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Geneva.ttf",
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    ) if os.path.isfile(path)
), None)
if font_src:
    font = os.path.join(work, "face.ttf")
    shutil.copy(font_src, font)
    rendered = os.path.join(work, "glyph.png")
    text = sandboxed(
        ["serve", "--services", "ocr", "--allow-root", work],
        [request("txt", "text.render", {
            "string": "Ag",
            "fontFile": font,
            "pixelHeight": 48,
            "polarity": "darkOnLight",
            "output": rendered,
        })],
    )
    if text.returncode != 0:
        die(f"text serve exit {text.returncode}\n{text.stderr}\n{text.stdout}")
    text_by_id = {item["id"]: item for item in messages(text.stdout) if item.get("type") == "response"}
    if not text_by_id.get("txt", {}).get("ok"):
        die(f"text.render: {text_by_id.get('txt')}")
print("no-network: ok")
PY
