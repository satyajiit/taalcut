#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Runs inside the toolchain image build-linux.sh makes (linux-x64.Dockerfile), with no network. Builds the third-party
# libraries static and position-independent into a private prefix, then FFmpeg's seven shared libraries and the
# ffmpeg and ffprobe that load them from ../lib. The paths are fixed, whatever the host checkout:
#
#   /taalcut-ffmpeg/tools    tools/ffmpeg, read-only (this script, versions.env)
#   /taalcut-ffmpeg/sources  the pinned tarballs, read-only (build-linux.sh checked their SHA-256)
#   /taalcut-ffmpeg/.build   the build tree, written: prefix/, work/, bin/, then out/ for build-linux.sh to check
#
# FFmpeg is LGPL-2.1-or-later (--disable-gpl --disable-nonfree --disable-version3). --disable-autodetect keeps every
# library the image happens to hold out of it; what it links is enabled by name below. Its own codecs, formats,
# protocols and filters are all on, as on the Mac (CONFIGURE_FLAGS.md, Linux x64).
set -euo pipefail

# shellcheck disable=SC1091
source /taalcut-ffmpeg/tools/versions.env
SOURCES=/taalcut-ffmpeg/sources
BUILD=/taalcut-ffmpeg/.build
PREFIX="$BUILD/prefix"
WORK="$BUILD/work"
OUT="$BUILD/out"
JOBS="${JOBS:-12}"

export SOURCE_DATE_EPOCH PYTHONHASHSEED=0 TZ=UTC LC_ALL=C
export GIT_CEILING_DIRECTORIES="$BUILD"
export HOME=/tmp
rm -rf "$PREFIX" "$WORK" "$OUT" "$BUILD/bin" "$BUILD/tools"
mkdir -p "$PREFIX/lib/pkgconfig" "$WORK" "$OUT/bin" "$OUT/lib" "$OUT/LICENSES" "$OUT/check" "$BUILD/bin" "$BUILD/tools"
export PATH="$BUILD/bin:/usr/bin:/bin"

export CC=gcc CXX=g++ AR=ar NM=nm RANLIB=ranlib STRIP=strip
export PKG_CONFIG=pkg-config
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
# Everything below ends up inside a shared library, so it is position-independent. No -march: x86-64 baseline, and
# each library picks its SIMD at run time.
export CFLAGS="-O2 -fPIC -I$PREFIX/include"
export CXXFLAGS="-O2 -fPIC -I$PREFIX/include"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"

die() { echo "error: $*" >&2; exit 1; }
unpack() { # unpack <tarball> <name>: a clean work/<name> holding the tarball's single top directory
  local dir="$WORK/$2"
  rm -rf "$dir" && mkdir -p "$dir"
  tar -xf "$SOURCES/$1" -C "$dir" --strip-components=1
  printf '%s\n' "$dir"
}
licence() { cp "$1" "$OUT/LICENSES/$2"; }

echo "== tools =="
mkdir -p "$BUILD/tools/cmake" "$BUILD/tools/meson"
tar -xzf "$SOURCES/cmake-${LINUX_CMAKE_VERSION}-linux-x86_64.tar.gz" -C "$BUILD/tools/cmake" --strip-components=1
tar -xzf "$SOURCES/meson-${LINUX_MESON_VERSION}.tar.gz" -C "$BUILD/tools/meson" --strip-components=1
ln -s "$BUILD/tools/cmake/bin/cmake" "$BUILD/bin/cmake"
printf '#!/bin/sh\nexec python3 %s/tools/meson/meson.py "$@"\n' "$BUILD" >"$BUILD/bin/meson"
chmod +x "$BUILD/bin/meson"
gcc --version | head -1; g++ --version | head -1; clang-14 --version | head -1; nasm -v
echo "cmake $(cmake --version | head -1 | awk '{print $3}'), meson $(meson --version), ninja $(ninja --version)"
echo "pkg-config $(pkg-config --version), python $(python3 --version | awk '{print $2}')"

cmake_common=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX="$PREFIX"
  -DCMAKE_INSTALL_LIBDIR=lib
  -DCMAKE_PREFIX_PATH="$PREFIX"
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON
  -DBUILD_SHARED_LIBS=OFF
)
meson_common=(--prefix="$PREFIX" --libdir=lib --buildtype=release --default-library=static -Db_staticpic=true)

