# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors

# Static prerequisites for the macOS FFmpeg build. Sourced after build.sh prepares its toolchain and pins.

echo "== vulkan-headers =="
rm -rf "$WORK/vulkan-headers"
extract "$SRC/vulkan-headers-${VULKAN_HEADERS_VERSION}.tar.gz" "$WORK/vulkan-headers"
VH="$(one_dir "$WORK/vulkan-headers")"
cmake -S "$VH" -B "$VH/build" "${cmake_common[@]}"
cmake --build "$VH/build" -j "$JOBS"
cmake --install "$VH/build"
cp -p "$VH/LICENSE.md" "$ROOT/LICENSES/Vulkan-Headers-LICENSE.md"
cp -p "$VH/LICENSES/Apache-2.0.txt" "$ROOT/LICENSES/Vulkan-Headers-Apache-2.0.txt"
cp -p "$VH/LICENSES/MIT.txt" "$ROOT/LICENSES/Vulkan-Headers-MIT.txt"
test -f "$PREFIX/share/vulkan/registry/vk.xml"
rm -rf "$WORK/vulkan-headers"

# SYSCONFDIR defaults to <install prefix>/etc, which the loader compiles in as
# an ICD search path. /etc is the system default and is not a build path.
echo "== vulkan-loader (static, APPLE_STATIC_LOADER) =="
rm -rf "$WORK/vulkan-loader"
extract "$SRC/vulkan-loader-${VULKAN_LOADER_VERSION}.tar.gz" "$WORK/vulkan-loader"
VL="$(one_dir "$WORK/vulkan-loader")"
cmake -S "$VL" -B "$VL/build" "${cmake_common[@]}" \
  -DAPPLE_STATIC_LOADER=ON \
  -DBUILD_TESTS=OFF \
  -DUPDATE_DEPS=OFF \
  -DSYSCONFDIR=/etc \
  -DVULKAN_HEADERS_INSTALL_DIR="$PREFIX"
cmake --build "$VL/build" --target vulkan -j "$JOBS"
VKA="$(find "$VL/build" -name 'libvulkan.a' -print -quit)"
[[ -n "$VKA" && -f "$VKA" ]] || die "libvulkan.a was not produced"
mkdir -p "$PREFIX/lib/pkgconfig"
cp -p "$VKA" "$PREFIX/lib/libvulkan.a"
# Upstream skips install (and vulkan.pc) when APPLE_STATIC_LOADER is on,
# and would also install a shared framework. Keep only the static archive.
rm -f "$PREFIX/lib"/libvulkan*.dylib
rm -rf "$PREFIX/lib/vulkan.framework" "$PREFIX/loader"
cat > "$PREFIX/lib/pkgconfig/vulkan.pc" <<EOF
prefix=${PREFIX}
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: Vulkan-Loader
Description: Vulkan Loader (static)
Version: ${VULKAN_LOADER_VERSION%.*}
Libs: -L\${libdir} -lvulkan
Libs.private: -framework CoreFoundation
Cflags: -I\${includedir}
EOF
cp -p "$VL/LICENSE.txt" "$ROOT/LICENSES/Vulkan-Loader-LICENSE.txt"
cp -p "$VL/LICENSES/Apache-2.0.txt" "$ROOT/LICENSES/Vulkan-Loader-Apache-2.0.txt"
rm -rf "$WORK/vulkan-loader"
# Make sure nothing dynamic snuck in.
find "$PREFIX" -name 'libvulkan*.dylib' -delete

echo "== lcms2 =="
rm -rf "$WORK/lcms2"
extract "$SRC/lcms2-${LCMS2_VERSION}.tar.gz" "$WORK/lcms2"
LCMS="$(one_dir "$WORK/lcms2")"
(
  cd "$LCMS"
  ./configure \
    --prefix="$PREFIX" \
    --enable-static \
    --disable-shared \
    --without-jpeg \
    --without-tiff \
    --disable-dependency-tracking
  make -j "$JOBS"
  make install
)
cp -p "$LCMS/LICENSE" "$ROOT/LICENSES/lcms2-LICENSE"
# Do not install or ship the GPL-3 plugins under plugins/.
rm -rf "$WORK/lcms2"
rm -f "$PREFIX/lib"/liblcms2*.dylib

echo "== zimg =="
rm -rf "$WORK/zimg"
extract "$SRC/zimg-${ZIMG_VERSION}.tar.gz" "$WORK/zimg"
ZIMG="$(one_dir "$WORK/zimg")"
(
  cd "$ZIMG"
  ./autogen.sh
  # Default Libs.private is -lstdc++. Apple clang resolves that name to
  # libc++; pin STL_LIBS so the .pc file says -lc++.
  STL_LIBS="-lc++" \
  ./configure \
    --prefix="$PREFIX" \
    --enable-static \
    --disable-shared \
    --host=aarch64-apple-darwin \
    --disable-dependency-tracking \
    CC="$CC" \
    CXX="$CXX" \
    AR="$AR" \
    RANLIB="$RANLIB" \
    NM="$NM" \
    STRIP="$STRIP"
  make -j "$JOBS"
  make install
)
python3 - "$PREFIX/lib/pkgconfig/zimg.pc" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text().replace("-lstdc++", "-lc++")
p.write_text(t)
PY
cp -p "$ZIMG/COPYING" "$ROOT/LICENSES/zimg-COPYING"
rm -rf "$WORK/zimg"
rm -f "$PREFIX/lib"/libzimg*.dylib

