# Corresponding source

This file describes the source and licence material delivered with the FFmpeg sidecar. The OpenH264 patent
question below is separate from copyright/source compliance.

The `ffmpeg` and `ffprobe` binaries in `dist/` are static links of FFmpeg and the libraries named below. FFmpeg's `ffmpeg -L` text identifies the binary as LGPL version 2.1 or later. `build.sh` passes `--disable-gpl`, `--disable-nonfree`, and `--disable-version3`, and it refuses to finish unless `CONFIG_GPL` and `CONFIG_NONFREE` are 0.

LGPL-2.1 section 6 expects a recipient who receives a program that contains the library to be able to relink the program with a modified library. For this static build, that is `build.sh` plus the pinned tarballs. The script downloads those tarballs, checks SHA-256, builds them, and links `dist/ffmpeg` and `dist/ffprobe`. Versions, URLs, and hashes are in `versions.env`. The same list is copied into `dist/BUILDINFO.json`.

`package-source.mjs` creates an archive of the actual pinned upstream inputs, the build scripts and helpers,
`versions.env`, both platforms' `BUILDINFO.json`, configure/patch documentation and all licence texts. It checks
every source and build-tool pin against the recorded binary inputs before packing. The upstream archives are
included under `tools/ffmpeg/.build/src` with the exact filenames consumed by the build scripts: rebuilding does
not require the upstream source download servers to remain available. The compiler, system SDK and build tools
listed in `README.md` are still required; the Linux container/toolchain setup needs its documented system packages.

The public, immutable archive is recorded by URL, size and SHA-256 in `source-distribution.json`. Ship that file
and this note beside the binaries, and attach the same archive to the manual app release. Keep the source
available for every distributed binary version. A build with changed inputs requires a new source archive; the
record includes both platforms' binary hashes and `BUILDINFO.json` hashes so release packaging can reject stale
source metadata. The scripts alone or an upstream URL are not a substitute for delivering this archive.

To build and upload the archive using the existing component-hosting credentials:

```sh
node tools/ffmpeg/package-source.mjs --out tools/components/.cache/ffmpeg-source --upload
```

Verify the resulting public URL's full SHA-256 before copying the generated `source-distribution.json` into this
directory. To rebuild as a recipient, extract the archive and follow `tools/ffmpeg/README.md`; `.build/src` is
already populated with the verified sources. Modified LGPL libraries and corresponding rebuilds are permitted
under their original licences. Taalcut's recipe files remain AGPL-3.0-or-later, and each upstream source retains
its own copyright and licence notices.

libplacebo is the GitHub archive of tag `v7.360.1` (`haasn/libplacebo`), SHA-256 `d05fdf90bea2f629eaa2d115e909fd356388ac639e54f77b87a018a6d76224bd`. `code.videolan.org` resets the TLS handshake from the build network (`curl` exit 35, connection reset by peer, 213.36.253.9). Archive.org's four captures of the GitLab `libplacebo-v7.360.1.tar.bz2` are Anubis HTML challenge pages, a few kilobytes each, not the archive. That GitLab URL's previously recorded SHA-256 was `937aa5eeea596798b3274d362de2e3bd32bc537a66d149dd85043349c74dffb6`, and those bytes were not obtained. The GitHub archive is the same tag. Its top-level directory is `libplacebo-7.360.1`.

`LICENSES/` holds the upstream licence texts of FFmpeg and of every library whose code is in the binary or is shipped beside it. They are copied, not rewritten. Jinja2 and MarkupSafe are used only while libplacebo generates sources. Their code is not in the binary, so their licence files are not in `LICENSES/`.

## What is in the binary