echo "== zlib =="
ZL="$(unpack "zlib-${ZLIB_VERSION}.tar.xz" zlib)"
(cd "$ZL" && ./configure --prefix="$PREFIX" --static && make -j "$JOBS" libz.a && make install)
licence "$ZL/LICENSE" zlib-LICENSE

echo "== nv-codec-headers =="
NV="$(unpack "nv-codec-headers-${NV_CODEC_HEADERS_VERSION}.tar.gz" nv-codec-headers)"
make -C "$NV" PREFIX="$PREFIX" LIBDIR=lib install
# No licence file in the tarball: each header carries its MIT notice. The two that differ, verbatim.
for header in nvEncodeAPI.h dynlink_loader.h; do
  awk 'NR==1 && !/^\/\*/ {exit} {print} /\*\// {exit}' "$NV/include/ffnvcodec/$header" \
    >"$OUT/LICENSES/nv-codec-headers-$header-notice.txt"
  grep -q 'Permission is hereby granted' "$OUT/LICENSES/nv-codec-headers-$header-notice.txt" ||
    die "no MIT notice at the top of $header"
done

echo "== vulkan-headers =="
VH="$(unpack "vulkan-headers-${VULKAN_HEADERS_VERSION}.tar.gz" vulkan-headers)"
cmake -S "$VH" -B "$VH/build" "${cmake_common[@]}"
cmake --install "$VH/build"
licence "$VH/LICENSE.md" Vulkan-Headers-LICENSE.md
licence "$VH/LICENSES/Apache-2.0.txt" Vulkan-Headers-Apache-2.0.txt
licence "$VH/LICENSES/MIT.txt" Vulkan-Headers-MIT.txt

# Only to link against: libplacebo calls vkGetInstanceProcAddr, so libavfilter needs libvulkan.so.1, the system
# loader (Ubuntu's libvulkan1) at run time. This build of it is not shipped; WSI is off because nothing here draws.
echo "== vulkan-loader (to link against, not shipped) =="
VL="$(unpack "vulkan-loader-${VULKAN_LOADER_VERSION}.tar.gz" vulkan-loader)"
cmake -S "$VL" -B "$VL/build" "${cmake_common[@]}" -DBUILD_SHARED_LIBS=ON -DBUILD_TESTS=OFF -DUPDATE_DEPS=OFF \
  -DBUILD_WSI_XCB_SUPPORT=OFF -DBUILD_WSI_XLIB_SUPPORT=OFF -DBUILD_WSI_WAYLAND_SUPPORT=OFF \
  -DBUILD_WSI_DIRECTFB_SUPPORT=OFF -DSYSCONFDIR=/etc -DVULKAN_HEADERS_INSTALL_DIR="$PREFIX"
cmake --build "$VL/build" -j "$JOBS"
cmake --install "$VL/build"
[[ "$(readelf -d "$PREFIX/lib/libvulkan.so" | sed -n 's/.*(SONAME).*\[\(.*\)\]/\1/p')" == libvulkan.so.1 ]] ||
  die "the loader's soname is not libvulkan.so.1"

echo "== lcms2 =="
LC="$(unpack "lcms2-${LCMS2_VERSION}.tar.gz" lcms2)"
# The GPL-3 plugins under plugins/ are not configured or built.
(cd "$LC" && ./configure --prefix="$PREFIX" --enable-static --disable-shared --with-pic --without-jpeg \
  --without-tiff --disable-dependency-tracking && make -j "$JOBS" && make install)
licence "$LC/LICENSE" lcms2-LICENSE

echo "== zimg =="
ZI="$(unpack "zimg-${ZIMG_VERSION}.tar.gz" zimg)"
(cd "$ZI" && ./autogen.sh && ./configure --prefix="$PREFIX" --enable-static --disable-shared --with-pic \
  --disable-dependency-tracking && make -j "$JOBS" && make install)
licence "$ZI/COPYING" zimg-COPYING

# The static libraries libplacebo links, and the glslang binary FFmpeg compiles its Vulkan shaders with (--glslc).
echo "== glslang =="
GL="$(unpack "glslang-${GLSLANG_VERSION}.tar.gz" glslang)"
cmake -S "$GL" -B "$GL/build" "${cmake_common[@]}" -DENABLE_OPT=OFF -DENABLE_GLSLANG_BINARIES=ON \
  -DGLSLANG_TESTS=OFF -DENABLE_PCH=OFF -DBUILD_EXTERNAL=OFF -DALLOW_EXTERNAL_SPIRV_TOOLS=OFF