# Two jobs from one pinned tree: the static libraries libplacebo links, and the `glslang` binary FFmpeg's
# configure compiles its Vulkan shaders with (GLSL to SPIR-V, at build time). FFmpeg takes the first of
# `glslc glslang glslangValidator` it finds on PATH, so without this binary it silently used whatever SPIR-V
# compiler the build machine had (Homebrew's shaderc glslc on the development Mac) and, on a machine with none,
# dropped every *_vulkan filter. ENABLE_OPT=OFF costs FFmpeg nothing: its configure asks glslang for no
# optimisation pass (glslc_opt_speed is empty for glslang).
echo "== glslang (ENABLE_OPT=OFF, static libraries and the glslang binary) =="
rm -rf "$WORK/glslang"
extract "$SRC/glslang-${GLSLANG_VERSION}.tar.gz" "$WORK/glslang"
GLS="$(one_dir "$WORK/glslang")"
cmake -S "$GLS" -B "$GLS/build" "${cmake_common[@]}" \
  -DENABLE_OPT=OFF \
  -DENABLE_GLSLANG_BINARIES=ON \
  -DGLSLANG_TESTS=OFF \
  -DENABLE_PCH=OFF \
  -DBUILD_EXTERNAL=OFF \
  -DALLOW_EXTERNAL_SPIRV_TOOLS=OFF
cmake --build "$GLS/build" -j "$JOBS"
cmake --install "$GLS/build"
cp -p "$GLS/LICENSE.txt" "$ROOT/LICENSES/glslang-LICENSE.txt"
rm -rf "$WORK/glslang"
find "$PREFIX/lib" -name 'libglslang*.dylib' -delete
find "$PREFIX/lib" -name 'libSPIRV*.dylib' -delete
[[ -x "$PREFIX/bin/glslang" ]] || die "the glslang binary was not built"
ln -sfn "$PREFIX/bin/glslang" "$BUILD/bin/glslang"
[[ "$(command -v glslang)" == "$BUILD/bin/glslang" ]] || die "glslang on PATH is $(command -v glslang), not the pinned build"
glslang --version

echo "== fast_float / jinja / markupsafe for libplacebo =="
rm -rf "$WORK/fast_float" "$WORK/jinja2" "$WORK/markupsafe"
extract "$SRC/fast_float-${FAST_FLOAT_VERSION}.tar.gz" "$WORK/fast_float"
extract "$SRC/jinja2-${JINJA2_VERSION}.tar.gz" "$WORK/jinja2"
extract "$SRC/markupsafe-${MARKUPSAFE_VERSION}.tar.gz" "$WORK/markupsafe"
FFLOAT="$(one_dir "$WORK/fast_float")"
JINJA="$(one_dir "$WORK/jinja2")"
MSAFE="$(one_dir "$WORK/markupsafe")"
cp -p "$FFLOAT/LICENSE-APACHE" "$ROOT/LICENSES/fast_float-LICENSE-APACHE"
cp -p "$FFLOAT/LICENSE-BOOST" "$ROOT/LICENSES/fast_float-LICENSE-BOOST"
cp -p "$FFLOAT/LICENSE-MIT" "$ROOT/LICENSES/fast_float-LICENSE-MIT"

echo "== libplacebo =="
rm -rf "$WORK/libplacebo"
extract "$SRC/libplacebo-${LIBPLACEBO_VERSION}.tar.gz" "$WORK/libplacebo"
LP="$(one_dir "$WORK/libplacebo")"
# Tarball omits git submodules. Point the existing fast_float probe at the
# pinned headers, and put Jinja/MarkupSafe where utils_gen.py's PYTHONPATH looks.
rm -rf "$LP/3rdparty/fast_float" "$LP/3rdparty/jinja" "$LP/3rdparty/markupsafe"
mkdir -p "$LP/3rdparty/fast_float" "$LP/3rdparty/jinja" "$LP/3rdparty/markupsafe"
cp -R "$FFLOAT/include" "$LP/3rdparty/fast_float/include"
cp -R "$JINJA/src" "$LP/3rdparty/jinja/src"
cp -R "$MSAFE/src" "$LP/3rdparty/markupsafe/src"
# prefer_static is a reserved Meson built-in (1.12). libplacebo calls
# get_option('prefer_static') and does not declare it. Pass -Dprefer_static.
# Do not let an empty Vulkan-Headers submodule directory shadow our prefix.
rm -rf "$LP/3rdparty/Vulkan-Headers"
# find_library('glslang') does not receive vulkan_lib_dirs, so a private
# prefix is invisible. Search the same directory SPIRV already uses.
python3 - "$LP/src/glsl/meson.build" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = "cxx.find_library('glslang', required: required, static: static)"
new = "cxx.find_library('glslang', required: required, static: static, dirs: vulkan_lib_dirs)"
if old not in t:
    raise SystemExit("glslang find_library pattern missing")