- FFmpeg 9.0.2, LGPL-2.1-or-later (`LICENSES/FFmpeg-COPYING.LGPLv2.1`).
- libplacebo 7.360.1, LGPL-2.1-or-later, including the vendored fast_float 8.3.1 headers compiled into it (Apache-2.0, Boost, MIT: the three upstream files).
- zimg 3.0.6, WTFPL (`LICENSES/zimg-COPYING`).
- lcms2 2.19.1, MIT. The upstream tree also contains GPL-3 plugins under `plugins/`. `build.sh` configures `--without-jpeg --without-tiff` and does not build those plugins. They are not in the binary.
- glslang commit `168d452a4f460d24b588fed08477a81c44ee27a1` (the revision shaderc v2026.3 records), built with `ENABLE_OPT=OFF` and `ALLOW_EXTERNAL_SPIRV_TOOLS=OFF`. `LICENSES/glslang-LICENSE.txt` is the upstream file unchanged. That file includes a GPL-3 text for optional SPIRV-Tools and test components. Those components are not compiled. The objects that are linked come from the glslang BSD and MIT grants in that file. The same build's `glslang` binary compiles FFmpeg's Vulkan shaders at build time; it is a build tool and is not in the binary, the SPIR-V it writes is.
- SPIRV-Headers `vulkan-sdk-1.4.357.0` (commit `29981f65241605e08b0ede4cfeb999fe3b723c6a`), headers only, for swscale's Vulkan backend. MIT (Khronos), `LICENSES/SPIRV-Headers-LICENSE` and `LICENSES/SPIRV-Headers-MIT.txt` as upstream ships them.
- Vulkan-Headers and Vulkan-Loader `vulkan-sdk-1.4.357.0`. The loader is the static archive (`APPLE_STATIC_LOADER`). Apache-2.0, and the headers' MIT text, as upstream ships them.
- No OpenH264 is linked into the macOS build. H.264 is encoded by the operating system's VideoToolbox framework;
  the hardware path remains first, and `h264_videotoolbox -allow_sw 1 -require_sw 1` selects its software fallback.

## Shipped beside the binary

- MoltenVK 1.4.2, `dist/lib/libMoltenVK.dylib`, thinned to arm64 from the official `MoltenVK-macos.tar` release asset, plus `dist/lib/MoltenVK_icd.json`. Apache-2.0 (`LICENSES/MoltenVK-LICENSE`). It is dlopened by the Vulkan loader. It is not statically linked.

## OpenH264 patents

Cisco's AVC/H.264 patent grant covers the Cisco-provided binary, not a binary compiled from the BSD sources. The grant text is https://www.openh264.org/BINARY_LICENSE.txt. It says the Cisco binary is licensed under Cisco's AVC/H.264 Patent Portfolio License only when, among other conditions, the binary is downloaded separately to the end user's device, the end user can enable or disable it, and the product shows "OpenH264 Video Codec provided by Cisco Systems, Inc." The BSD copyright licence on the source is a different thing and is what `LICENSES/linux-x64/OpenH264-LICENSE` is.

The macOS beta no longer ships the source-built OpenH264 codec. Its FFmpeg build explicitly disables
`libopenh264`, and `verify.sh` rejects that encoder and OpenH264 symbols while exercising both hardware and
system-software H.264 encoding. This removes that bundled-codec distribution question from the macOS candidate;
it is not a claim that every use of H.264 in every market is patent-free.

The Linux build still statically links the pinned BSD sources. That static link does not meet the conditions of
the Cisco binary patent grant, and Linux is outside this beta's supported binary distribution scope.

The v2.6.0 GitHub release body lists official binaries on `ciscobinary.openh264.org`, including both of these, so the published macOS binaries are not x86_64-only:

- http://ciscobinary.openh264.org/libopenh264-2.6.0-mac-arm64.dylib.bz2
- http://ciscobinary.openh264.org/libopenh264-2.6.0-mac-x64.dylib.bz2

A future Linux binary release must choose its own distribution route, such as the official separately downloaded
dynamic library with the required controls and attribution, or establish applicable patent rights. The macOS
choice does not resolve that separate Linux review.

## Linux x64

