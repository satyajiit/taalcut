#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# The linux-x64 FFmpeg sidecar, built here like the Mac's (build.sh), in a pinned Ubuntu 22.04 container (glibc 2.35)
# from the pins in versions.env. LGPL-2.1-or-later. FFmpeg's seven shared libraries carry the third-party code
# (static, position-independent); ffmpeg and ffprobe load them from ../lib (RPATH $ORIGIN/../lib).
#
#   tools/ffmpeg/build-linux.sh
#
# Writes dist/linux-x64/{bin/ffmpeg,bin/ffprobe,lib/<soname>,LICENSE.txt,BUILDINFO.json} (the layout @taalcut/media's
# linux-x64 target and the .deb expect) and the third-party licence texts into LICENSES/linux-x64. Sources are
# downloaded once into .build/src (TAALCUT_FFMPEG_SOURCES) and refused on a SHA-256 mismatch; the build tree is
# .build/linux-x64. The toolchain image (linux-x64.Dockerfile) is built once and named after its inputs. The build
# runs as this user with no network, capped: TAALCUT_BUILD_CPUS and JOBS (default 12, or the machine's cores when
# fewer), TAALCUT_BUILD_MEMORY (default 16g); the container is taalcut-ffmpeg-linux-<pid>, removed when it ends.
# TAALCUT_TOOLCHAIN_REBUILD=1 builds the image again without Docker's layer cache (the snapshot gives the same
# packages; BUILDINFO.json's toolchain.installed_packages_sha256 shows it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
die() { echo "error: $*" >&2; exit 1; }
[[ "$ROOT" != *[[:space:]]* ]] || die "build path contains whitespace: $ROOT"
# shellcheck disable=SC1091
source "$ROOT/versions.env"
: "${LINUX_BASE_IMAGE:?}" "${LINUX_APT_SNAPSHOT:?}" "${LINUX_APT_PACKAGES:?}"
SRC="${TAALCUT_FFMPEG_SOURCES:-$ROOT/.build/src}"
BUILD="$ROOT/.build/linux-x64"
DIST="$ROOT/dist/linux-x64"
OUT="$BUILD/out"
case "$ROOT:$SRC" in /data/* | *:/data/*) die "keep FFmpeg builds off /data" ;; esac
mkdir -p "$SRC" "$BUILD" "$DIST" "$ROOT/.build/empty-context"
CORES="$(nproc)"
CPUS="${TAALCUT_BUILD_CPUS:-$((CORES < 12 ? CORES : 12))}"
JOBS="${JOBS:-$CPUS}"

sha256_file() { sha256sum "$1" | cut -d' ' -f1; }
fetch() { # fetch <file name> <url> <sha256>
  local dest="$SRC/$1"
  if [[ -f "$dest" && "$(sha256_file "$dest")" == "$3" ]]; then return 0; fi
  echo "download $2"
  # A stalled transfer (GitHub's release CDN does that) is dropped after a minute under 1 KB/s and retried.
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 --connect-timeout 30 --speed-limit 1024 --speed-time 60 \
    --proto '=https' -o "$dest.partial" "$2"
  mv "$dest.partial" "$dest"
  [[ "$(sha256_file "$dest")" == "$3" ]] || die "SHA-256 mismatch for $2: $(sha256_file "$dest"), pinned $3"
}
echo "== sources =="
fetch "ffmpeg-${FFMPEG_VERSION}.tar.xz" "$FFMPEG_URL" "$FFMPEG_SHA256"
fetch "zlib-${ZLIB_VERSION}.tar.xz" "$ZLIB_URL" "$ZLIB_SHA256"
fetch "nv-codec-headers-${NV_CODEC_HEADERS_VERSION}.tar.gz" "$NV_CODEC_HEADERS_URL" "$NV_CODEC_HEADERS_SHA256"
fetch "vulkan-headers-${VULKAN_HEADERS_VERSION}.tar.gz" "$VULKAN_HEADERS_URL" "$VULKAN_HEADERS_SHA256"
fetch "vulkan-loader-${VULKAN_LOADER_VERSION}.tar.gz" "$VULKAN_LOADER_URL" "$VULKAN_LOADER_SHA256"
fetch "lcms2-${LCMS2_VERSION}.tar.gz" "$LCMS2_URL" "$LCMS2_SHA256"
fetch "zimg-${ZIMG_VERSION}.tar.gz" "$ZIMG_URL" "$ZIMG_SHA256"
fetch "glslang-${GLSLANG_VERSION}.tar.gz" "$GLSLANG_URL" "$GLSLANG_SHA256"
fetch "spirv-headers-${SPIRV_HEADERS_VERSION}.tar.gz" "$SPIRV_HEADERS_URL" "$SPIRV_HEADERS_SHA256"
fetch "fast_float-${FAST_FLOAT_VERSION}.tar.gz" "$FAST_FLOAT_URL" "$FAST_FLOAT_SHA256"
fetch "jinja2-${JINJA2_VERSION}.tar.gz" "$JINJA2_URL" "$JINJA2_SHA256"
fetch "markupsafe-${MARKUPSAFE_VERSION}.tar.gz" "$MARKUPSAFE_URL" "$MARKUPSAFE_SHA256"
fetch "libplacebo-${LIBPLACEBO_VERSION}.tar.gz" "$LIBPLACEBO_URL" "$LIBPLACEBO_SHA256"
fetch "openh264-${OPENH264_VERSION}.tar.gz" "$OPENH264_URL" "$OPENH264_SHA256"
fetch "dav1d-${DAV1D_VERSION}.tar.gz" "$DAV1D_URL" "$DAV1D_SHA256"
fetch "svt-av1-${SVT_AV1_VERSION}.tar.gz" "$SVT_AV1_URL" "$SVT_AV1_SHA256"
fetch "cmake-${LINUX_CMAKE_VERSION}-linux-x86_64.tar.gz" "$LINUX_CMAKE_URL" "$LINUX_CMAKE_SHA256"
fetch "meson-${LINUX_MESON_VERSION}.tar.gz" "$LINUX_MESON_URL" "$LINUX_MESON_SHA256"

# One image per set of inputs: the Dockerfile, the base digest, the snapshot and the package list.
IMAGE_KEY="$( (cat "$ROOT/linux-x64.Dockerfile"; printf '%s\n' "$LINUX_BASE_IMAGE" "$LINUX_APT_SNAPSHOT" \
  "$LINUX_APT_PACKAGES") | sha256sum | cut -c1-16)"
IMAGE="taalcut-ffmpeg-build:$IMAGE_KEY"
echo "== toolchain image $IMAGE =="
NO_CACHE=()
[[ "${TAALCUT_TOOLCHAIN_REBUILD:-0}" == 1 ]] && NO_CACHE=(--no-cache)
if [[ "${#NO_CACHE[@]}" -gt 0 ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build "${NO_CACHE[@]}" -f "$ROOT/linux-x64.Dockerfile" -t "$IMAGE" \
    --build-arg "LINUX_BASE_IMAGE=$LINUX_BASE_IMAGE" --build-arg "LINUX_APT_SNAPSHOT=$LINUX_APT_SNAPSHOT" \
    --build-arg "LINUX_APT_PACKAGES=$LINUX_APT_PACKAGES" "$ROOT/.build/empty-context" 2>&1 ||
    die "docker build of the toolchain image failed"
fi

# buildinfo.py carries the reproducibility record over when the new outputs are the bytes it describes.
if [[ -f "$DIST/BUILDINFO.json" ]]; then cp "$DIST/BUILDINFO.json" "$BUILD/BUILDINFO.previous.json"; else rm -f "$BUILD/BUILDINFO.previous.json"; fi
rm -rf "$DIST/bin" "$DIST/lib" "$DIST/LICENSE.txt" "$DIST/BUILDINFO.json"

echo "== build (container) =="
docker run --rm --name "taalcut-ffmpeg-linux-$$" \
  --cpus="$CPUS" --memory="${TAALCUT_BUILD_MEMORY:-16g}" \
  --user "$(id -u):$(id -g)" --network none \
  -e JOBS="$JOBS" -e LINUX_FFMPEG_VAAPI="${LINUX_FFMPEG_VAAPI:-0}" \
  -v "$ROOT:/taalcut-ffmpeg/tools:ro" -v "$SRC:/taalcut-ffmpeg/sources:ro" -v "$BUILD:/taalcut-ffmpeg/.build" \
  "$IMAGE" bash /taalcut-ffmpeg/tools/linux-in-container.sh

echo "== layout =="
mkdir -p "$DIST/bin" "$DIST/lib"
cp -p "$OUT/bin/ffmpeg" "$OUT/bin/ffprobe" "$DIST/bin/"
cp -p "$OUT"/lib/*.so.* "$DIST/lib/"
cp -p "$OUT/LICENSE.txt" "$DIST/LICENSE.txt"
# The texts of what is linked in, from the trees just built. INDEX.txt (kept by hand) and the GCC runtime's two texts
# (GCC's own files; the image has them only inside a Debian copyright file) are the only others, so a library that
# is no longer linked can't leave its text behind, and INDEX.txt names every file.
LICENSES="$ROOT/LICENSES/linux-x64"
mkdir -p "$LICENSES"
cp -p "$OUT"/LICENSES/* "$LICENSES/"
for file in "$LICENSES"/*; do
  name="${file##*/}"
  case "$name" in INDEX.txt | GCC-runtime-COPYING3 | GCC-runtime-COPYING.RUNTIME) continue ;; esac
  [[ -f "$OUT/LICENSES/$name" ]] || die "LICENSES/linux-x64/$name is from no library this build links; remove it"
