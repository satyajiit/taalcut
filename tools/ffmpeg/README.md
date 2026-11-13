# FFmpeg LGPL sidecar

Static `ffmpeg` and `ffprobe` for the macOS arm64 app, deployment target 14.0 (`build.sh`, below), and FFmpeg's shared libraries with `ffmpeg` and `ffprobe` for the linux-x64 app, built in a pinned Ubuntu 22.04 container (`build-linux.sh`, [Linux x64](#linux-x64)). Both are LGPL-2.1-or-later, from the same FFmpeg 9.0.2. GPL and nonfree libraries are off. MoltenVK is a separate arm64 dylib next to the Mac binaries, not linked into them.

Corresponding source, pins, and the OpenH264 patent note are in [SOURCE.md](SOURCE.md). Configure flags and the local patches are in [CONFIGURE_FLAGS.md](CONFIGURE_FLAGS.md). Versions and SHA-256 pins are in `versions.env`. `dist/BUILDINFO.json` copies the configure line, the pins, the output hashes, and a two-build comparison when one has been recorded.

## Build

From `tools/ffmpeg`:

```sh
rm -rf .build dist
nice -n 10 ./build.sh
```

`build.sh` downloads the pinned tarballs, checks SHA-256, and refuses a mismatch. A later run reuses `.build/src` when the hash still matches, and it always deletes `.build/prefix`, `.build/work`, and the previous `dist` binaries before compiling. Delete `.build` as well when the run has to start from empty caches.

The directory does not matter. `build.sh` builds under `.build` next to itself, maps that directory to `/taalcut-ffmpeg` in every compile, and keeps absolute paths out of the configure line, so a copy of `tools/ffmpeg` anywhere (another checkout, a temp directory, a CI workspace) produces the same bytes. The path must not contain whitespace. How each path is kept out is in [CONFIGURE_FLAGS.md](CONFIGURE_FLAGS.md#build-paths).

Homebrew supplies build tools only: `meson`, `ninja`, `nasm`, `cmake`, `pkgconf`, `autoconf`, `automake`, `glibtool`, and `python3`. Nothing under `/opt/homebrew` is linked into `dist/ffmpeg` or `dist/ffprobe`. `verify.sh` checks `otool -L`.

The SPIR-V compiler is not a Homebrew tool. FFmpeg compiles its Vulkan shaders while it builds, with the first of `glslc`, `glslang` and `glslangValidator` its `configure` finds on `PATH`. Until 2026-10-25 nothing pinned that, so on the development Mac FFmpeg used Homebrew's `glslc` (shaderc 2026.3), and on a Mac without one every `*_vulkan` filter dropped out and the build stopped at `CONFIG_SCALE_VULKAN_FILTER is not 1`. Now `build.sh` builds the `glslang` binary from the pinned glslang it already builds for libplacebo, links it into `.build/bin` (first on `PATH`), passes `--glslc=glslang` (a name, so no build path reaches the configure line), and stops unless `ffbuild/config.mak` says `GLSLC=glslang` and that name resolves to the pinned build. It also checks every compiled shader (`*.spv`, gzipped in the binary where `check-paths.sh` can't read it) for build paths.

The compile uses every core (`hw.ncpu`). `nice -n 10` keeps it from crowding a GPU measurement on the same machine.

After the link, `normalize-macho.py` writes an `LC_UUID` from the signature-free bytes and ad-hoc signs each binary with identifier `ffmpeg` or `ffprobe` and `--timestamp=none`. That signature is deterministic. It is not the hardened runtime. `ld -no_uuid` and `ld -no_adhoc_codesign` were tried earlier and rejected: the first abort and the second were killed by dyld. See [CONFIGURE_FLAGS.md](CONFIGURE_FLAGS.md).

`dist/` after a successful run:

| Path | Role |
| --- | --- |
| `dist/ffmpeg`, `dist/ffprobe` | Static arm64 binaries, minimum macOS 14.0 |
| `dist/lib/libMoltenVK.dylib` | MoltenVK 1.4.2, arm64 slice of the official universal dylib, 5,305,840 bytes |
| `dist/lib/MoltenVK_icd.json` | ICD. `library_path` is `./libMoltenVK.dylib` |
| `dist/BUILDINFO.json` | Pins, configure line, output hashes, reproducibility |

Set `VK_ICD_FILENAMES` and `VK_DRIVER_FILES` to `dist/lib/MoltenVK_icd.json` before a libplacebo or other Vulkan graph. libplacebo opens the device itself. Do not also pass `-filter_hw_device` at a VideoToolbox `hwdownload`; that sends the download at the Vulkan device and drops the VideoToolbox frames.