cmake --build "$GL/build" -j "$JOBS"
cmake --install "$GL/build"
licence "$GL/LICENSE.txt" glslang-LICENSE.txt
[[ -x "$PREFIX/bin/glslang" ]] || die "the glslang binary was not built"
ln -sfn "$PREFIX/bin/glslang" "$BUILD/bin/glslang"
[[ "$(command -v glslang)" == "$BUILD/bin/glslang" ]] || die "glslang on PATH is not the pinned build"

echo "== SPIRV-Headers =="
SH="$(unpack "spirv-headers-${SPIRV_HEADERS_VERSION}.tar.gz" spirv-headers)"
cmake -S "$SH" -B "$SH/build" "${cmake_common[@]}" -DSPIRV_HEADERS_ENABLE_TESTS=OFF -DSPIRV_HEADERS_ENABLE_INSTALL=ON
cmake --install "$SH/build"
licence "$SH/LICENSE" SPIRV-Headers-LICENSE
licence "$SH/LICENSES/MIT.txt" SPIRV-Headers-MIT.txt

echo "== libplacebo =="
FF_FLOAT="$(unpack "fast_float-${FAST_FLOAT_VERSION}.tar.gz" fast_float)"
JI="$(unpack "jinja2-${JINJA2_VERSION}.tar.gz" jinja2)"
MS="$(unpack "markupsafe-${MARKUPSAFE_VERSION}.tar.gz" markupsafe)"
LP="$(unpack "libplacebo-${LIBPLACEBO_VERSION}.tar.gz" libplacebo)"
# The tag archive has empty submodule folders: the pinned fast_float headers, Jinja and MarkupSafe (build-time only)
# go where libplacebo looks, and the empty Vulkan-Headers folder goes so Meson takes the prefix's headers and vk.xml.
rm -rf "$LP/3rdparty/fast_float" "$LP/3rdparty/jinja" "$LP/3rdparty/markupsafe" "$LP/3rdparty/Vulkan-Headers"
mkdir -p "$LP/3rdparty/fast_float" "$LP/3rdparty/jinja" "$LP/3rdparty/markupsafe"
cp -R "$FF_FLOAT/include" "$LP/3rdparty/fast_float/include"
cp -R "$JI/src" "$LP/3rdparty/jinja/src"
cp -R "$MS/src" "$LP/3rdparty/markupsafe/src"
licence "$FF_FLOAT/LICENSE-APACHE" fast_float-LICENSE-APACHE
licence "$FF_FLOAT/LICENSE-BOOST" fast_float-LICENSE-BOOST
licence "$FF_FLOAT/LICENSE-MIT" fast_float-LICENSE-MIT
# The same find_library fix as build.sh (CONFIGURE_FLAGS.md, adjustment 3): glslang in the private prefix.
python3 - "$LP/src/glsl/meson.build" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "cxx.find_library('glslang', required: required, static: static)"
if old not in t:
    raise SystemExit("glslang find_library pattern missing")
t = t.replace(old, "cxx.find_library('glslang', required: required, static: static, dirs: vulkan_lib_dirs)", 1)
old = "cxx.find_library('glslang-default-resource-limits', required: false)"
new = "cxx.find_library('glslang-default-resource-limits', required: false, static: true, dirs: vulkan_lib_dirs)"
needle = "  if vulkan_sdk != ''\n    vulkan_lib_dirs += [vulkan_sdk / 'lib']\n  endif\n"
if old not in t or needle not in t:
    raise SystemExit("resource-limits find_library or vulkan_lib_dirs pattern missing")
t = t.replace(old + "\n", "", 1).replace(needle, needle + "  glslang_deps += " + new + "\n", 1)
p.write_text(t)
PY
meson setup "$LP/build" "$LP" "${meson_common[@]}" -Dprefer_static=true \
  -Dlcms=enabled -Dvulkan=enabled -Dvulkan-registry="$PREFIX/share/vulkan/registry/vk.xml" \
  -Dvulkan-sdk="$PREFIX" -Dvk-proc-addr=enabled -Dshaderc=disabled -Dglslang=enabled \
  -Dopengl=disabled -Dgl-proc-addr=disabled -Dd3d11=disabled -Ddemos=false -Dtests=false -Dbench=false \
  -Ddovi=enabled -Dlibdovi=disabled -Dxxhash=disabled -Dunwind=disabled