done
for name in GCC-runtime-COPYING3 GCC-runtime-COPYING.RUNTIME $(ls "$OUT/LICENSES"); do
  [[ -f "$LICENSES/$name" ]] || die "LICENSES/linux-x64/$name is missing"
  grep -q -F "$name" "$LICENSES/INDEX.txt" 2>/dev/null || die "LICENSES/linux-x64/INDEX.txt does not list $name"
done

echo "== checks =="
# The shaders and CUDA kernels go into the libraries compressed; their uncompressed copies are checked here.
mapfile -t kernels < <(find "$OUT/check" -type f \( -name '*.spv' -o -name '*.ptx' \) | sort)
[[ "${#kernels[@]}" -gt 0 ]] || die "no compiled Vulkan shaders or CUDA kernels to check"
"$ROOT/check-paths.sh" "${kernels[@]}" >/dev/null || die "a compiled shader or kernel embeds a build path"
echo "no build paths in ${#kernels[@]} shaders and kernels"
"$ROOT/verify-linux.sh" --no-gpu "$DIST"

echo "== BUILDINFO.json =="
python3 "$ROOT/buildinfo.py" --target linux-x64 "$ROOT" "$BUILD/BUILDINFO.previous.json"
echo "build complete"
for file in "$DIST"/bin/* "$DIST"/lib/*; do echo "$(sha256_file "$file")  ${file#"$DIST"/}"; done