The linux-x64 build is compiled here too, the same way: `build-linux.sh` downloads the pinned tarballs (`versions.env`, the same FFmpeg 9.0.2 and the same libraries as the Mac where both use them, plus the Linux-only pins below), checks SHA-256, refuses a mismatch, and builds them in a pinned Ubuntu 22.04 container (`linux-x64.Dockerfile`: the base image by digest, the toolchain from Ubuntu's snapshot archive at one instant). Its `-L` text is LGPL version 2.1 or later; `--disable-gpl --disable-nonfree --disable-version3`, and the build stops unless `CONFIG_GPL`, `CONFIG_NONFREE` and `CONFIG_VERSION3` are 0. Every pin is copied into `dist/linux-x64/BUILDINFO.json`.

FFmpeg's seven libraries are shared (`lib/<soname>`) and `ffmpeg` and `ffprobe` load them through their RPATH
`$ORIGIN/../lib`, so a recipient can replace them with modified ones (LGPL-2.1 section 6(b)), or rebuild everything
with `build-linux.sh` and Docker. The same source archive described above includes the Linux recipes, helpers,
licence texts and pinned source/build-tool archives, together with the Linux `BUILDINFO.json`.

### What is in the libraries

Statically linked into FFmpeg's shared libraries. `LICENSES/linux-x64/` holds each upstream text, and its `INDEX.txt` lists them; the .deb ships that folder as `resources/ffmpeg/LICENSES` and FFmpeg's own `COPYING.LGPLv2.1` as `resources/ffmpeg/LICENSE.txt`.

- FFmpeg 9.0.2, LGPL-2.1-or-later.
- libplacebo 7.360.1 (LGPL-2.1-or-later) with fast_float 8.3.1 (Apache-2.0, Boost, MIT), glslang (the Mac's commit and options; its BSD and MIT grants, the GPL-3 parts are not compiled), SPIRV-Headers and Vulkan-Headers (headers only; MIT, Apache-2.0 or MIT), lcms2 2.19.1 (MIT; the GPL-3 plugins are not built), zimg 3.0.6 (WTFPL), OpenH264 2.6.0 (BSD-2-Clause; the patent note above applies; Linux-only): the Mac's pins.
- zlib 1.3.2, Zlib licence.
- dav1d 1.5.4, BSD-2-Clause.
- SVT-AV1 4.2.0, BSD-3-Clause-Clear, with the Alliance for Open Media Patent License 1.0 (`PATENTS.md`), which the BSD-3-Clause-Clear text does not grant. Some of its files are BSD-2-Clause (`LICENSE-BSD2.md`, the libaom-derived code, also under the AOM patent licence) or come from dav1d (BSD-2-Clause, VideoLAN); its bundled fastfeat is BSD-3-Clause. (Its bundled safestringlib, MIT, goes only into the `SvtAv1EncApp` program, which is not built.)
- nv-codec-headers 13.0.19.1, MIT (each header's notice; there is no licence file). Headers only: FFmpeg dlopens NVIDIA's driver libraries at run time.
- GCC 11.4's libstdc++ and libgcc, static (`-l:libstdc++.a`, `-static-libgcc`), under GPL-3.0-or-later WITH GCC-exception-3.1. The runtime exception permits this for code compiled with GCC; it adds no obligation on the FFmpeg libraries' licence.

### Not in them, from the system at run time

- glibc 2.35 or newer.
- The Vulkan loader, `libvulkan.so.1` (Ubuntu's `libvulkan1`, Apache-2.0): libplacebo calls it, so libavfilter names it. The Vulkan-Loader 1.4.357 build in the container is only linked against, not shipped. The GPU's own Vulkan driver (ICD) does the work.
- libva 2.x, `libva.so.2` and `libva-drm.so.2` (MIT, Ubuntu's `libva2` and `libva-drm2`, which the .deb depends on), for VA-API on Intel and AMD, with the `libdrm.so.2` they load and the VA driver libva picks for the GPU. FFmpeg is compiled against 22.04's libva 2.14 headers.
- NVIDIA's `libcuda.so.1`, `libnvcuvid.so.1` and `libnvidia-encode.so.1`, which FFmpeg dlopens only when a CUDA, NVDEC or NVENC path runs. They are part of NVIDIA's driver, not of this build.

Build-only (not in the binaries): GCC, clang 14 (compiles the CUDA kernels to PTX), NASM, CMake 3.31.12, Meson 1.12.1, Ninja, pkg-config, Python with Jinja2 and MarkupSafe for libplacebo's generator, and the glslang binary for FFmpeg's shaders.

### BtbN's build, before 2026-10-27

Until 2026-10-27 the linux-x64 app took BtbN's dated `lgpl-shared` release (`fetch-linux.sh`, `linux-x64.env`, now removed; they are in git history). That build was not LGPL-only as linked: Chromaprint built with FFTW 3.3.11 (GPL-2.0-or-later) sat in `libavformat`, and libzvbi's GPL-2.0-only `packet-830.c` in `libavcodec`, though its `-L` said LGPL-3.0-or-later. Taalcut used neither, and this build has neither: `verify-linux.sh` refuses `--enable-chromaprint` and `--enable-libzvbi` in `-buildconf`, any `fftw`, `vbi_` or `chromaprint_` symbol, and the texts `fftw-3`, `chromaprint` and `zvbi` in the binaries, and `linux-in-container.sh` checks every symbol before it strips. The owner decided on 2026-10-27 to build in-house instead, which closes the question that was open with counsel.