meson compile -C "$LP/build" -j "$JOBS"
meson install -C "$LP/build"
licence "$LP/LICENSE" libplacebo-LICENSE

echo "== openh264 =="
OH="$(unpack "openh264-${OPENH264_VERSION}.tar.gz" openh264)"
make -C "$OH" -j "$JOBS" OS=linux ARCH=x86_64 PREFIX="$PREFIX" BUILDTYPE=Release install-static
licence "$OH/LICENSE" OpenH264-LICENSE

echo "== dav1d =="
DV="$(unpack "dav1d-${DAV1D_VERSION}.tar.gz" dav1d)"
meson setup "$DV/build" "$DV" "${meson_common[@]}" -Denable_tools=false -Denable_tests=false
meson compile -C "$DV/build" -j "$JOBS"
meson install -C "$DV/build"
licence "$DV/COPYING" dav1d-COPYING

echo "== SVT-AV1 =="
SV="$(unpack "svt-av1-${SVT_AV1_VERSION}.tar.gz" svt-av1)"
# EXCLUDE_HASH: no git hash, and REPRODUCIBLE_BUILDS (no __DATE__/__TIME__). No LTO: the archive goes into a shared
# library, and LTO objects there would tie the link to this exact compiler's plugin.
cmake -S "$SV" -B "$SV/build" "${cmake_common[@]}" -DBUILD_APPS=OFF -DBUILD_TESTING=OFF -DEXCLUDE_HASH=ON \
  -DSVT_AV1_LTO=OFF -DNATIVE=OFF
cmake --build "$SV/build" -j "$JOBS"
cmake --install "$SV/build"
licence "$SV/LICENSE.md" SVT-AV1-LICENSE.md
licence "$SV/LICENSE-BSD2.md" SVT-AV1-LICENSE-BSD2.md
licence "$SV/PATENTS.md" SVT-AV1-PATENTS.md
# fastfeat is in the library (FASTFEAT objects). safestringlib is not: only the SvtAv1EncApp, which isn't built, takes it.
licence "$SV/third_party/fastfeat/LICENSE" SVT-AV1-fastfeat-LICENSE
ar t "$PREFIX/lib/libSvtAv1Enc.a" | grep -q -x 'fast_9.c.o' || die "libSvtAv1Enc.a has no fastfeat objects"
if ar t "$PREFIX/lib/libSvtAv1Enc.a" | grep -E '^(safe_str_constraint|ignore_handler_s|strcpy_s)\.c\.o$'; then
  die "libSvtAv1Enc.a has safestringlib in it: ship its LICENSE"
fi

