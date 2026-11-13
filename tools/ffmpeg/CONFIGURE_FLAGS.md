# FFmpeg configure flags

FFmpeg 9.0.2, macOS arm64, deployment target 14.0. The exact line that ended
up in the binary is `configure` in `dist/BUILDINFO.json` (copied from
`FFMPEG_CONFIGURATION` in `config.h`). No option names a path on the build
machine, so the string, and the binary, are the same wherever `tools/ffmpeg`
is checked out. The private prefix reaches FFmpeg's compile through the
environment instead. See [Build paths](#build-paths).

`build.sh` passes:

| Flag | Why |
| --- | --- |
| `--prefix=/taalcut-ffmpeg` | A fixed placeholder that does not exist. FFmpeg is never installed: `ffmpeg` and `ffprobe` are copied out of the build tree to `dist/`. The prefix only sets the compiled-in data directory, `/taalcut-ffmpeg/share/ffmpeg`, for `-fpre`/`-vpre` presets, which Taalcut does not use. |
| `--arch=arm64` | Apple Silicon only. |
| `--cc/--cxx/--ar/--nm/--ranlib/--strip` | Apple clang and Apple binutils from `/usr/bin`, not a Homebrew compiler that would add Homebrew link paths. |
| `--pkg-config=/opt/homebrew/bin/pkgconf` | Build tool only. `PKG_CONFIG_LIBDIR` and `PKG_CONFIG_PATH` are only the private prefix, so Homebrew libplacebo, shaderc, and vulkan are invisible. |
| `--pkg-config-flags=--static` | Follow `Requires` and `Libs.private` and link the static archives. |
| `--enable-static` `--disable-shared` | No FFmpeg dylib. Third-party libraries are static archives in the private prefix. |
| `--disable-debug` | Drop debug info so `strip -x` is enough. `-buildconf` reads a normal string in the binary, not debug info. |
| `--disable-doc` | Man pages and HTML are not part of the sidecar. |
| `--disable-ffplay` | ffplay needs SDL. This package ships `ffmpeg` and `ffprobe` only. |
| `--disable-stripping` | Configure's own strip runs before our `strip -x`. Stripping is an explicit step in `build.sh`. |
| `--disable-gpl` `--disable-nonfree` `--disable-version3` | Stay on LGPL-2.1-or-later. These are the generated opposites of the enable flags. None of `--enable-gpl`, `--enable-nonfree`, or `--enable-version3` is passed. |
| `--disable-libx264` `--disable-libx265` `--disable-libfdk-aac` | Those codecs are GPL or nonfree. Explicitly off even if a pkg-config file for them existed outside the prefix. |
| `--enable-libplacebo` | Vulkan GPU tone-map, scalers, and libplacebo's Dolby Vision reshaping (`-Ddovi=enabled`). External libdovi is not used. |
| `--enable-libzimg` | `zscale`. |
| `--disable-libopenh264` | macOS uses VideoToolbox for hardware H.264 and `-allow_sw 1 -require_sw 1` for its system software fallback. No source-built OpenH264 is shipped. |
| `--enable-vulkan` `--enable-vulkan-static` | Link `libvulkan.a`. MoltenVK is not linked; the loader dlopens it at runtime. |
| `--glslc=glslang` | The SPIR-V compiler for FFmpeg's own Vulkan shaders (compiled at build time, gzipped into the binary): the `glslang` binary of the pinned glslang, linked into `.build/bin`, first on `PATH`. A name, not a path, so the configure line holds no build path. Without it `configure` takes the first of `glslc glslang glslangValidator` on `PATH`: whatever the build machine has, or none, which drops every `*_vulkan` filter. `build.sh` stops unless `config.mak` says `GLSLC=glslang` and the name resolves to the pinned build. |
| `--extra-cflags` `--extra-cxxflags` | `-mmacosx-version-min=14.0`. |
| `--extra-ldflags` | `-mmacosx-version-min=14.0`, `-lc++`, `-Wl,-headerpad_max_install_names`. |

Not passed, on purpose:

- `--enable-gpl`, `--enable-nonfree`, `--enable-version3`, `--enable-libx264`, `--enable-libx265`, `--enable-libfdk-aac`.
- `--disable-videotoolbox` and `--disable-audiotoolbox`. Both stay on autodetect. `build.sh` exits if `CONFIG_VIDEOTOOLBOX` is not 1. `CONFIG_AUDIOTOOLBOX` is the system AAC path and is recorded in the build log.
- Link-time optimisation.
- `-Wl,-no_uuid`. On this ld (ld-1267) that omits `LC_UUID`, and dyld then aborts with `missing LC_UUID load command` (exit 134).
- `-Wl,-no_adhoc_codesign`. Two such links matched byte for byte, and `strip -x` kept them matching, but executing one was SIGKILL 137 (`code object is not signed at all`).
- A fixed UUID passed to `ld`. `ld` has no `-uuid` flag here, and `-Wl,-no_uuid` omits `LC_UUID`, which dyld rejects. `build.sh` runs `normalize-macho.py` after `strip -x`: it clears `LC_UUID`, writes an UUID derived from the signature-free file, then ad-hoc signs with `-i <filename> --timestamp=none`. `PYTHONHASHSEED=0` is exported so libplacebo's Python code generator does not depend on hash randomisation. Whether two clean builds then hash the same is recorded in `dist/BUILDINFO.json`.

## Build paths

`build.sh` exports `CFLAGS` and `CXXFLAGS` with `-ffile-prefix-map`, `-fdebug-prefix-map`, and `-fmacro-prefix-map` from the `tools/ffmpeg` directory it runs in to `/taalcut-ffmpeg`, plus `-I` of the private prefix, and `LDFLAGS` with `-L` of the private prefix. CMake (Vulkan-Headers, Vulkan-Loader, glslang), Meson (libplacebo), and autotools (lcms2, zimg) take them from there. FFmpeg's `configure` reads the same variables from the environment into `ffbuild/config.mak` without adding them to `FFMPEG_CONFIGURATION`. `build.sh` stops if the map is missing from `config.mak`, or if `config.h` puts the build directory, `$HOME`, or `/Users/` into the configure line, the data directories, or `CC_IDENT`. pkg-config supplies the rest of the prefix's `-I` and `-L` flags. The `.pc` files hold the absolute prefix, but they only feed compile and link command lines, which the binary does not store.

`__FILE__` in assertions is the one build path that does reach the binary. libplacebo's `libav_internal.h`, compiled into `vf_libplacebo`, appears as `/taalcut-ffmpeg/.build/prefix/include/libplacebo/utils/libav_internal.h`. libplacebo's own sources are compiled by Meson from its build directory and appear as relative `../src/...` paths. There is no debug info: FFmpeg is `--disable-debug`, the dependencies are release builds, and `strip -x` runs on both binaries.

Vulkan-Loader compiles its configuration directory in as an ICD and settings search path. The default is `<install prefix>/etc`, inside `.build`. `build.sh` passes `-DSYSCONFDIR=/etc`, the loader's default for a system install. Taalcut sets `VK_DRIVER_FILES` and `VK_ICD_FILENAMES`, so the loader does not search for an ICD.

`check-paths.sh` runs `strings -a` on `ffmpeg`, `ffprobe`, `libMoltenVK.dylib`, and `MoltenVK_icd.json`. It fails on `/Users/`, `/home/`, `/private/tmp/`, `/private/var/`, `/var/folders/`, `$HOME`, the checkout path, or the account name as a word (skipped for generic names such as `root` or `user`). `build.sh` runs it before writing `BUILDINFO.json`, and `verify.sh` runs it again. The checkout path must not contain whitespace; `build.sh` refuses one that does.

## Environment

`MACOSX_DEPLOYMENT_TARGET=14.0` is exported for every compile and link, including the dependency builds. `SOURCE_DATE_EPOCH` is `1789689600` (2026-09-18 00:00:00 UTC). `ZERO_AR_DATE=1`, `TZ=UTC`, `LC_ALL=C`. `GIT_CEILING_DIRECTORIES` is the `.build` directory so `git describe` cannot walk into the parent repository and stamp a git hash into FFmpeg or libplacebo.

## Local adjustments the upstream tarballs required

These are not configure flags. They are recorded here because they change what the flags mean.

1. **Vulkan static probe in FFmpeg 9.0.2.** With `--enable-vulkan-static`, `configure` calls `check_pkg_config` with the fourth argument `"defined VK_VERSION_1_3"`. `check_pkg_config` treats that string as a space-separated list of function names, so the probe tries to compile a function called `defined` and fails before it links. The non-static branch uses the same text as a preprocessor condition and is fine. `build.sh` rewrites that one call to pass `vkGetInstanceProcAddr`, which is the symbol the static fallback already links. The installed headers are Vulkan 1.4.357, which define `VK_VERSION_1_3`. Without this rewrite, configure stops with `ERROR: vulkan requested but not found` even though `libvulkan.a` and `vulkan.pc` are present. The first probe's link line was missing `-framework CoreFoundation` only because it fell through to `check_lib ... -lvulkan` after the compile error. `Libs.private` of `vulkan.pc` is `-framework CoreFoundation`, and `--pkg-config-flags=--static` picks that up once the probe compiles.

2. **Vulkan-Loader `APPLE_STATIC_LOADER`.** That CMake option builds `libvulkan.a` and then returns before install, so it does not install the archive or write `vulkan.pc`, and a normal install would also install a shared framework. `build.sh` copies `libvulkan.a` itself, writes `vulkan.pc` (version `1.4.357`), and deletes any `libvulkan.dylib` or `vulkan.framework` in the prefix. The loader still `dlopen`s an ICD (`nm` shows `dlopen`). MoltenVK is that ICD, shipped under `dist/lib/`.

3. **libplacebo `src/glsl/meson.build`.** `find_library('glslang')` and `find_library('glslang-default-resource-limits')` do not receive `dirs: vulkan_lib_dirs`, so a private prefix is invisible even with `LIBRARY_PATH` set. `build.sh` adds `dirs: vulkan_lib_dirs` to the glslang lookup and moves the resource-limits lookup to after `vulkan_lib_dirs` is defined. `prefer_static` is not added to `meson_options.txt`: it is a Meson 1.12 built-in, and declaring it is an error (`Option name prefer_static is reserved`). The setup passes `-Dprefer_static=true`.

4. **Shader compiler.** libplacebo 7.360.1 prefers shaderc when both are auto, and uses the glslang C++ headers (`ShaderLang.h`, `GlslangToSpv.h`) when shaderc is disabled and glslang is enabled. This build uses a pinned glslang (`ENABLE_OPT=OFF`, no SPIRV-Tools) because the glslang C API is the one Homebrew avoids and because shaderc pulls a larger tree. `-Dshaderc=disabled -Dglslang=enabled`. The same build also makes the `glslang` binary (`ENABLE_GLSLANG_BINARIES=ON`), which FFmpeg compiles its Vulkan shaders with (`--glslc=glslang`). FFmpeg asks glslang for no optimisation pass (its `configure` has none for glslang outside `--enable-small`), so `ENABLE_OPT=OFF` changes nothing there.

5. **libplacebo and zimg pkg-config.** After install, `libplacebo.pc` `Libs` gains `-lc++` so libc++ is after the glslang archives. zimg's generated `Libs.private` defaults to `-lstdc++`; configure is given `STL_LIBS=-lc++`, and the `.pc` is rewritten if `-lstdc++` remains. On this SDK, `-lstdc++` happens to resolve to `/usr/lib/libc++.1.dylib`, but the `.pc` should name `-lc++`.

6. **OpenH264 removed on macOS.** The beta passes `--disable-libopenh264`; neither the source library nor its
   shared binary is shipped. `h264_videotoolbox -allow_sw 1 -require_sw 1` is the system software fallback.

7. **Empty libplacebo submodules.** The pinned GitHub tag archive has empty `3rdparty` directories for fast_float, Jinja, MarkupSafe, and Vulkan-Headers (git submodules are not in the archive). `build.sh` vendors pinned fast_float 8.3.1 headers (the include path libplacebo already probes), vendors Jinja 3.1.6 and MarkupSafe 3.0.3 where `utils_gen.py` looks, and deletes the empty Vulkan-Headers directory so Meson uses the prefix headers and `vk.xml`. Jinja and MarkupSafe are build-only. They are not linked, and their licences are not under `LICENSES/`.

8. **Disabled libplacebo features.** `-Dopengl=disabled -Dgl-proc-addr=disabled -Dd3d11=disabled -Dxxhash=disabled -Dunwind=disabled -Dlibdovi=disabled -Ddemos=false -Dtests=false -Dbench=false`. `-Ddovi=enabled` is libplacebo's own reshaping, not the external libdovi package. `-Dvk-proc-addr=enabled` so libplacebo calls `vkGetInstanceProcAddr` in `libvulkan.a` instead of `dlopen` of a `libvulkan.dylib` we do not ship.

9. **SPIRV-Headers.** FFmpeg 9's swscale has a Vulkan backend (`spirv`: swscale on Vulkan frames, which `scale_vulkan` uses to convert a format at the same size) that `configure` compiles only when `spirv/unified1/spirv.h` is found; without it `configure` warns `spirv-headers not found, swscale SPIR-V backend unavailable` and such a `scale_vulkan` fails at run time with `Operation not supported`. `build.sh` installs the headers of the pinned SPIRV-Headers (`vulkan-sdk-1.4.357.0`, the SDK of the Vulkan headers and loader, commit `29981f65`, the revision the pinned glslang's `known_good.json` names) into the prefix just before FFmpeg, and stops unless `HAVE_SPIRV_UNIFIED1_SPIRV_H` is 1. Headers only: nothing is built or linked from it beyond the constants swscale compiles in. `verify.sh` runs a `scale_vulkan` format conversion.

