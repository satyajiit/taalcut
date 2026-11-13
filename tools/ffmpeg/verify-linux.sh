#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Smoke-test the linux-x64 build (build-linux.sh), the Linux twin of verify.sh. Does not modify the build.
#
#   tools/ffmpeg/verify-linux.sh [--no-gpu] [dir]     dir defaults to tools/ffmpeg/dist/linux-x64
#
# Always: the licence (-L, -buildconf), the encoders, filters and hwaccels the app needs, the ELF files (glibc 2.35,
# RPATH, NEEDED and ldd against the allowed system libraries, no GPL library symbol or text, no build path), and the
# CPU encodes (OpenH264 160x120, SVT-AV1, dav1d decoding it back, zscale). Without --no-gpu, on this host's NVIDIA card:
# H.264, HEVC and AV1 NVENC encodes, the CUDA zero-copy graph (NVDEC, scale_cuda and transpose_cuda, h264_nvenc, no
# download), libplacebo (and its tone-map) and scale_vulkan on the system Vulkan loader, and, when the build has VA-API
# and the host an Intel or AMD render node, a VA-API upload/scale/download round trip and an h264_vaapi encode.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
GPU=1
if [[ "${1:-}" == --no-gpu ]]; then GPU=0; shift; fi
DIST="$(cd "${1:-$ROOT/dist/linux-x64}" && pwd -P)"
FF="$DIST/bin/ffmpeg"
FP="$DIST/bin/ffprobe"
LIBS=(libavcodec.so.63 libavdevice.so.63 libavfilter.so.12 libavformat.so.63 libavutil.so.61 libswresample.so.7
  libswscale.so.10)
[[ -x "$FF" && -x "$FP" ]] || { echo "missing $DIST/bin/ffmpeg or ffprobe; run build-linux.sh" >&2; exit 1; }
fail() { echo "FAIL: $*" >&2; exit 1; }
# The binaries see no inherited library path, as the app's media runner gives them none.
# SVT_LOG=1: SVT-AV1 prints errors only.
run() { env -u LD_LIBRARY_PATH -u LD_PRELOAD SVT_LOG=1 "$@"; }

echo "== 1 licence =="
licence="$(run "$FF" -hide_banner -L)"
printf '%s\n' "$licence" | head -4
grep -q 'GNU Lesser General Public' <<<"$licence" || fail "ffmpeg -L is not the LGPL"
grep -q 'version 2\.1 of the License, or' <<<"$licence" || fail "ffmpeg -L is not LGPL 2.1 or later"
if grep -q -E 'version 3 of the License|nonfree' <<<"$licence"; then fail "ffmpeg -L names version 3 or nonfree"; fi

echo "== 2 buildconf =="
conf="$(run "$FF" -hide_banner -buildconf)"
printf '%s\n' "$conf" | sed -n '2,$p' | tr -s ' ' | tr '\n' ' '; echo
for flag in --enable-gpl --enable-nonfree --enable-version3 --enable-libx264 --enable-libx265 --enable-libfdk-aac \
  --enable-chromaprint --enable-libzvbi --enable-openssl --enable-libopencore-amrnb --enable-libopencore-amrwb \
  --enable-cuda-nvcc --enable-libnpp; do
  if grep -q -x -- "\s*$flag" <<<"$conf"; then fail "-buildconf has $flag"; fi
done
for flag in --disable-gpl --disable-nonfree --disable-version3; do
  grep -q -x -- "\s*$flag" <<<"$conf" || fail "-buildconf lacks $flag"
done

listed() { awk -v n="$2" '$2==n {found=1} END {exit !found}' <<<"$1"; }
echo "== 3 encoders, filters, hwaccels =="
encoders="$(run "$FF" -hide_banner -encoders)"
for name in h264_nvenc hevc_nvenc av1_nvenc libopenh264 libsvtav1 prores_ks aac png mjpeg ffv1 flac pcm_s16le; do
  listed "$encoders" "$name" || fail "encoder $name missing"
done
decoders="$(run "$FF" -hide_banner -decoders)"
for name in libdav1d h264 hevc prores aac opus mp3 png mjpeg; do
  listed "$decoders" "$name" || fail "decoder $name missing"
done
filters="$(run "$FF" -hide_banner -filters)"
for name in libplacebo zscale scale_cuda transpose_cuda scale_vulkan tonemap hwupload_cuda lut3d ebur128; do
  listed "$filters" "$name" || fail "filter $name missing"
done
hwaccels="$(run "$FF" -hide_banner -hwaccels | sed 1d)"
for name in cuda vulkan; do grep -q -x "$name" <<<"$hwaccels" || fail "hwaccel $name missing"; done
VAAPI=0
if grep -q -x vaapi <<<"$hwaccels"; then VAAPI=1; fi
# versions.env's LINUX_FFMPEG_VAAPI=1 puts VA-API in the build, so then it has to be there.
if [[ "$(sed -n 's/^LINUX_FFMPEG_VAAPI=//p' "$ROOT/versions.env")" == 1 ]]; then
  [[ "$VAAPI" == 1 ]] || fail "hwaccel vaapi missing (versions.env: LINUX_FFMPEG_VAAPI=1)"
  for name in h264_vaapi hevc_vaapi; do listed "$encoders" "$name" || fail "encoder $name missing"; done
  listed "$filters" scale_vaapi || fail "filter scale_vaapi missing"