# C++ code (glslang and libplacebo's C++ parts, zimg, OpenH264) links libstdc++ statically, so the shared
# libraries need no libstdc++.so.6 (and none newer than the host's): every -lstdc++ becomes the archive and the
# libm it calls (the shared one names libm itself), and libplacebo, whose .pc names no C++ runtime, gets both after
# its glslang archives.
# libplacebo's .pc names the glslang archives by path; FFmpeg's configure takes any word that isn't -l or .so for a
# flag and puts it before the objects, where GNU ld drops them, so they become -l names (only archives are there).
for pc in "$PREFIX"/lib/pkgconfig/*.pc; do
  sed -i -E -e 's/-lstdc\+\+/-l:libstdc++.a -lm/g' -e "s#$PREFIX/lib/lib([A-Za-z0-9_+-]+)\.a#-l\1#g" "$pc"
done
grep -q -- '-l:libstdc++.a' "$PREFIX/lib/pkgconfig/libplacebo.pc" ||
  sed -i '/^Libs:/ s/$/ -l:libstdc++.a -lm/' "$PREFIX/lib/pkgconfig/libplacebo.pc"
# No shared third-party library may be linked by accident: only the loader above, which is linked on purpose.
if find "$PREFIX/lib" -name '*.so*' ! -name 'libvulkan.so*' | grep .; then die "shared libraries in the prefix"; fi

echo "== ffmpeg =="
FF="$(unpack "ffmpeg-${FFMPEG_VERSION}.tar.xz" ffmpeg)"
cp "$FF/COPYING.LGPLv2.1" "$OUT/LICENSE.txt"
# Every option is compiled into the binaries (FFMPEG_CONFIGURATION), so none names a path: the prefix reaches the
# compile through CFLAGS/LDFLAGS in the environment and pkg-config. --prefix only sets the unused data directory.
# VA-API is the one system library FFmpeg links besides the Vulkan loader: libva 2.x (MIT), dynamically, from the
# image's libva-dev. pkg-config sees only the prefix, so its two .pc files are copied in (they point at /usr).
VAAPI_ARGS=()
if [[ "${LINUX_FFMPEG_VAAPI:-0}" == 1 ]]; then
  for pc in libva libva-drm; do cp "/usr/lib/x86_64-linux-gnu/pkgconfig/$pc.pc" "$PREFIX/lib/pkgconfig/"; done
  VAAPI_ARGS=(--enable-vaapi)
fi
CONFIGURE_ARGS=(
  --prefix=/taalcut-ffmpeg
  --arch=x86_64
  --target-os=linux
  --cc=gcc
  --cxx=g++
  --nvcc=clang-14
  --pkg-config=pkg-config
  --pkg-config-flags=--static
  --enable-shared
  --disable-static
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-stripping
  --disable-autodetect
  --disable-gpl
  --disable-nonfree
  --disable-version3
  --disable-libx264
  --disable-libx265
  --disable-libfdk-aac
  --enable-iconv
  --enable-zlib
  --enable-ffnvcodec
  --enable-cuda-llvm
  --enable-cuvid
  --enable-nvdec
  --enable-nvenc
  --enable-vulkan
  --glslc=glslang
  --enable-libplacebo
  --enable-libzimg
  --enable-libopenh264
  --enable-libdav1d
  --enable-libsvtav1
  "${VAAPI_ARGS[@]}"
  --extra-ldflags='-static-libgcc -Wl,--exclude-libs,ALL'
  --extra-ldexeflags="-Wl,--disable-new-dtags -Wl,-rpath,'\\\$\\\$ORIGIN/../lib'"
)
(cd "$FF" && ./configure "${CONFIGURE_ARGS[@]}") || { tail -40 "$FF/ffbuild/config.log"; die "configure failed"; }
cfg() { awk -v k="$1" '$1=="#define" && $2==k {print $3}' "$FF/config.h" "$FF/config_components.h" | head -1; }
for key in CONFIG_GPL CONFIG_NONFREE CONFIG_VERSION3; do
  [[ "$(cfg "$key")" == 0 ]] || die "$key is not 0"
done
want=(CONFIG_LIBPLACEBO CONFIG_LIBZIMG CONFIG_LIBOPENH264 CONFIG_LIBDAV1D CONFIG_LIBSVTAV1 CONFIG_VULKAN
  CONFIG_ZLIB CONFIG_ICONV CONFIG_FFNVCODEC CONFIG_CUDA CONFIG_CUDA_LLVM CONFIG_NVENC CONFIG_NVDEC CONFIG_CUVID
  CONFIG_H264_NVENC_ENCODER CONFIG_HEVC_NVENC_ENCODER CONFIG_AV1_NVENC_ENCODER CONFIG_LIBOPENH264_ENCODER
  CONFIG_LIBSVTAV1_ENCODER CONFIG_LIBDAV1D_DECODER CONFIG_PRORES_KS_ENCODER CONFIG_H264_CUVID_DECODER
  CONFIG_SCALE_CUDA_FILTER CONFIG_TRANSPOSE_CUDA_FILTER CONFIG_LIBPLACEBO_FILTER CONFIG_ZSCALE_FILTER
  CONFIG_TONEMAP_FILTER CONFIG_SCALE_VULKAN_FILTER HAVE_SPIRV_UNIFIED1_SPIRV_H CONFIG_PNG_ENCODER)
[[ "${LINUX_FFMPEG_VAAPI:-0}" == 1 ]] && want+=(CONFIG_VAAPI CONFIG_H264_VAAPI_ENCODER CONFIG_SCALE_VAAPI_FILTER)
for key in "${want[@]}"; do
  [[ "$(cfg "$key")" == 1 ]] || die "$key is not 1"
done
# The executables' RPATH survives three rounds of quoting: configure's eval takes \$ to $, make takes $$ to $, and
# the recipe's shell leaves '$ORIGIN' alone. The linker sees $ORIGIN/../lib; verify-linux.sh reads it back.
grep -qxF "LDEXEFLAGS= -Wl,--disable-new-dtags -Wl,-rpath,'\$\$ORIGIN/../lib'" "$FF/ffbuild/config.mak" ||
  die "config.mak's LDEXEFLAGS lost \$ORIGIN: $(grep '^LDEXEFLAGS=' "$FF/ffbuild/config.mak")"
glslc_used="$(awk -F= '$1=="GLSLC" {print $2}' "$FF/ffbuild/config.mak")"
[[ "$glslc_used" == glslang ]] || die "FFmpeg's configure chose the SPIR-V compiler '${glslc_used:-none}', not glslang"
if grep -E '^#define (FFMPEG_CONFIGURATION|FFMPEG_DATADIR|AVCONV_DATADIR|CC_IDENT) ' "$FF/config.h" | grep -F /home/; then
  die "config.h embeds a home path"
fi
# The exact configure string compiled into the binaries (config.h escapes quotes and backslashes).
python3 - "$FF/config.h" "$OUT/configure-line.txt" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
needle = '#define FFMPEG_CONFIGURATION "'
i = text.index(needle) + len(needle)
out = []
while text[i] != '"':
    if text[i] == '\\':
        i += 1
    out.append(text[i])
    i += 1
pathlib.Path(sys.argv[2]).write_text("".join(out) + "\n")
PY
make -C "$FF" -j "$JOBS"

# The shaders and CUDA kernels are compressed into the libraries, where build-linux.sh's path check can't read
# them; it checks these copies instead.
find "$FF" \( -name '*.spv' -o -name '*.ptx' \) -type f | sort | while read -r file; do
  cp "$file" "$OUT/check/$(echo "${file#"$FF"/}" | tr / _)"
done
# Every symbol, local ones included, before strip removes them: nothing from a GPL library may be in there. The
# names are the libraries' own API prefixes (libxvidcore's xvid_global/encore/decore/plugin_*, not FFmpeg's own LGPL
# xvid_idct_*; vid.stab's vsMotionDetect*/vsTransform*/vs_log_*).
gpl='^(fftw[a-z0-9]*_|vbi[0-9]*_|chromaprint_|x26[45]_|rubberband_|f0r_|vs(MotionDetect|Transform|_log_)|xvid_(global|encore|decore|plugin)|cdio_|pp_postprocess)'
for lib in libavcodec libavdevice libavfilter libavformat libavutil libswresample libswscale; do
  if nm "$FF/$lib/$lib.so" | awk '{print $NF}' | grep -E "$gpl" | head -5 | grep .; then
    die "$lib has symbols of a GPL library"
  fi
