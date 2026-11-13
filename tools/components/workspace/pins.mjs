// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the workspace shell's toolchain components are made from (AGT2 sbx; packages/tools src/shell/toolchain.ts
 * names the ids and where each one's programs are). Every byte comes from a pin: a url, its size and its sha256.
 * Bumping a pin is a new component version; a new wheel or package also reviews its licence below, and a build
 * fails on any bundled piece the review doesn't cover.
 */
import { PYTHON as YT_DLP_PYTHON } from '../yt-dlp/pins.mjs';

/** Node 24 (LTS), nodejs.org's build: signed and notarised by the Node.js Foundation, and kept so. */
export const NODE = {
  version: '24.22.2',
  team: 'HX7739G8FX',
  'darwin-arm64': {
    url: 'https://nodejs.org/dist/v24.22.2/node-v24.22.2-darwin-arm64.tar.gz',
    size: 53068959,
    sha256: 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a',
  },
};

/**
 * What the shell keeps of Node's archive: the executable and its licence (which lists everything Node links in).
 * npm, npx and corepack stay out: the shell is offline, and npm is under the Artistic-2.0.
 */
export const NODE_KEEP = ['bin/node', 'LICENSE'];

/**
 * The SPDX expression for Node as kept: Node's own MIT, and what its executable links in (LICENSE in the archive):
 * V8 and zstd (BSD-3-Clause), ICU (Unicode-3.0), zlib (Zlib), OpenSSL, simdjson and swc (Apache-2.0), libuv,
 * llhttp, c-ares, nghttp2, ngtcp2, nghttp3, undici and acorn (MIT), base64 and others (BSD-2-Clause), heapdump and
 * rimraf (ISC), minimatch (BlueOak-1.0.0) and HdrHistogram (CC0-1.0).
 */
export const NODE_SPDX =
  'MIT AND Apache-2.0 AND BSD-3-Clause AND BSD-2-Clause AND ISC AND Unicode-3.0 AND Zlib AND BlueOak-1.0.0 AND CC0-1.0';

/** The same CPython the reference fetcher is built on (python-build-standalone 20261021, 3.14.9). */
export const PYTHON = YT_DLP_PYTHON;

/**
 * The wheels the shell's Python has, installed with --no-deps (each one's requirements are among them), for
 * Python 3.14 on Apple silicon (`module`: the folder it installs). NumPy's macOS 14 wheel uses Accelerate, so it bundles no BLAS and no Fortran
 * runtime. `bundles` names the libraries a wheel carries in its .dylibs folder, all under the licences its
 * licence file quotes.
 */
export const WHEELS = {
  'darwin-arm64': [
    {
      name: 'numpy',
      module: 'numpy',
      version: '2.5.4',
      spdx: 'BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0',
      pin: {
        url: 'https://files.pythonhosted.org/packages/d5/b2/c6ce165acffceb15a82c07b9cc77d391f86b3f379ba62911908ae5d34b91/numpy-2.5.4-cp314-cp314-macosx_14_0_arm64.whl',
        size: 5455617,
        sha256: '956555e0603a4d38019ae6925711cb9dc43195c076a928accf7ea5d50bddfe53',
      },
      bundles: [],
    },
    {
      name: 'pillow',
      module: 'PIL',
      version: '13.0.0',
      spdx: 'MIT-CMU AND BSD-2-Clause AND BSD-3-Clause AND MIT AND Apache-2.0 AND FTL AND IJG AND libpng-2.0 AND libtiff AND Zlib AND 0BSD AND X11',
      pin: {
        url: 'https://files.pythonhosted.org/packages/b5/f4/0bf6f1ac9ba7ee2ffe9914aeb410a1035a0c1a3c42f122388d7fc950bc4b/pillow-13.0.0-cp314-cp314-macosx_11_0_arm64.whl',
        size: 4852269,
        sha256: 'd9b0a2bee3f3e03e9f29057aedb807dbf1e1d96ee1b9d0f422d9db6c8583271d',
      },
      // Pillow's LICENSE quotes each one's licence (FreeType under its FTL, the other choice being the GPL-2.0).
      bundles: [
        'libavif',
        'libbrotlicommon',
        'libbrotlidec',
        'libfreetype',
        'libharfbuzz',
        'libjpeg',
        'liblcms2',
        'liblzma',
        'libopenjp2',
        'libpng16',
        'libsharpyuv',
        'libtiff',
        'libwebp',
        'libwebpdemux',
        'libwebpmux',
        'libXau',
        'libxcb',
        'libz',
      ],
    },
  ],
};

/**
 * Wheels the shell does not have yet, and why: their macOS builds bundle copyleft libraries whose exact sources
 * Taalcut would host beside the component (a review for the owner; see the shell's SPEC section).
 */
export const HELD_WHEELS = {
  'opencv-python-headless': {
    version: '5.0.0.93',
    reason:
      "every macOS arm64 wheel since 4.11 links Homebrew's FFmpeg with x264, x265, libpostproc, vid.stab and Rubber Band (GPL-2.0-or-later), GnuTLS, Nettle, GLib and libidn2 (LGPL), and ZeroMQ (MPL-2.0) into cv2: 99 libraries whose corresponding sources would be hosted beside the component",
  },
};

/** The HyperFrames CLI the Designer's engine matches, with its dependencies from hyperframes-cli.lock.json. */
export const HYPERFRAMES_CLI = {
  version: '0.8.209',
  lock: 'hyperframes-cli.lock.json',
  /** The CLI's own commands, each a shim that runs it on the shell's Node. */
  bins: {
    hyperframes: 'bin/hyperframes.mjs',
    'hyperframes-localize-fonts': 'bin/hyperframes-localize-fonts.mjs',
  },
};

/** The component versions: a pin change is a new version (a hosted key never changes). */
export const VERSIONS = {
  'workspace-node': NODE.version,
  'workspace-python': `${PYTHON.version}-1`,
  'hyperframes-cli': `${HYPERFRAMES_CLI.version}-1`,
};