## Linux x64

FFmpeg 9.0.2 for linux-x64, built by `build-linux.sh` in a pinned Ubuntu 22.04 container (`linux-x64.Dockerfile`, glibc 2.35). The approach is the Mac's: every FFmpeg component of its own (codecs, formats, protocols, filters) stays on, as on macOS, and the external libraries are only the ones named here. The exact line that ended up in the binaries is `configure` in `dist/linux-x64/BUILDINFO.json`. As on the Mac, no option names a path: the container always builds under `/taalcut-ffmpeg`, whatever the host checkout, and the private prefix reaches the compile through `CFLAGS`/`LDFLAGS` in the environment and pkg-config.

`linux-in-container.sh` passes:

| Flag | Why |
| --- | --- |
| `--prefix=/taalcut-ffmpeg` | As on the Mac: a placeholder that only sets the unused data directory. |
| `--arch=x86_64` `--target-os=linux` | x86-64 baseline. FFmpeg, dav1d, SVT-AV1, OpenH264 and zimg pick their SIMD at run time. Nothing is built with `-march`. |
| `--cc=gcc` `--cxx=g++` | Ubuntu 22.04's GCC 11.4. Names, not paths. |
| `--nvcc=clang-14` | The CUDA filters' kernels are compiled by clang to PTX (`--enable-cuda-llvm`), never by NVIDIA's `nvcc` (`--enable-cuda-nvcc` is nonfree). FFmpeg's default `--cuda-gpu-arch=sm_30`; the driver compiles the PTX for the GPU at first use (media keeps the driver's cache, README.md). |
| `--pkg-config=pkg-config` `--pkg-config-flags=--static` | Only the private prefix is on `PKG_CONFIG_LIBDIR`. Follow `Libs.private` and link the static archives. |
| `--enable-shared` `--disable-static` | The seven FFmpeg libraries as `lib/<soname>`, so a recipient can replace them (LGPL-2.1 section 6(b)). The third-party libraries are static archives inside them. |
| `--disable-debug` `--disable-doc` `--disable-ffplay` `--disable-stripping` | As on the Mac. `linux-in-container.sh` strips (`--strip-all` on the binaries, `--strip-unneeded` on the libraries) after it checks the symbols. |
| `--disable-autodetect` | Nothing the image happens to hold is linked: no libxcb, ALSA, SDL, bzip2, lzma, libdrm or anything else. Every library below is named. The Mac's autodetect finds only system frameworks and libraries (VideoToolbox, zlib, bzip2, lzma, iconv); on Linux the container would offer more. |
| `--disable-gpl` `--disable-nonfree` `--disable-version3` | LGPL-2.1-or-later, the same as the Mac. `linux-in-container.sh` stops unless `CONFIG_GPL`, `CONFIG_NONFREE` and `CONFIG_VERSION3` are 0. |
| `--disable-libx264` `--disable-libx265` `--disable-libfdk-aac` | As on the Mac. |
| `--enable-iconv` | glibc's iconv (subtitle character sets). Nothing extra is linked. |
| `--enable-zlib` | zlib 1.3.2, static: PNG, the mov demuxer's compressed headers, and the compressed shaders and kernels. On the Mac it is the system's. |
| `--enable-ffnvcodec` `--enable-cuvid` `--enable-nvdec` `--enable-nvenc` | NVDEC/CUVID decode and the NVENC encoders (`h264_nvenc`, `hevc_nvenc`, `av1_nvenc`). nv-codec-headers 13.0.19.1 (MIT, headers only, Video Codec SDK 13.0: driver 570 or newer). FFmpeg dlopens `libcuda.so.1`, `libnvcuvid.so.1` and `libnvidia-encode.so.1` at run time; none of them is NEEDED, so the build starts on a machine with no NVIDIA driver. |
| `--enable-cuda-llvm` | `scale_cuda`, `transpose_cuda`, `hwupload_cuda` and the other CUDA filters, compiled by clang (above). No `scale_npp`: libnpp is nonfree. |
| `--enable-vulkan` `--glslc=glslang` | Vulkan filters and hwcontext. FFmpeg dlopens the system loader (`libvulkan.so.1`). Its shaders are compiled by the pinned glslang, as on the Mac. |
| `--enable-libplacebo` | Tone-map and scalers on Vulkan. Built with `-Dvk-proc-addr=enabled`, so libavfilter links the system's `libvulkan.so.1` (Ubuntu's `libvulkan1`, which the .deb depends on): media's libplacebo graphs let libplacebo open the device itself (README.md), and that path calls the loader's `vkGetInstanceProcAddr`. The loader is linked against a build of the pinned Vulkan-Loader that is not shipped. No Vulkan driver ships either: the GPU's own ICD runs. |
| `--enable-libzimg` `--enable-libopenh264` | zimg as on the Mac; Linux retains its source-built OpenH264 software fallback pending its separate distribution review. |
| `--enable-libdav1d` | Software AV1 decode: GPUs before Ampere have no AV1 decoder, and FFmpeg's own `av1` decoder only drives hardware. |
| `--enable-libsvtav1` | The CPU AV1 encoder, the AV1 export's fallback when `av1_nvenc` can't run. |
| `--enable-vaapi` | VA-API (Intel, AMD), linked against the system libva 2.x (`libva.so.2`, `libva-drm.so.2`; the .deb depends on `libva2` and `libva-drm2`), compiled against 22.04's libva 2.14 headers so it calls nothing a 2.14 lacks. `versions.env`'s `LINUX_FFMPEG_VAAPI=1` turns it on; `linux-in-container.sh` copies just `libva.pc` and `libva-drm.pc` into the prefix's pkg-config directory. `verify-linux.sh` runs a device trial on an Intel or AMD render node (README.md, Linux x64). |
| `--extra-ldflags='-static-libgcc -Wl,--exclude-libs,ALL'` | The GCC runtime is static (libstdc++ too, below), and no symbol of a static archive is exported from FFmpeg's libraries. |
| `--extra-ldexeflags="-Wl,--disable-new-dtags -Wl,-rpath,'\$\$ORIGIN/../lib'"` | `ffmpeg` and `ffprobe` find the libraries in `../lib`. `DT_RPATH`, not `DT_RUNPATH`: it also covers the libraries' own dependencies on each other, and an inherited `LD_LIBRARY_PATH` can't put other FFmpeg libraries in front of the pinned ones. The quoting survives three rounds: `configure` evaluates the option once (`\$` to `$`, so `config.mak` has `'$$ORIGIN/../lib'`), make turns `$$` into `$`, and the single quotes keep the recipe's shell off `$ORIGIN`. `linux-in-container.sh` stops unless `config.mak` has exactly that; with `-rpath,\$$ORIGIN/../lib`, the form that works on a command line, `configure` leaves `$/../lib`. The configure line in the binaries keeps the shell's escaping of that option (`'\''\$\$ORIGIN/../lib'\''`). |