t = t.replace(old, new, 1)
old = "cxx.find_library('glslang-default-resource-limits', required: false)"
new = "cxx.find_library('glslang-default-resource-limits', required: false, static: true, dirs: vulkan_lib_dirs)"
if old not in t:
    raise SystemExit("resource-limits find_library pattern missing")
# vulkan_lib_dirs is defined just below this call. Move the call under it.
t = t.replace(old + "\n", "", 1)
needle = "  if vulkan_sdk != ''\n    vulkan_lib_dirs += [vulkan_sdk / 'lib']\n  endif\n"
insert = needle + "  glslang_deps += " + new + "\n"
if needle not in t:
    raise SystemExit("vulkan_lib_dirs block missing")
t = t.replace(needle, insert, 1)
p.write_text(t)
PY
meson setup "$LP/build" "$LP" \
  --prefix="$PREFIX" \
  --default-library=static \
  --buildtype=release \
  -Dprefer_static=true \
  -Dlcms=enabled \
  -Dvulkan=enabled \
  -Dvulkan-registry="$PREFIX/share/vulkan/registry/vk.xml" \
  -Dvulkan-sdk="$PREFIX" \
  -Dvk-proc-addr=enabled \
  -Dshaderc=disabled \
  -Dglslang=enabled \
  -Dopengl=disabled \
  -Dgl-proc-addr=disabled \
  -Dd3d11=disabled \
  -Ddemos=false \
  -Dtests=false \
  -Dbench=false \
  -Ddovi=enabled \
  -Dlibdovi=disabled \
  -Dxxhash=disabled \
  -Dunwind=disabled \
  -Dc_link_args="${MINFLAGS} -L${PREFIX}/lib -lc++" \
  -Dcpp_link_args="${MINFLAGS} -L${PREFIX}/lib -lc++"
meson compile -C "$LP/build" -j "$JOBS"
meson install -C "$LP/build"
cp -p "$LP/LICENSE" "$ROOT/LICENSES/libplacebo-LICENSE"
# glslang objects in Libs need libc++ after the archives, not only in LDFLAGS.
python3 - "$PREFIX/lib/pkgconfig/libplacebo.pc" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
lines = []
for line in p.read_text().splitlines():
    if line.startswith("Libs:") and "-lc++" not in line:
        line += " -lc++"
    lines.append(line)
p.write_text("\n".join(lines) + "\n")
PY
rm -rf "$WORK/libplacebo" "$WORK/fast_float" "$WORK/jinja2" "$WORK/markupsafe"
rm -f "$PREFIX/lib"/libplacebo*.dylib
test -f "$PREFIX/lib/libplacebo.a"
test -f "$PREFIX/lib/pkgconfig/libplacebo.pc"

# H.264 uses macOS VideoToolbox, including its explicit software encoder on hardware failure. Shipping a
# source-built OpenH264 copy would not receive Cisco's conditional patent grant for its separately downloaded
# binary. The Linux build retains its existing codec until its separate distribution review is complete.
rm -f "$ROOT/LICENSES/OpenH264-LICENSE"

# Headers only. FFmpeg 9's swscale compiles its Vulkan backend (the "spirv" backend: swscale on Vulkan frames,
# which scale_vulkan uses to convert formats) only when it finds spirv/unified1/spirv.h; without it that backend
# is left out and such a scale_vulkan fails at run time. The tag is the Vulkan SDK the headers and loader above
# come from, commit 29981f65241605e08b0ede4cfeb999fe3b723c6a, the one the pinned glslang's known_good.json names.
echo "== SPIRV-Headers =="
rm -rf "$WORK/spirv-headers"
extract "$SRC/spirv-headers-${SPIRV_HEADERS_VERSION}.tar.gz" "$WORK/spirv-headers"
SPVH="$(one_dir "$WORK/spirv-headers")"
cmake -S "$SPVH" -B "$SPVH/build" "${cmake_common[@]}" \
  -DSPIRV_HEADERS_ENABLE_TESTS=OFF \
  -DSPIRV_HEADERS_ENABLE_INSTALL=ON
cmake --install "$SPVH/build"
cp -p "$SPVH/LICENSE" "$ROOT/LICENSES/SPIRV-Headers-LICENSE"
cp -p "$SPVH/LICENSES/MIT.txt" "$ROOT/LICENSES/SPIRV-Headers-MIT.txt"
rm -rf "$WORK/spirv-headers"
test -f "$PREFIX/include/spirv/unified1/spirv.h"

echo "== no shared vulkan/placebo left in prefix =="
if find "$PREFIX" \( -name '*.dylib' -o -name '*.so' \) | grep -q .; then
  find "$PREFIX" \( -name '*.dylib' -o -name '*.so' \)
  die "shared libraries in the private prefix"
fi