done
echo "no GPL library symbols in the seven libraries ($(nm "$FF"/lib*/lib*.so | wc -l) symbols)"
for name in ffmpeg ffprobe; do
  cp "$FF/$name" "$OUT/bin/$name"
  strip --strip-all "$OUT/bin/$name"
done
for lib in libavcodec libavdevice libavfilter libavformat libavutil libswresample libswscale; do
  soname="$(readelf -d "$FF/$lib/$lib.so" | sed -n 's/.*(SONAME).*\[\(.*\)\]/\1/p')"
  cp -L "$FF/$lib/$lib.so" "$OUT/lib/$soname"
  strip --strip-unneeded "$OUT/lib/$soname"
done
chmod 755 "$OUT"/bin/* "$OUT"/lib/*
chmod 644 "$OUT"/LICENSES/* "$OUT/LICENSE.txt"
cp /toolchain-packages.txt "$OUT/toolchain-packages.txt"
{
  echo "gcc $(gcc -dumpfullversion)"
  echo "clang $(clang-14 --version | head -1 | sed 's/.*clang version //')"
  echo "nasm $(nasm -v | awk '{print $3}')"
  echo "binutils $(ld --version | head -1 | awk '{print $NF}')"
  echo "glibc $(ldd --version | head -1 | awk '{print $NF}')"
} >"$OUT/toolchain.txt"
rm -rf "$WORK"
echo "container build complete"
