#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
# Reproducible LGPL FFmpeg sidecar for macOS arm64 (deployment target 14.0).
# Build trees stay under .build next to this script, wherever it is checked
# out: every compile maps that directory to /taalcut-ffmpeg and no absolute
# build path reaches the configure line, so the bytes do not depend on it.
# After strip, normalize-macho.py gives each dist binary a content-derived
# LC_UUID and a deterministic ad-hoc signature (not the hardened runtime).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
cd "$ROOT"
# The path is split on whitespace in CFLAGS; refuse rather than build wrong.
[[ "$ROOT" != *[[:space:]]* ]] || { echo "error: build path contains whitespace: $ROOT" >&2; exit 1; }
# shellcheck disable=SC1091
source "$ROOT/versions.env"

: "${SOURCE_DATE_EPOCH:?SOURCE_DATE_EPOCH missing from versions.env}"
: "${MACOS_MIN:?MACOS_MIN missing from versions.env}"

export SOURCE_DATE_EPOCH
export ZERO_AR_DATE=1
export PYTHONHASHSEED=0
export TZ=UTC
export LC_ALL=C
export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN"
export COPYFILE_DISABLE=1

BUILD="$ROOT/.build"
PREFIX="$BUILD/prefix"
SRC="$BUILD/src"
WORK="$BUILD/work"
# Drop a previous prefix so a partial install cannot be linked by accident, and the tool links into it.
rm -rf "$PREFIX" "$WORK" "$BUILD/bin"
# Keep the BUILDINFO.json this build replaces: buildinfo.py carries its reproducibility record over when the new
# outputs are the bytes that record describes.
mkdir -p "$BUILD"
if [[ -f "$ROOT/dist/BUILDINFO.json" ]]; then
  cp "$ROOT/dist/BUILDINFO.json" "$BUILD/BUILDINFO.previous.json"
else
  rm -f "$BUILD/BUILDINFO.previous.json"
fi
rm -f "$ROOT/dist/ffmpeg" "$ROOT/dist/ffprobe" "$ROOT/dist/BUILDINFO.json" \
  "$ROOT/dist/lib/libMoltenVK.dylib" "$ROOT/dist/lib/MoltenVK_icd.json"
mkdir -p "$SRC" "$PREFIX" "$WORK" "$BUILD/bin" "$ROOT/dist/lib" "$ROOT/LICENSES"

# Stop git describe inside unpacked trees from walking up into the parent repo.
export GIT_CEILING_DIRECTORIES="$BUILD"

ln -sfn /opt/homebrew/bin/glibtoolize "$BUILD/bin/libtoolize"

# $BUILD/bin comes first: the pinned glslang built below is linked there, ahead of anything Homebrew has.
# Homebrew is on PATH for the build tools README.md lists, nothing else (see "glslang" and "ffmpeg" below).
export PATH="$BUILD/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
unset LIBRARY_PATH CPATH C_INCLUDE_PATH CPLUS_INCLUDE_PATH PKG_CONFIG_PATH || true

export CC=/usr/bin/clang
export CXX=/usr/bin/clang++
export AR=/usr/bin/ar
export RANLIB=/usr/bin/ranlib
export NM=/usr/bin/nm
export STRIP=/usr/bin/strip
export PKG_CONFIG=/opt/homebrew/bin/pkgconf
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
export SDKROOT="$(xcrun --show-sdk-path)"

# __FILE__, debug and macro paths under the build root become /taalcut-ffmpeg.
# The flags live in the environment only. FFmpeg's configure reads CFLAGS and
# LDFLAGS from it without recording them in FFMPEG_CONFIGURATION, the string
# `ffmpeg -version` prints, so no absolute path is passed as a configure option.
MAP_TO=/taalcut-ffmpeg
MAPFLAGS="-ffile-prefix-map=${ROOT}=${MAP_TO} -fdebug-prefix-map=${ROOT}=${MAP_TO} -fmacro-prefix-map=${ROOT}=${MAP_TO}"
MINFLAGS="-mmacosx-version-min=${MACOS_MIN}"
export CFLAGS="${MINFLAGS} ${MAPFLAGS} -I${PREFIX}/include"
export CXXFLAGS="${MINFLAGS} ${MAPFLAGS} -I${PREFIX}/include"
export LDFLAGS="${MINFLAGS} -L${PREFIX}/lib"
export CPPFLAGS="-I${PREFIX}/include"
export LIBRARY_PATH="${PREFIX}/lib"

