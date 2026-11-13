#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Smoke-test dist/ffmpeg. Does not modify dist/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
DIST="$ROOT/dist"
FF="$DIST/ffmpeg"
FP="$DIST/ffprobe"
MVK="$DIST/lib/libMoltenVK.dylib"
ICD="$DIST/lib/MoltenVK_icd.json"

[[ -x "$FF" && -x "$FP" ]] || { echo "missing dist binaries; run build.sh" >&2; exit 1; }
[[ -f "$ICD" && -f "$MVK" ]] || { echo "missing MoltenVK ICD or dylib" >&2; exit 1; }

export VK_DRIVER_FILES="$ICD"
export VK_ICD_FILENAMES="$ICD"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1 license =="
license="$("$FF" -hide_banner -L 2>&1 || true)"
printf '%s\n' "$license" | head -20
printf '%s\n' "$license" | grep -q 'Lesser General Public License' || fail "ffmpeg -L is not LGPL"
printf '%s\n' "$license" | grep -q 'version 2\.1' || fail "ffmpeg -L is not LGPL 2.1 or later"

echo "== 2 buildconf =="
conf="$("$FF" -hide_banner -buildconf 2>&1 || true)"
printf '%s\n' "$conf"
python3 - "$conf" <<'PY'
import sys
text = sys.argv[1]
bad = {"--enable-gpl", "--enable-nonfree", "--enable-libx264", "--enable-libx265", "--enable-libfdk-aac", "--enable-libopenh264"}
tokens = text.split()
hit = sorted(bad.intersection(tokens))
if hit:
    raise SystemExit("forbidden configure flags: " + " ".join(hit))
PY

echo "== 3 encoders =="
enc="$("$FF" -hide_banner -encoders)"
for name in h264_videotoolbox hevc_videotoolbox; do
  printf '%s\n' "$enc" | awk -v n="$name" '$2==n {found=1} END {exit !found}' || fail "encoder $name missing"
  echo "encoder $name"
done
if printf '%s\n' "$enc" | awk '$2=="libopenh264" {found=1} END {exit !found}'; then
  fail "macOS must not ship the source-built OpenH264 encoder"
fi
if nm -gj "$FF" "$FP" 2>/dev/null | grep 'WelsCreate' >/dev/null; then
  fail "macOS binary contains OpenH264 symbols"
fi

echo "== 4 filters =="
filters="$("$FF" -hide_banner -filters)"
for name in libplacebo zscale scale_vt transpose_vt yadif_videotoolbox \
  scale_vulkan bwdif_vulkan overlay_vulkan tonemap; do
  printf '%s\n' "$filters" | awk -v n="$name" '$2==n {found=1} END {exit !found}' || fail "filter $name missing"
  echo "filter $name"
done

echo "== 4b hwaccels =="
hw="$("$FF" -hide_banner -hwaccels)"
printf '%s\n' "$hw"
for name in videotoolbox vulkan; do
  printf '%s\n' "$hw" | grep -qx "$name" || fail "hwaccel $name missing"
  echo "hwaccel $name"
done

echo "== 4c minos =="
minos_of() { vtool -show-build "$1" | awk '/minos/ {print $2; exit}'; }
for bin in "$FF" "$FP"; do
  got="$(minos_of "$bin")"
  echo "minos $(basename "$bin") $got"
  [[ "$got" == "14.0" ]] || fail "$(basename "$bin") minos is ${got:-missing}, want 14.0"
done

echo "== 5 otool =="
check_otool() {
  local bin="$1"
  echo "-- $bin"
  otool -L "$bin"
  if otool -L "$bin" | grep -E '/opt/homebrew|/usr/local'; then
    fail "$bin references /opt/homebrew or /usr/local"
  fi
}
check_otool "$FF"
check_otool "$FP"
check_otool "$MVK"
lipo -info "$MVK" | grep -q 'architecture: arm64' || fail "MoltenVK is not a thin arm64 binary"
# A fat binary's lipo line says "Architectures in the fat file" and includes x86_64.
if lipo -info "$MVK" | grep -q x86_64; then
  fail "MoltenVK still contains x86_64"
fi

echo "== 5b build paths =="
# No /Users/, home, temp directory, checkout path or account name in what ships.
"$ROOT/check-paths.sh" "$FF" "$FP" "$MVK" "$ICD" || fail "a dist file embeds a build path"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "== 6 encode =="
encode() {
  local codec="$1" out="$2"
  shift 2
  "$FF" -hide_banner -nostdin -y \
    -f lavfi -i "testsrc=size=160x120:rate=30:duration=1" \
    -frames:v 30 -pix_fmt yuv420p \
    -c:v "$codec" "$@" \
    "$out"
  local info
  info="$("$FP" -hide_banner -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height -of csv=p=0 "$out")"
  echo "$codec -> $info"
  [[ "$info" == *",160,120" ]] || fail "$codec dimensions: $info"
}
encode h264_videotoolbox "$tmp/h264.mp4"
[[ "$("$FP" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp/h264.mp4")" == "h264" ]] || fail "h264 codec"
encode hevc_videotoolbox "$tmp/hevc.mp4"
[[ "$("$FP" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp/hevc.mp4")" == "hevc" ]] || fail "hevc codec"
encode h264_videotoolbox "$tmp/software.mp4" -allow_sw 1 -require_sw 1 -b:v 400k
[[ "$("$FP" -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$tmp/software.mp4")" == "h264" ]] || fail "VideoToolbox software H.264 codec"

echo "== 7 zscale =="
"$FF" -hide_banner -nostdin -v error \
  -f lavfi -i "testsrc=size=64x64:rate=1:duration=1" \
  -vf zscale=w=32:h=32 -frames:v 1 -f null -

echo "== 7 libplacebo =="
"$FF" -hide_banner -nostdin -v error \
  -f lavfi -i "testsrc=size=64x64:rate=1:duration=1" \
  -vf libplacebo=w=32:h=32 -frames:v 1 -f null -

echo "== 7 scale_vulkan format conversion (swscale's SPIR-V backend) =="
# Same size, another format: scale_vulkan hands that to swscale, which runs it on the GPU only when the build
# had SPIRV-Headers (build.sh). Without them this fails with "Operation not supported".
"$FF" -hide_banner -nostdin -v error \
  -init_hw_device vulkan=vk -filter_hw_device vk \
  -f lavfi -i "testsrc=size=64x64:rate=1:duration=1" \
  -vf "format=rgba,hwupload,scale_vulkan=w=64:h=64:format=yuv444p,hwdownload,format=yuv444p" \
  -frames:v 1 -f null -

echo "== 8 scale_vt =="
# scale_vt only accepts VideoToolbox frames, so feed it the H.264 just encoded.
"$FF" -hide_banner -nostdin -v error \
  -hwaccel videotoolbox -hwaccel_output_format videotoolbox_vld \
  -i "$tmp/h264.mp4" \
  -vf scale_vt=w=80:h=60 -frames:v 1 -f null -

echo "verify ok"
echo "VK_DRIVER_FILES=$VK_DRIVER_FILES"
echo "VK_ICD_FILENAMES=$VK_ICD_FILENAMES"