fi
echo "encoders, decoders and filters present; hwaccels: $(tr '\n' ' ' <<<"$hwaccels")"

echo "== 4 ELF =="
# Direct dependencies: glibc, the system Vulkan loader (libplacebo), and with VA-API the system libva. The C++ and
# GCC runtimes are static; ffnvcodec dlopens the NVIDIA driver's libraries, which are never NEEDED.
allowed='^(libc\.so\.6|libm\.so\.6|libmvec\.so\.1|libdl\.so\.2|libpthread\.so\.0|librt\.so\.1|ld-linux-x86-64\.so\.2|libvulkan\.so\.1|libva\.so\.2|libva-drm\.so\.2|libav(codec|device|filter|format|util)\.so\.[0-9]+|libsw(resample|scale)\.so\.[0-9]+)$'
gpl='(^|[^a-z])(fftw[a-z0-9]*_|vbi[0-9]*_|chromaprint_|x26[45]_|rubberband_|f0r_|vs(MotionDetect|Transform|_log_)|xvid_(global|encore|decore|plugin)|cdio_|pp_postprocess)'
files=("$FF" "$FP")
for lib in "${LIBS[@]}"; do files+=("$DIST/lib/$lib"); done
for file in "${files[@]}"; do
  name="${file#"$DIST"/}"
  [[ -f "$file" ]] || fail "$name missing"
  need="$(readelf -V --wide "$file" | grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -n 1)"
  [[ "$(printf '%s\n2.35\n' "$need" | sort -V | tail -n 1)" == 2.35 ]] || fail "$name needs glibc $need"
  dynamic="$(readelf -d "$file")"
  for lib in $(sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' <<<"$dynamic"); do
    [[ "$lib" =~ $allowed ]] || fail "$name links $lib"
  done
  rpath="$(sed -n 's/.*(RPATH).*\[\(.*\)\]/\1/p' <<<"$dynamic")"
  if grep -q RUNPATH <<<"$dynamic"; then fail "$name has a RUNPATH"; fi
  case "$name" in
    bin/*) [[ "$rpath" == '$ORIGIN/../lib' ]] || fail "$name RPATH is '${rpath}', want \$ORIGIN/../lib" ;;
    *) [[ -z "$rpath" ]] || fail "$name has RPATH $rpath" ;;
  esac
  if readelf -sW --dyn-syms "$file" | awk '{print $NF}' | grep -E "$gpl" | head -3 | grep .; then
    fail "$name has a GPL library's symbol"
  fi
  if strings -a "$file" | grep -i -E 'fftw-3|chromaprint|zvbi' | head -3 | grep .; then
    fail "$name holds a GPL library's text"
  fi
  echo "$name: glibc $need, NEEDED $(sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' <<<"$dynamic" | tr '\n' ' ')${rpath:+RPATH $rpath}"
done
echo "-- ldd bin/ffmpeg"
deps="$(run ldd "$FF")"
printf '%s\n' "$deps"
if grep -q 'not found' <<<"$deps"; then fail "ldd: a library is not found"; fi
# The RPATH gives $DIST/bin/../lib/<soname>: the same file.
for lib in "${LIBS[@]}"; do
  path="$(awk -v lib="$lib" '$1 == lib && $2 == "=>" {print $3}' <<<"$deps")"
  [[ -n "$path" && "$(realpath "$path")" == "$(realpath "$DIST/lib/$lib")" ]] ||
    fail "ldd: $lib resolves to '${path:-nothing}', not $DIST/lib"
done
# What the system brings in, transitively: glibc, the Vulkan loader, and libva with the libdrm it uses.
others="$(grep -v -F "$DIST/" <<<"$deps" | awk '{print $1}' | sed 's,.*/,,')"
for lib in $others; do
  [[ "$lib" =~ ^(linux-vdso\.so\.1|libdrm\.so\.2)$ || "$lib" =~ $allowed ]] || fail "ldd: ffmpeg loads $lib"
done
"$ROOT/check-paths.sh" "${files[@]}" >/dev/null || fail "a file embeds a build path"
echo "no build paths in ${#files[@]} files"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
probe() { run "$FP" -v error -select_streams v:0 -show_entries "stream=$2" -of csv=p=0 "$1"; }
encode() { # encode <codec> <size> <out> [options...]
  local codec="$1" size="$2" out="$3"
  shift 3
  run "$FF" -hide_banner -nostdin -v error -y -f lavfi -i "testsrc2=size=$size:rate=30:duration=1" \
    -pix_fmt yuv420p -c:v "$codec" "$@" "$out"
  local got
  got="$(probe "$out" codec_name,width,height)"
  echo "$codec $size -> $got"
  [[ "$got" == *",${size/x/,}" ]] || fail "$codec wrote $got"
}

echo "== 5 CPU =="
encode libopenh264 160x120 "$tmp/oh.mp4" -b:v 400k
[[ "$(probe "$tmp/oh.mp4" codec_name)" == h264 ]] || fail "libopenh264 did not write H.264"
encode libsvtav1 320x240 "$tmp/svt.mp4" -preset 11 -crf 40
[[ "$(probe "$tmp/svt.mp4" codec_name)" == av1 ]] || fail "libsvtav1 did not write AV1"
frames="$(run "$FF" -hide_banner -nostdin -v error -c:v libdav1d -i "$tmp/svt.mp4" -f framecrc - | grep -c -v '^#')"
echo "libdav1d decoded $frames frames"
[[ "$frames" -eq 30 ]] || fail "libdav1d decoded $frames frames, want 30"
run "$FF" -hide_banner -nostdin -v error -f lavfi -i "testsrc2=size=64x64:rate=1:duration=1" \
  -vf zscale=w=32:h=32 -frames:v 1 -f null -
echo "zscale ok"

if [[ "$GPU" == 0 ]]; then
  echo "verify ok (no GPU runs)"
  exit 0
fi

echo "== 6 NVENC =="
encode h264_nvenc 320x240 "$tmp/nv.mp4" -preset p5 -tune hq -rc vbr -b:v 2M
encode hevc_nvenc 320x240 "$tmp/hevc.mp4" -preset p5 -tune hq -rc vbr -b:v 2M -tag:v hvc1
encode av1_nvenc 320x240 "$tmp/av1.mp4" -preset p5 -b:v 2M
[[ "$(probe "$tmp/av1.mp4" codec_name)" == av1 ]] || fail "av1_nvenc did not write AV1"

echo "== 7 CUDA zero copy =="
encode h264_nvenc 1280x720 "$tmp/src.mp4" -b:v 4M
# NVDEC into CUDA frames, scaled and turned on the GPU, NVENC from CUDA frames: no hwdownload, no CPU format filter.
run "$FF" -hide_banner -nostdin -v error -y -hwaccel cuda -hwaccel_output_format cuda -i "$tmp/src.mp4" \
  -vf "scale_cuda=w=640:h=360,transpose_cuda=dir=clock" -c:v h264_nvenc -preset p2 -tune ll -b:v 2M "$tmp/zc.mp4"
got="$(probe "$tmp/zc.mp4" codec_name,width,height)"
echo "NVDEC -> scale_cuda -> transpose_cuda -> h264_nvenc: $got"
[[ "$got" == h264,360,640 ]] || fail "zero-copy graph wrote $got"

echo "== 8 Vulkan (system loader) =="
run "$FF" -hide_banner -nostdin -v error -f lavfi -i "testsrc2=size=64x64:rate=1:duration=1" \
  -vf libplacebo=w=32:h=32 -frames:v 1 -f null -
# The HDR to SDR tone-map media runs: an HLG frame to BT.709 with bt.2446a.
run "$FF" -hide_banner -nostdin -v error -f lavfi -i "testsrc2=size=128x72:rate=1:duration=1" \
  -vf "format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc,libplacebo=tonemapping=bt.2446a:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p" \
  -frames:v 1 -f null -
# Same size, another format: swscale's SPIR-V backend on the GPU (SPIRV-Headers at build time).
run "$FF" -hide_banner -nostdin -v error -init_hw_device vulkan=vk -filter_hw_device vk \
  -f lavfi -i "testsrc2=size=64x64:rate=1:duration=1" \
  -vf "format=rgba,hwupload,scale_vulkan=w=64:h=64:format=yuv444p,hwdownload,format=yuv444p" -frames:v 1 -f null -
echo "libplacebo, its tone-map and scale_vulkan ok"

echo "== 9 VA-API =="
node=""
for dev in /sys/class/drm/renderD*; do
  [[ -e "$dev/device/vendor" ]] || continue
  case "$(cat "$dev/device/vendor")" in 0x8086 | 0x1002) node="/dev/dri/${dev##*/}"; break ;; esac
done
if [[ "$VAAPI" == 0 ]]; then
  echo "not in this build"
elif [[ -z "$node" ]]; then
  echo "no Intel or AMD render node on this host: not run"
else
  run "$FF" -hide_banner -nostdin -v error -init_hw_device "vaapi=va:$node" -filter_hw_device va \
    -f lavfi -i "testsrc2=size=320x240:rate=30:duration=1" \
    -vf "format=nv12,hwupload,scale_vaapi=w=160:h=120,hwdownload,format=nv12" -f null -
  run "$FF" -hide_banner -nostdin -v error -y -init_hw_device "vaapi=va:$node" -filter_hw_device va \
    -f lavfi -i "testsrc2=size=320x240:rate=30:duration=1" -vf "format=nv12,hwupload" -c:v h264_vaapi "$tmp/va.mp4"
  got="$(probe "$tmp/va.mp4" codec_name,width,height)"
  echo "VA-API on $node: round trip ok, h264_vaapi -> $got"
  [[ "$got" == h264,320,240 ]] || fail "h264_vaapi wrote $got"
fi
echo "verify ok"