JOBS="${TAALCUT_FFMPEG_BUILD_JOBS:-$(sysctl -n hw.ncpu)}"
[[ "$JOBS" =~ ^[1-9][0-9]*$ ]] || { echo "invalid TAALCUT_FFMPEG_BUILD_JOBS" >&2; exit 1; }

die() { echo "error: $*" >&2; exit 1; }

sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }

require_sha() {
  local file="$1" expected="$2"
  local actual
  actual="$(sha256_file "$file")"
  if [[ "$actual" != "$expected" ]]; then
    die "SHA-256 mismatch for $file
expected $expected
actual   $actual"
  fi
}

fetch() {
  local url="$1" out="$2" expected="$3"
  if [[ -f "$out" ]]; then
    require_sha "$out" "$expected"
    echo "verified $(basename "$out")"
    return 0
  fi
  echo "download $url"
  curl -fL --retry 5 --retry-all-errors --retry-delay 2 -o "$out.partial" "$url"
  mv "$out.partial" "$out"
  require_sha "$out" "$expected"
}

extract() {
  local archive="$1" dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  case "$archive" in
    *.tar.xz|*.txz) tar -xJf "$archive" -C "$dest" ;;
    *.tar.bz2) tar -xjf "$archive" -C "$dest" ;;
    *.tar.gz|*.tgz) tar -xzf "$archive" -C "$dest" ;;
    *.tar) tar -xf "$archive" -C "$dest" ;;
    *) die "unknown archive $archive" ;;
  esac
}