Not passed, on purpose: `--enable-chromaprint` and `--enable-libzvbi` (the GPL code in BtbN's build; SOURCE.md, "BtbN's build, before 2026-10-27"), `--enable-openssl` and `--enable-libopencore-amr*` (Apache-2.0 in libavcodec, which Taalcut has no use for: it reads and writes local files and pipes only, `-protocol_whitelist file`, and decodes AMR with FFmpeg's own decoder), every other external library BtbN's build had (`libkvazaar` among them: like the Mac's, this build has no CPU HEVC encoder, and transfer's 1,000-item import test stream-copies a committed HEVC clip instead), `--enable-lcms2` (the Mac doesn't either; lcms2 is linked only into libplacebo), and LTO.

### The libraries' own builds

All static (`.a`) and position-independent (`-fPIC`, `-Db_staticpic=true`, `CMAKE_POSITION_INDEPENDENT_CODE`), because they end up inside FFmpeg's shared libraries. Release builds, no `-g`, no `-march`.

- zlib: `./configure --static`, `libz.a` only.
- Vulkan-Headers, SPIRV-Headers: headers. Vulkan-Loader: a shared build with no window-system support, in the prefix only to link against; it is not shipped. `SYSCONFDIR=/etc`.
- lcms2: `--without-jpeg --without-tiff`; the GPL-3 plugins under `plugins/` are not built.
- zimg: `autogen.sh`, static.
- glslang: `ENABLE_OPT=OFF`, `ALLOW_EXTERNAL_SPIRV_TOOLS=OFF`, static libraries plus the `glslang` binary (FFmpeg's shader compiler at build time).
- libplacebo: the Mac's options (adjustments 3, 7 and 8 above) with `-Dvk-proc-addr=enabled` linking the loader. The same `find_library` fix.
- OpenH264: `make install-static OS=linux ARCH=x86_64` (its Makefile adds `-fPIC`).
- dav1d: Meson, `-Denable_tools=false -Denable_tests=false`.
- SVT-AV1: `BUILD_APPS=OFF`, `EXCLUDE_HASH=ON` (no git hash, and `REPRODUCIBLE_BUILDS`), `SVT_AV1_LTO=OFF` (LTO objects inside a shared library would tie the link to this compiler's plugin), `NATIVE=OFF`.
- C++ runtime: every `-lstdc++` in the prefix's `.pc` files becomes `-l:libstdc++.a -lm` (the archive doesn't name the libm it calls, as `libstdc++.so.6` does), and libplacebo's `.pc` gains both after the glslang archives, so glslang, libplacebo's C++ parts, zimg and OpenH264 carry GCC 11's libstdc++ inside the libraries (under the GCC Runtime Library Exception) and nothing needs `libstdc++.so.6`.
- `.pc` archive paths: libplacebo's `.pc` names the glslang archives by absolute path. FFmpeg's `configure` takes any word that is neither `-l…` nor a `.so` for a flag and puts it before the objects in its link tests, where GNU ld drops archives, so every `<prefix>/lib/libNAME.a` there becomes `-lNAME` (the prefix has only archives, apart from the loader).

### Environment and paths

`SOURCE_DATE_EPOCH` from `versions.env`, `TZ=UTC`, `LC_ALL=C`, `PYTHONHASHSEED=0`, `GIT_CEILING_DIRECTORIES` at the build tree (and no git in the image), so no date, hash randomisation or git describe reaches the bytes. GNU `ar` is deterministic on Ubuntu, and the build ID is a hash of the linked contents. The container mounts `tools/ffmpeg` read-only at `/taalcut-ffmpeg/tools`, the tarballs at `/taalcut-ffmpeg/sources` and the build tree at `/taalcut-ffmpeg/.build`, so every path the compilers see is the same on every host. The only `/taalcut-ffmpeg` strings are the configure line (in each library and binary), the unused data directory (in the binaries), `__FILE__` of libplacebo's `libav_internal.h` in libavfilter, as on the Mac, and 60 `__FILE__` paths of SVT-AV1's sources under `/taalcut-ffmpeg/.build/work/svt-av1` in libavcodec (its log and assert messages). All are the container's fixed paths, the same on every host. `check-paths.sh` runs on the binaries, the libraries and the uncompressed shaders and PTX kernels.