The script deletes the FFmpeg work tree at the end. Delete the rest of `.build` after the binaries are checked. On 2026-10-12 the second build's `.build` was about 340 MB during the FFmpeg compile (`du -sh`) and 199,424 KB at exit (prefix 53 MB, source cache 142 MB, work tree already removed). A sample of the true peak was not recorded for either build. Neither observation was over 6 GB.

## Verify

```sh
./verify.sh
```

The script does not modify `dist/`. It checks:

- `ffmpeg -L` contains the Lesser General Public License, version 2.1 or later.
- `-buildconf` has no `--enable-gpl`, `--enable-nonfree`, `--enable-libx264`, `--enable-libx265`, or `--enable-libfdk-aac`.
- Encoders `h264_videotoolbox` and `hevc_videotoolbox` exist and write 160×120 files that `ffprobe` accepts. A separate H.264 encode uses `-allow_sw 1 -require_sw 1` to exercise the system software fallback. `libopenh264` and OpenH264 symbols are forbidden in the macOS build.
- Filters `libplacebo`, `zscale`, `scale_vt`, `transpose_vt`, `yadif_videotoolbox`, `scale_vulkan`, `bwdif_vulkan`, `overlay_vulkan`, and `tonemap` exist.
- Hardware methods `videotoolbox` and `vulkan`.
- `LC_BUILD_VERSION` minimum OS 14.0 on both binaries.
- `otool -L` has no `/opt/homebrew` and no `/usr/local`.
- `check-paths.sh`: `strings -a` of `ffmpeg`, `ffprobe`, `libMoltenVK.dylib`, and `MoltenVK_icd.json` has no `/Users/`, `/home/`, `/private/tmp/`, `/private/var/`, `/var/folders/`, `$HOME`, checkout path, or account name. `build.sh` runs the same check before it writes `BUILDINFO.json`.
- A libplacebo graph creates a Vulkan device through MoltenVK, `scale_vulkan` converts a format on the GPU (swscale's SPIR-V backend, which needs SPIRV-Headers at build time), and a `scale_vt` graph runs.

The 2026-11-11 macOS release build removes OpenH264 and passed the updated `verify.sh`, including real hardware H.264/HEVC, forced software H.264, libplacebo and `scale_vt` checks. Its BUILDINFO does not claim a repeated clean-build comparison.

## Reproducibility

The following October record describes the historical build with OpenH264. It does not certify the November
release rebuild; that build records its own output hashes and comparison evidence in `dist/BUILDINFO.json`.

Three builds on 2026-10-25 produced the same bytes: two from an empty `.build` and `dist` (every source downloaded and checked) in two directories of different depth and length outside any checkout, and one in this checkout. `cmp -s` matched `ffmpeg`, `ffprobe`, `libMoltenVK.dylib`, and `MoltenVK_icd.json`, and the three `BUILDINFO.json` files were identical. `check-paths.sh` passed on all of them and on the 58 compiled shaders. `diffoscope` is not installed. That historical BUILDINFO recorded `reproducibility.matched` and `reproducibility.path_independent` as true. The toolchain was Apple clang 21.0.0 (clang-2100.1.1.101), which `ffmpeg -version` prints; another Xcode can change the bytes.

| File | SHA-256 |
| --- | --- |
| `dist/ffmpeg` | `4d71f0bedc4416d70592bda6fa1b4e663e719c026a3b4a40cd4a7a1b23931c45` |
| `dist/ffprobe` | `d1540d18d51ce9487be54a5b771743ad625a2eba40106f30a8f8ebb8353ab15e` |
| `dist/lib/libMoltenVK.dylib` | `2d6104e391b035d3a512751d2e8e054f6d783ce68ddf6c53611907234ff05193` |

`build.sh` writes `BUILDINFO.json` with `buildinfo.py`, which carries `reproducibility` over when every output's SHA-256 is the record's: from the `BUILDINFO.json` the build replaces (copied aside before the build deletes it), or else from the committed one. So a single run that reproduces these bytes writes the committed file unchanged, and the sha256 the app pins for it stays put. When the bytes differ, the record describes another build: `buildinfo.py` leaves it out and prints which outputs differ. Compare a new pair and write the record again then. `buildinfo.test.mjs` (in `pnpm test:scripts`) checks both cases and, when `dist/` holds this build, that rewriting from it gives the committed file byte for byte.

What keeps the bytes stable: `SOURCE_DATE_EPOCH` from `versions.env`, `ZERO_AR_DATE=1`, `TZ=UTC`, `LC_ALL=C`, `PYTHONHASHSEED=0`, `COPYFILE_DISABLE=1`, and `normalize-macho.py`. What keeps them independent of the directory: `-ffile-prefix-map`, `-fdebug-prefix-map`, and `-fmacro-prefix-map` from `tools/ffmpeg` to `/taalcut-ffmpeg` in every compile, `--prefix=/taalcut-ffmpeg` and no other path in the FFmpeg configure line, and `-DSYSCONFDIR=/etc` for Vulkan-Loader. The only `/taalcut-ffmpeg` strings in `ffmpeg` are the configure line, the unused data directory `/taalcut-ffmpeg/share/ffmpeg`, and two `__FILE__` references to libplacebo's `libav_internal.h`.

## Checking a build by hand

Nothing builds FFmpeg automatically. To check that a clean machine produces the pinned bytes:

1. `brew install meson ninja nasm cmake pkgconf autoconf automake libtool`
2. Delete `tools/ffmpeg/.build` and `tools/ffmpeg/dist`.
3. `nice -n 10 ./tools/ffmpeg/build.sh` in the checkout, wherever it is. No fixed path, no `sudo`.
4. Copy `dist/ffmpeg` and `dist/ffprobe` aside, delete `.build` and `dist`, run `build.sh` again.
5. `shasum -a 256` the two pairs. They should match the table above, and they should match each other.
6. `./tools/ffmpeg/verify.sh`

A release build checks the outputs against the committed `dist/BUILDINFO.json` (`apps/desktop/scripts/check-ffmpeg-dist.mjs`) and runs `verify.sh`.

## Signing

`dist/ffmpeg` as shipped is ad-hoc (`flags=0x2(adhoc)`), identifier `ffmpeg`, TeamIdentifier not set, no hardened runtime, no entitlements. Notarisation will not accept that signature. Production replaces it with Developer ID Application, same Team ID on `ffmpeg`, `ffprobe`, and `libMoltenVK.dylib`, hardened runtime on. That Developer ID signature was not measured here. There is no Developer ID certificate in this run.

Hardened runtime was measured on a temp copy on 2026-10-12 (`codesign -s - -o runtime --force`). The report is `.spikes/07-phone-media/hardened-runtime.txt`. `dist/` was not re-signed.

| Run | Entitlements | Result |
| --- | --- | --- |
| `h264_videotoolbox` encode, 160×120 | none | exit 0, probed `h264` |
| `scale_vt` | none | exit 0 |
| libplacebo | none | exit 187, `VK_ERROR_INCOMPATIBLE_DRIVER` |
| libplacebo after re-signing MoltenVK ad-hoc, host still bare | none | exit 187 |
| libplacebo, VideoToolbox encode, `scale_vt` | `com.apple.security.cs.disable-library-validation` only | exit 0 |

The loader line for the failure is dyld: the code signature in `<12DD3985-CB0F-3D18-A8D2-960940A8356A>` `libMoltenVK.dylib` is not valid for use in the process because the mapping process and the mapped file (non-platform) have different Team IDs. VideoToolbox encode and `scale_vt` do not load that dylib, so they keep working. What is lost without the entitlement, or without a matching Team ID on MoltenVK, is the Vulkan path: libplacebo tone-map and the Vulkan filters.

A later case also added `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory`. It exited 0 as well. The script ran it because a 20-line grep missed the earlier exit 0 under the MoltenVK log. Those two entitlements are not required.

Prefer signing MoltenVK with the same Team ID as `ffmpeg` so library validation can stay on. `disable-library-validation` is the measured fallback when the dylib's signature does not match the process. The official dylib is already ad-hoc signed; `lipo -thin arm64` left that signature in place, and `build.sh` does not re-sign it.

## GPU path

Decode and encode default to VideoToolbox. CPU is the fallback when the hardware path cannot run, and the caller logs the reason.

- Decode: `-hwaccel videotoolbox`. For HEVC Main 10 HLG and the Dolby Vision 8.4 sample, `-hwaccel_output_format videotoolbox_vld` yields `videotoolbox_vld` frames and keeps the colour tags. Measured in spike 07.
- Encode: `h264_videotoolbox` for 8-bit H.264, `hevc_videotoolbox` for HEVC. `h264_videotoolbox -allow_sw 1 -require_sw 1` is the explicit system software H.264 fallback, after `hwdownload,format=p010le,format=yuv420p`. `hwdownload,format=yuv420p` is rejected. There is no LGPL CPU HEVC encoder in this build (`libx265` is off). `ffmpeg -encoders` also lists `h264_vulkan` and `hevc_vulkan`; they were not timed.
- VideoToolbox / Metal filters in this 9.0.2 build: `scale_vt`, `transpose_vt`, `yadif_videotoolbox` (Metal compute). Not present: `overlay_videotoolbox`, `bwdif_videotoolbox`, `tonemap_videotoolbox`, or any other VideoToolbox tone-map filter.
- Vulkan filters: `libplacebo`, `scale_vulkan`, `bwdif_vulkan`, `overlay_vulkan`, `transpose_vulkan`, `avgblur_vulkan`, `blackdetect_vulkan`, `blend_vulkan`, `chromaber_vulkan`, `flip_vulkan`, `gblur_vulkan`, `hflip_vulkan`, `interlace_vulkan`, `nlmeans_vulkan`, `scdet_vulkan`, `v360_vulkan`, `vflip_vulkan`, `xfade_vulkan`, `color_vulkan`.
- HDR to SDR default: libplacebo `tonemapping=bt.2446a` to bt709, with MoltenVK. `scale_vt` converts colour tags on the GPU; on the synthetic HLG clip it tracked an untonemapped 8-bit convert, so it is not the tone-map. CPU `zscale` plus `tonemap=hable` is the fallback when the Vulkan device cannot be created. The `tonemap` filter's algorithms stop at mobius. It has no `bt.2390`. libplacebo does. Numbers are in `docs/spikes/07-phone-media-normalisation.md`.

MoltenVK 1.4.2 is Apache-2.0 (`LICENSES/MoltenVK-LICENSE`), dlopened through the ICD, not statically linked. The FFmpeg binaries are LGPL-2.1-or-later, so they can be conveyed under LGPL-3.0. Apache-2.0 is compatible with GPL-3.0 (and with the AGPL-3.0-or-later app) and is not compatible with GPL-2.0-only. This is not legal advice. Counsel reviews [SOURCE.md](SOURCE.md) before a binary ships. The arm64 dylib is 5,305,840 bytes.

## Linux x64

`build-linux.sh` builds the linux-x64 sidecar into `dist/linux-x64` (gitignored, except `BUILDINFO.json`), the way `build.sh` builds the Mac's: FFmpeg 9.0.2 and the Mac's library pins where both use them, LGPL-2.1-or-later, `--disable-gpl --disable-nonfree --disable-version3`. The host needs Docker and nothing else. Until 2026-10-27 the Linux app shipped BtbN's LGPL build instead; [SOURCE.md](SOURCE.md) says why it no longer does.

```sh
tools/ffmpeg/build-linux.sh                               # 12 CPUs and 16 GB, or fewer CPUs when the machine has fewer
TAALCUT_BUILD_CPUS=6 JOBS=6 tools/ffmpeg/build-linux.sh   # gentler on a shared machine
```

1. It downloads the pinned tarballs into `.build/src` (`TAALCUT_FFMPEG_SOURCES` moves it), checks SHA-256 and refuses a mismatch, a build or source tree on `/data`, and a path with whitespace. A stalled download is dropped and retried.
2. It builds the toolchain image from `linux-x64.Dockerfile` once: `ubuntu:22.04` by digest (`LINUX_BASE_IMAGE`) and the packages in `LINUX_APT_PACKAGES` from Ubuntu's snapshot archive at `LINUX_APT_SNAPSHOT`, so building the image again installs the same package versions. The tag (`taalcut-ffmpeg-build:<hash>`) is a hash of the Dockerfile and those three pins. `TAALCUT_TOOLCHAIN_REBUILD=1` rebuilds it without Docker's layer cache.
3. It runs `linux-in-container.sh` in that image as the calling user, with `--network none`, `--cpus` and `--memory` (`TAALCUT_BUILD_CPUS`, `TAALCUT_BUILD_MEMORY`), and the checkout mounted at fixed paths under `/taalcut-ffmpeg`. The third-party libraries are built static and position-independent into a private prefix, then FFmpeg's seven shared libraries and `ffmpeg` and `ffprobe`. The script stops unless `configure` left GPL, nonfree and version3 off and every component the app needs on, unless `config.mak` carries the RPATH, and if `nm` finds a symbol of a GPL library (FFTW, zvbi, Chromaprint, x264, x265, Rubber Band, frei0r, vid.stab, Xvid, libcdio, postproc) in the unstripped libraries. Then it strips them.
4. It lays out `dist/linux-x64`, copies the licence texts into `LICENSES/linux-x64` (and stops if a text there is from no library it links, or if `INDEX.txt` doesn't name one), checks the compiled shaders and CUDA kernels for build paths, runs `verify-linux.sh --no-gpu`, and writes `BUILDINFO.json` with `buildinfo.py --target linux-x64`.

| Path | Role |
| --- | --- |
| `bin/ffmpeg`, `bin/ffprobe` | `DT_RPATH` `$ORIGIN/../lib`; they need FFmpeg's libraries, libm and libc |
| `lib/libavcodec.so.63`, `libavdevice.so.63`, `libavfilter.so.12`, `libavformat.so.63`, `libavutil.so.61`, `libswresample.so.7`, `libswscale.so.10` | FFmpeg's libraries by soname, with the third-party code static inside them |
| `LICENSE.txt` | FFmpeg's `COPYING.LGPLv2.1` |
| `BUILDINFO.json` | Configure line, pins, toolchain (versions, apt snapshot, a hash of the installed package list), output hashes, reproducibility |

Together the nine files are 43,337,488 bytes (41 MiB); BtbN's shared build was 170 MB. On 2026-10-27, on this 32-thread host capped at 12 CPUs and 16 GB, a build with the image already there took 97 s from start to `BUILDINFO.json`, and building the image without cache added about 7.5 minutes (most of it downloading from the snapshot archive). The container's memory peak (cgroup `memory.peak`, page cache included) was 3.7 GB and 3.9 GB in the two builds below. The build tree (`.build/linux-x64`) is 334 MB afterwards and the sources 155 MB; delete them when the build is checked.

**Shared, not static.** The seven libraries are separate files a recipient can replace, the plain way to meet LGPL-2.1 section 6(b) on Linux, and `ffmpeg` and `ffprobe` share them instead of each carrying them. `DT_RPATH` rather than `DT_RUNPATH`, so an inherited `LD_LIBRARY_PATH` can't put other FFmpeg libraries in front of these. The C++ and GCC runtimes are static (no `libstdc++.so.6`, no `libgcc_s.so.1`), and the newest glibc symbol any file needs is 2.35, Ubuntu 22.04's. What the libraries load from the system:

- `libvulkan.so.1` (libavfilter, for libplacebo; FFmpeg's own Vulkan code dlopens it too). No Vulkan driver ships: the GPU's ICD runs. With the NVIDIA card, the Intel iGPU and llvmpipe present, libplacebo lists them in that order and picks the NVIDIA card (`-v verbose`: "GPU 0: NVIDIA GeForce RTX 4090 … (discrete)"); nothing sets `VK_ICD_FILENAMES` on Linux.
- `libva.so.2` and `libva-drm.so.2` (libavutil, libavcodec, libavfilter), which bring `libdrm.so.2`.
- NVIDIA's `libcuda.so.1`, `libnvcuvid.so.1` and `libnvidia-encode.so.1`, dlopened only when a CUDA, NVDEC or NVENC path runs, so the build starts on a machine without the NVIDIA driver.

`ldd bin/ffmpeg` on the RTX 4090 host (Ubuntu 24.04, driver 615.71):

```
linux-vdso.so.1
libavdevice.so.63 => dist/linux-x64/bin/../lib/libavdevice.so.63
libavfilter.so.12 => dist/linux-x64/bin/../lib/libavfilter.so.12
libavformat.so.63 => dist/linux-x64/bin/../lib/libavformat.so.63
libavcodec.so.63 => dist/linux-x64/bin/../lib/libavcodec.so.63
libswresample.so.7 => dist/linux-x64/bin/../lib/libswresample.so.7
libswscale.so.10 => dist/linux-x64/bin/../lib/libswscale.so.10
libavutil.so.61 => dist/linux-x64/bin/../lib/libavutil.so.61
libm.so.6 => /lib/x86_64-linux-gnu/libm.so.6
libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6
libvulkan.so.1 => /lib/x86_64-linux-gnu/libvulkan.so.1
libva.so.2 => /lib/x86_64-linux-gnu/libva.so.2
/lib64/ld-linux-x86-64.so.2
libva-drm.so.2 => /lib/x86_64-linux-gnu/libva-drm.so.2
libdrm.so.2 => /lib/x86_64-linux-gnu/libdrm.so.2
```

### Verify on Linux

```sh
tools/ffmpeg/verify-linux.sh            # with this host's GPUs
tools/ffmpeg/verify-linux.sh --no-gpu   # what build-linux.sh runs
```

It does not modify `dist/linux-x64`. It checks:

- `ffmpeg -L` is LGPL version 2.1 or later, not version 3 and not nonfree.
- `-buildconf` has `--disable-gpl --disable-nonfree --disable-version3`, and none of `--enable-gpl`, `--enable-nonfree`, `--enable-version3`, `--enable-cuda-nvcc`, `--enable-libnpp`, `--enable-libx264`, `--enable-libx265`, `--enable-libfdk-aac`, `--enable-chromaprint`, `--enable-libzvbi`, `--enable-openssl`, `--enable-libopencore-amrnb`, `--enable-libopencore-amrwb`.
- Encoders `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`, `libopenh264`, `libsvtav1`, `prores_ks` and some of FFmpeg's own; the `libdav1d` decoder; filters `libplacebo`, `zscale`, `scale_cuda`, `transpose_cuda`, `scale_vulkan`, `tonemap`, `hwupload_cuda`; hwaccels `cuda` and `vulkan`, and, since `versions.env` sets `LINUX_FFMPEG_VAAPI=1`, `vaapi` with `h264_vaapi`, `hevc_vaapi` and `scale_vaapi`.
- Each ELF file: no glibc symbol newer than 2.35; `NEEDED` only glibc, `libvulkan.so.1`, `libva.so.2`, `libva-drm.so.2` and FFmpeg's own libraries; RPATH exactly `$ORIGIN/../lib` on the binaries and none on the libraries, no RUNPATH; no dynamic symbol of a GPL library; no `fftw-3`, `chromaprint` or `zvbi` text.
- `ldd bin/ffmpeg`: nothing missing, FFmpeg's libraries from `lib/`, and from the system nothing beyond those and `libdrm.so.2`.
- `check-paths.sh` on all nine files.
- CPU: a 160×120 `libopenh264` encode, a `libsvtav1` encode that `libdav1d` decodes back (30 frames), and `zscale`.
- GPU, without `--no-gpu`: `h264_nvenc`, `hevc_nvenc` and `av1_nvenc` encodes; the zero-copy graph, NVDEC into CUDA frames, `scale_cuda` and `transpose_cuda`, `h264_nvenc` from CUDA frames, with no download (it must come out 360×640); libplacebo, its HLG to BT.709 `bt.2446a` tone-map and `scale_vulkan` on the system loader; and, when the build has VA-API and the host an Intel or AMD render node, an upload, `scale_vaapi` and download round trip and an `h264_vaapi` encode.

Every file is probed with `ffprobe`. On 2026-10-27 against this build, on the RTX 4090 host with the Intel UHD 770 (libva 2.20, Vulkan loader 1.3.275), it printed:

```
== 3 encoders, filters, hwaccels ==
encoders, decoders and filters present; hwaccels: cuda vaapi vulkan
== 4 ELF ==
bin/ffmpeg: glibc 2.34, NEEDED libavdevice.so.63 libavfilter.so.12 libavformat.so.63 libavcodec.so.63 libswresample.so.7 libswscale.so.10 libavutil.so.61 libm.so.6 libc.so.6 RPATH $ORIGIN/../lib
bin/ffprobe: glibc 2.34, NEEDED libavdevice.so.63 libavfilter.so.12 libavformat.so.63 libavcodec.so.63 libswresample.so.7 libswscale.so.10 libavutil.so.61 libm.so.6 libc.so.6 RPATH $ORIGIN/../lib
lib/libavcodec.so.63: glibc 2.35, NEEDED libswresample.so.7 libavutil.so.61 libm.so.6 libva.so.2 libc.so.6 ld-linux-x86-64.so.2
lib/libavdevice.so.63: glibc 2.28, NEEDED libavfilter.so.12 libavformat.so.63 libavcodec.so.63 libavutil.so.61 libc.so.6
lib/libavfilter.so.12: glibc 2.35, NEEDED libswscale.so.10 libavformat.so.63 libavcodec.so.63 libswresample.so.7 libavutil.so.61 libm.so.6 libvulkan.so.1 libva.so.2 libc.so.6 ld-linux-x86-64.so.2
lib/libavformat.so.63: glibc 2.35, NEEDED libavcodec.so.63 libavutil.so.61 libm.so.6 libc.so.6
lib/libavutil.so.61: glibc 2.35, NEEDED libva-drm.so.2 libva.so.2 libm.so.6 libc.so.6
lib/libswresample.so.7: glibc 2.29, NEEDED libavutil.so.61 libm.so.6 libc.so.6
lib/libswscale.so.10: glibc 2.34, NEEDED libavutil.so.61 libm.so.6 libc.so.6
no build paths in 9 files
== 5 CPU ==
libopenh264 160x120 -> h264,160,120
libsvtav1 320x240 -> av1,320,240
libdav1d decoded 30 frames
zscale ok
== 6 NVENC ==
h264_nvenc 320x240 -> h264,320,240
hevc_nvenc 320x240 -> hevc,320,240
av1_nvenc 320x240 -> av1,320,240
== 7 CUDA zero copy ==
h264_nvenc 1280x720 -> h264,1280,720
NVDEC -> scale_cuda -> transpose_cuda -> h264_nvenc: h264,360,640
== 8 Vulkan (system loader) ==
libplacebo, its tone-map and scale_vulkan ok
== 9 VA-API ==
VA-API on /dev/dri/renderD128: round trip ok, h264_vaapi -> h264,320,240
verify ok
```

### Reproducibility on Linux

Two clean builds on 2026-10-27 produced the same bytes: one in this checkout (empty `.build/linux-x64`, the tarballs in `.build/src` checked against `versions.env`), and one in a copy of `tools/ffmpeg` at a path of different depth and length outside any checkout, with every source downloaded again and the toolchain image rebuilt from the snapshot without Docker's cache (`TAALCUT_TOOLCHAIN_REBUILD=1`). Both images installed the same packages (identical `toolchain-packages.txt`; `BUILDINFO.json` keeps its hash). `cmp -s` matched all nine outputs and `LICENSE.txt`, the licence texts were identical, and so were the two `BUILDINFO.json` files. `check-paths.sh` passed on the outputs and the 68 compiled shaders and CUDA kernels. `diffoscope` is not installed. `dist/linux-x64/BUILDINFO.json` fields `reproducibility.matched` and `reproducibility.path_independent` are true. The toolchain was Ubuntu 22.04's GCC 11.4.0, clang 14.0.0, NASM 2.15.05 and binutils 2.38 from snapshot `20261027T000000Z`.

| File | SHA-256 |
| --- | --- |
| `bin/ffmpeg` | `1a64540023df511c011ab2b26b99bdcec711cda87ddc1597090ea25f561dc3ac` |
| `bin/ffprobe` | `0460b4f0ece7f6232db6d615e3243b4456eff45c1cf354b46fe88021645c1cb8` |
| `lib/libavcodec.so.63` | `a971861c077d0e4ef437fd861a6b598ffd37630468af213b90d51f6a398e41a3` |
| `lib/libavdevice.so.63` | `c24083b39802267359a41dd159ed8318a7e88ad7c04e57e59fa77649f907de4f` |
| `lib/libavfilter.so.12` | `2b076e0e9f57f822396a2d3132853d53bf6868edf0a3ebf359fb866f41a3229e` |
| `lib/libavformat.so.63` | `42d65e6edf1059284f842686fba1a319bac0137e7105350fed57f75c69307d67` |
| `lib/libavutil.so.61` | `d6c538f8bfc091398075741343c09881716f86c553fec753ae909511601a0c61` |
| `lib/libswresample.so.7` | `c07c94483d1df1eb9d95046cf72307e8b4435f8ca28fb691639196fef1616af9` |
| `lib/libswscale.so.10` | `6d9c67cc41a32ddab6b9466c849423682592716943ba9f793b26c9f9d435f430` |

`build-linux.sh` writes `BUILDINFO.json` with the same `buildinfo.py` as the Mac (`--target linux-x64`), so the record carries over the same way: kept when every output is the bytes it describes, from the `BUILDINFO.json` the build replaces or else the committed one, and left out, with the differing files named, otherwise. `buildinfo-linux.test.mjs` (in `pnpm test:scripts`) checks both cases, that the committed file is an LGPL-2.1 build of the pins in `versions.env` and, when `dist/linux-x64` holds a build, that its files are the committed bytes.

What keeps the bytes stable: the pinned image (base digest and apt snapshot), `SOURCE_DATE_EPOCH` from `versions.env`, `TZ=UTC`, `LC_ALL=C`, `PYTHONHASHSEED=0`, no git in the image (no `git describe` reaches FFmpeg, SVT-AV1 or dav1d; SVT-AV1 also gets `EXCLUDE_HASH=ON`), and fixed paths: the container always builds under `/taalcut-ffmpeg`, whatever the host directory. [CONFIGURE_FLAGS.md](CONFIGURE_FLAGS.md#linux-x64) lists the paths that do reach the binaries; none is a host path.

### Checking the Linux build

Run `build-linux.sh`; it must leave the committed `BUILDINFO.json` and `LICENSES/linux-x64` unchanged (a build of other bytes rewrites them). Then `verify-linux.sh --no-gpu` and `pnpm check`, where media's `test/pinned-build.test.ts` holds the files to the pin. The GPU half of the verify needs a machine with a GPU.

### GPU path on Linux

What the build has (checked on the RTX 4090 host, driver 615.71, Ubuntu 24.04, with the Intel UHD 770 beside it):

- hwaccels `cuda`, `vaapi`, `vulkan`; encoders `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`, the VA-API and Vulkan encoders, `libopenh264` (CPU H.264) and `libsvtav1` (CPU AV1), and FFmpeg's own `prores_ks`. No CPU HEVC encoder (no `libx265`), as on macOS. Decoders: NVDEC through `-hwaccel cuda`, the `*_cuvid` decoders, and `libdav1d` for AV1 on the CPU (FFmpeg's own `av1` decoder only drives hardware).
- CUDA filters (cuda-llvm) `scale_cuda`, `transpose_cuda`, `hwupload_cuda`, `pad_cuda`, `colorspace_cuda`, `overlay_cuda`, `yadif_cuda`, `bwdif_cuda`, `chromakey_cuda`, `thumbnail_cuda`, `bilateral_cuda`. No `scale_npp` (libnpp is nonfree).
- `libplacebo`, `zscale`, `tonemap`, the Vulkan filters, and the VA-API filters.
- Zero copy works: `-hwaccel cuda -hwaccel_output_format cuda`, then `scale_cuda`/`transpose_cuda`, then NVENC, with no download, as long as the output has no `-pix_fmt` or `-color_*` option (those put a CPU format filter in front of the encoder: "Impossible to convert between the formats"). The colour tags are written by the `h264_metadata`/`hevc_metadata` bitstream filter instead; NVENC leaves transfer and primaries unset otherwise.
- NVENC refuses frames below 146×50 (H.264; "Frame Dimension less than the minimum supported value") and 130×34 (HEVC) on this driver; media sends smaller frames to `libopenh264`.
- The CUDA filters' kernels are PTX, compiled by the driver at first use: 3.4 s per run without a cache, 0.47 s with one (measured with BtbN's build, whose kernels are built the same way). Media passes `CUDA_CACHE_PATH` (default `$HOME/.nv/ComputeCache`) to FFmpeg.
- VA-API works on Ubuntu 24.04's libva 2.20 with the UHD 770 (`/dev/dri/renderD128`): the round trip and `h264_vaapi` above. BtbN's build failed there: its libva stub resolved `vaMapBuffer2`, which libva 2.20 lacks, and every surface operation aborted the process (exit 134). This build links the system libva and is compiled against 22.04's libva 2.14 headers, so it calls nothing libva 2.14 lacks. Media's VA-API row stays off unless the hardware probe names it and its own device trial passes.
- `CUDA_VISIBLE_DEVICES=-1` hides the card: "No device available for decoder: device type cuda needed for codec h264", and NVENC's "cuInit(0) failed -> CUDA_ERROR_NO_DEVICE". Media's software retry recognises both.

NVENC flag sets media builds (`packages/media/src/hw-video/rows/cuda.ts`), each trial-encoded here (3 s, 8 Mb/s, `ffprobe` on the result) with BtbN's build of the same FFmpeg release, before 2026-10-27:

| Purpose | Flags | Result |
| --- | --- | --- |
| proxy | `-preset p2 -tune ll -rc vbr`, bitrate, `-bf 0 -g N` | H.264 High, no B-frames, BT.709 tags, from CUDA frames |
| conform | `-preset p5 -tune hq -rc vbr -cq 19` (HEVC 21), bitrate, `-spatial-aq 1 -temporal-aq 1 -rc-lookahead 20 -bf 0 -g N` | H.264 High / HEVC Main `hvc1`, no B-frames, BT.709 tags, from CUDA or CPU frames |
| export | as conform, with `-bf 3 -b_ref_mode middle` | H.264 High / HEVC Main, `has_b_frames=2` |
| export, HDR | as export, HEVC `-profile:v main10 -pix_fmt p010le`, BT.2020 with HLG or PQ, `hevc_metadata` 9/18/9 or 9/16/9 | HEVC Main 10, `yuv420p10le`, `arib-std-b67` or `smpte2084` |

## Licence obligations

Linux: ship `dist/linux-x64/LICENSE.txt` (FFmpeg's LGPL-2.1 text) and `LICENSES/linux-x64/` (the texts of everything linked into the libraries, listed in its `INDEX.txt`) with the build; the `.deb` carries both. The corresponding-source archive includes the Linux build material described in [SOURCE.md](SOURCE.md): `build-linux.sh` with `linux-in-container.sh`, `linux-x64.Dockerfile`, `check-paths.sh`, `verify-linux.sh` and `buildinfo.py`, `versions.env`, and [CONFIGURE_FLAGS.md](CONFIGURE_FLAGS.md), from which anyone with Docker rebuilds the same bytes. The OpenH264 patent review remains open for Linux. SVT-AV1 comes with the Alliance for Open Media Patent License 1.0 (`SVT-AV1-PATENTS.md`). BtbN's build, which shipped until 2026-10-27, was not LGPL-only as linked; this one is (SOURCE.md).

macOS: Ship [SOURCE.md](SOURCE.md), the verified `source-distribution.json`, and the corresponding-source archive
described there, including all pinned upstream sources and the complete build recipes. `LICENSES/` holds the
upstream texts. The macOS build no longer ships OpenH264: hardware H.264 and its explicit software fallback both use
the operating system's VideoToolbox framework. Linux's separate codec distribution review remains open.