one_dir() {
  local parent="$1"
  local found=()
  local d
  for d in "$parent"/*; do
    [[ -d "$d" ]] || continue
    found+=("$d")
  done
  [[ "${#found[@]}" -eq 1 ]] || die "expected one directory in $parent, found ${#found[@]}"
  printf '%s\n' "${found[0]}"
}

cmake_common=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX="$PREFIX"
  -DCMAKE_PREFIX_PATH="$PREFIX"
  -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local"
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN"
  -DCMAKE_OSX_ARCHITECTURES=arm64
  -DCMAKE_C_COMPILER="$CC"
  -DCMAKE_CXX_COMPILER="$CXX"
  -DCMAKE_C_FLAGS="${CFLAGS}"
  -DCMAKE_CXX_FLAGS="${CXXFLAGS}"
  -DCMAKE_EXE_LINKER_FLAGS="${MINFLAGS}"
  -DCMAKE_SHARED_LINKER_FLAGS="${MINFLAGS}"
  -DCMAKE_MODULE_LINKER_FLAGS="${MINFLAGS}"
  -DBUILD_SHARED_LIBS=OFF
)

echo "== toolchain =="
clang --version | head -1
meson --version
ninja --version
nasm -v | head -1
cmake --version | head -1
pkgconf --version
autoconf --version | head -1
automake --version | head -1
glibtool --version | head -1
python3 --version
echo "SDKROOT=$SDKROOT"
echo "SDK=$(xcrun --show-sdk-version)"
sw_vers
df -h / | tail -1

echo "== fetch =="
fetch "$FFMPEG_URL" "$SRC/ffmpeg-${FFMPEG_VERSION}.tar.xz" "$FFMPEG_SHA256"
fetch "$ZIMG_URL" "$SRC/zimg-${ZIMG_VERSION}.tar.gz" "$ZIMG_SHA256"
fetch "$LCMS2_URL" "$SRC/lcms2-${LCMS2_VERSION}.tar.gz" "$LCMS2_SHA256"
fetch "$LIBPLACEBO_URL" "$SRC/libplacebo-${LIBPLACEBO_VERSION}.tar.gz" "$LIBPLACEBO_SHA256"
fetch "$VULKAN_HEADERS_URL" "$SRC/vulkan-headers-${VULKAN_HEADERS_VERSION}.tar.gz" "$VULKAN_HEADERS_SHA256"
fetch "$VULKAN_LOADER_URL" "$SRC/vulkan-loader-${VULKAN_LOADER_VERSION}.tar.gz" "$VULKAN_LOADER_SHA256"
fetch "$GLSLANG_URL" "$SRC/glslang-${GLSLANG_VERSION}.tar.gz" "$GLSLANG_SHA256"
fetch "$FAST_FLOAT_URL" "$SRC/fast_float-${FAST_FLOAT_VERSION}.tar.gz" "$FAST_FLOAT_SHA256"
fetch "$JINJA2_URL" "$SRC/jinja2-${JINJA2_VERSION}.tar.gz" "$JINJA2_SHA256"
fetch "$MARKUPSAFE_URL" "$SRC/markupsafe-${MARKUPSAFE_VERSION}.tar.gz" "$MARKUPSAFE_SHA256"
fetch "$MOLTENVK_URL" "$SRC/MoltenVK-macos-${MOLTENVK_VERSION}.tar" "$MOLTENVK_SHA256"
fetch "$SPIRV_HEADERS_URL" "$SRC/spirv-headers-${SPIRV_HEADERS_VERSION}.tar.gz" "$SPIRV_HEADERS_SHA256"

# Build the pinned static libraries with this shell's prepared toolchain.
# shellcheck disable=SC1091
source "$ROOT/build-macos-deps.sh"


echo "== ffmpeg =="
rm -rf "$WORK/ffmpeg"
extract "$SRC/ffmpeg-${FFMPEG_VERSION}.tar.xz" "$WORK/ffmpeg"
FF="$(one_dir "$WORK/ffmpeg")"
cp -p "$FF/COPYING.LGPLv2.1" "$ROOT/LICENSES/FFmpeg-COPYING.LGPLv2.1"
# 9.0.2's --enable-vulkan-static branch passes the preprocessor condition
# "defined VK_VERSION_1_3" to check_pkg_config, which compiles it as a
# function name. The probe cannot succeed. Check vkGetInstanceProcAddr,
# the same symbol the non-static fallback uses. Headers are 1.4.357.
python3 - "$FF/configure" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text()
old = 'check_pkg_config vulkan "vulkan >= 1.3.277" "vulkan/vulkan.h" "defined VK_VERSION_1_3"'
new = 'check_pkg_config vulkan "vulkan >= 1.3.277" "vulkan/vulkan.h" "vkGetInstanceProcAddr"'
if old not in t:
    raise SystemExit("vulkan static probe pattern missing")
p.write_text(t.replace(old, new, 1))
PY

# Every option below is compiled into the binary as FFMPEG_CONFIGURATION, so
# none of them names a build path. The private prefix reaches the compile
# through CFLAGS/CPPFLAGS/LDFLAGS in the environment and through pkg-config.
# --prefix only sets the compiled-in data directory (presets, unused): FFmpeg
# is never installed, its two binaries are copied out of the build tree.
FF_LDFLAGS="${MINFLAGS} -lc++ -Wl,-headerpad_max_install_names"

CONFIGURE_ARGS=(
  --prefix="$MAP_TO"
  --arch=arm64
  --cc="$CC"
  --cxx="$CXX"
  --ar="$AR"
  --nm="$NM"
  --ranlib="$RANLIB"
  --strip="$STRIP"
  --pkg-config="$PKG_CONFIG"
  --pkg-config-flags=--static
  --enable-static
  --disable-shared
  --disable-debug
  --disable-doc
  --disable-ffplay
  --disable-stripping
  --disable-gpl
  --disable-nonfree
  --disable-version3
  --disable-libx264
  --disable-libx265
  --disable-libfdk-aac
  --enable-libplacebo
  --enable-libzimg
  --disable-libopenh264
  --enable-vulkan
  --enable-vulkan-static
  # A name, not a path (no build path in the configure line): PATH resolves it to $BUILD/bin/glslang, the
  # pinned build, and the check after configure stops the build if config.mak names anything else.
  --glslc=glslang
  --extra-cflags="$MINFLAGS"
  --extra-cxxflags="$MINFLAGS"
  --extra-ldflags="$FF_LDFLAGS"
)

(
  cd "$FF"
  ./configure "${CONFIGURE_ARGS[@]}"
)
# The path map has to reach FFmpeg's own compile through the environment.
grep -q -F -- "-ffile-prefix-map=${ROOT}=${MAP_TO}" "$FF/ffbuild/config.mak" ||
  die "configure dropped CFLAGS from the environment: no prefix map in config.mak"
# Strings config.h compiles into the binaries: the configure line and data dirs.
if grep -E '^#define (FFMPEG_CONFIGURATION|FFMPEG_DATADIR|AVCONV_DATADIR|CC_IDENT) ' "$FF/config.h" |
  grep -F -e "$ROOT" -e "${HOME:-/nonexistent-home}" -e /Users/; then
  die "config.h embeds a build path"
fi
# The SPIR-V compiler make will run: exactly the pinned glslang. Configure falls through to `glslc` and the rest
# when a probe fails, so a broken pinned binary would otherwise hand the shaders to whatever the machine has.
glslc_used="$(awk -F= '$1=="GLSLC" {print $2}' "$FF/ffbuild/config.mak")"
echo "GLSLC=${glslc_used:-missing} ($(command -v glslang))"
[[ "$glslc_used" == "glslang" ]] ||
  die "FFmpeg's configure chose the SPIR-V compiler '${glslc_used:-none}', not the pinned glslang"
[[ "$(command -v glslang)" == "$BUILD/bin/glslang" ]] || die "glslang on PATH is not the pinned build"

cfg_defs() {
  awk -v k="$1" '$1=="#define" && $2==k {print $3}' "$FF/config.h" "$FF/config_components.h" 2>/dev/null | head -1
}
vt="$(cfg_defs CONFIG_VIDEOTOOLBOX)"
at="$(cfg_defs CONFIG_AUDIOTOOLBOX)"
gpl="$(cfg_defs CONFIG_GPL)"
nonfree="$(cfg_defs CONFIG_NONFREE)"
echo "CONFIG_VIDEOTOOLBOX=${vt:-missing}"
echo "CONFIG_AUDIOTOOLBOX=${at:-missing}"
echo "CONFIG_GPL=${gpl:-missing}"
echo "CONFIG_NONFREE=${nonfree:-missing}"
[[ "${vt}" == "1" ]] || die "CONFIG_VIDEOTOOLBOX is not 1"
[[ "${gpl}" == "0" ]] || die "CONFIG_GPL is not 0"
[[ "${nonfree}" == "0" ]] || die "CONFIG_NONFREE is not 0"
for key in CONFIG_LIBPLACEBO CONFIG_LIBZIMG CONFIG_VULKAN \
  CONFIG_H264_VIDEOTOOLBOX_ENCODER CONFIG_HEVC_VIDEOTOOLBOX_ENCODER \
  CONFIG_SCALE_VT_FILTER CONFIG_TRANSPOSE_VT_FILTER CONFIG_YADIF_VIDEOTOOLBOX_FILTER \
  CONFIG_LIBPLACEBO_FILTER CONFIG_ZSCALE_FILTER CONFIG_TONEMAP_FILTER \
  CONFIG_SCALE_VULKAN_FILTER CONFIG_BWDIF_VULKAN_FILTER CONFIG_OVERLAY_VULKAN_FILTER \
  HAVE_SPIRV_UNIFIED1_SPIRV_H; do
  val="$(cfg_defs "$key")"
  echo "${key}=${val:-missing}"
  [[ "$val" == "1" ]] || die "$key is not 1"
done

# Exact configure string embedded in the binary (config.h escapes quotes).
python3 - "$FF/config.h" "$BUILD/configure-line.txt" <<'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
needle = '#define FFMPEG_CONFIGURATION "'
start = text.find(needle)
if start < 0:
    raise SystemExit("FFMPEG_CONFIGURATION not found")
i = start + len(needle)
out = []
while i < len(text):
    c = text[i]
    if c == '\\':
        out.append(text[i + 1])
        i += 2
        continue
    if c == '"':
        break
    out.append(c)
    i += 1
pathlib.Path(sys.argv[2]).write_text("".join(out) + "\n")
PY

(
  cd "$FF"
  make -j "$JOBS"
)
[[ -x "$FF/ffmpeg" && -x "$FF/ffprobe" ]] || die "ffmpeg binaries missing"
# The shaders go into the binaries gzipped, where check-paths.sh below can't read them; check them here.
spv=()
while IFS= read -r -d '' file; do spv+=("$file"); done < <(find "$FF" -name '*.spv' -print0 | sort -z)
[[ "${#spv[@]}" -gt 0 ]] || die "no compiled Vulkan shaders (*.spv) in the FFmpeg tree"
echo "== build paths in ${#spv[@]} compiled shaders =="
"$ROOT/check-paths.sh" "${spv[@]}" >/dev/null || die "a compiled shader embeds a build path"
strip -x "$FF/ffmpeg" "$FF/ffprobe"
cp -p "$FF/ffmpeg" "$ROOT/dist/ffmpeg"
cp -p "$FF/ffprobe" "$ROOT/dist/ffprobe"
chmod 755 "$ROOT/dist/ffmpeg" "$ROOT/dist/ffprobe"
# ld's LC_UUID and linker signature change every link. Rewrite both.
python3 "$ROOT/normalize-macho.py" "$ROOT/dist/ffmpeg" "$ROOT/dist/ffprobe"

echo "== MoltenVK =="
rm -rf "$WORK/moltenvk"
extract "$SRC/MoltenVK-macos-${MOLTENVK_VERSION}.tar" "$WORK/moltenvk"
MVK_DYLIB="$WORK/moltenvk/MoltenVK/MoltenVK/dynamic/dylib/macOS/libMoltenVK.dylib"
MVK_ICD_SRC="$WORK/moltenvk/MoltenVK/MoltenVK/dynamic/dylib/macOS/MoltenVK_icd.json"
[[ -f "$MVK_DYLIB" && -f "$MVK_ICD_SRC" ]] || die "MoltenVK dylib or ICD json missing"
# Official asset is a universal x86_64+arm64 binary. Ship arm64 only.
lipo "$MVK_DYLIB" -thin arm64 -output "$ROOT/dist/lib/libMoltenVK.dylib"
chmod 755 "$ROOT/dist/lib/libMoltenVK.dylib"
lipo -info "$ROOT/dist/lib/libMoltenVK.dylib" | grep -q 'architecture: arm64'
# Upstream library_path is already ./libMoltenVK.dylib, relative to the json.
cp -p "$MVK_ICD_SRC" "$ROOT/dist/lib/MoltenVK_icd.json"
cp -p "$WORK/moltenvk/MoltenVK/LICENSE" "$ROOT/LICENSES/MoltenVK-LICENSE"
rm -rf "$WORK/moltenvk"

echo "== link check =="
check_links() {
  local bin="$1"
  if otool -L "$bin" | grep -E '/opt/homebrew|/usr/local'; then
    die "$bin links Homebrew or /usr/local"
  fi
}
check_links "$ROOT/dist/ffmpeg"
check_links "$ROOT/dist/ffprobe"
check_links "$ROOT/dist/lib/libMoltenVK.dylib"

echo "== build paths =="
"$ROOT/check-paths.sh" "$ROOT/dist/ffmpeg" "$ROOT/dist/ffprobe" \
  "$ROOT/dist/lib/libMoltenVK.dylib" "$ROOT/dist/lib/MoltenVK_icd.json" ||
  die "a dist file embeds a build path"

echo "== BUILDINFO.json =="
python3 "$ROOT/buildinfo.py" "$ROOT" "$BUILD/BUILDINFO.previous.json"

# The FFmpeg tree is most of .build; the binaries are already in dist/.
rm -rf "$WORK/ffmpeg"
echo "build complete"
echo "ffmpeg $(shasum -a 256 "$ROOT/dist/ffmpeg")"
echo "ffprobe $(shasum -a 256 "$ROOT/dist/ffprobe")"
echo "CONFIG_AUDIOTOOLBOX was printed above"
