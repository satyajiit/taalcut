// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The render engine, the C2PA sidecar, the reference fetcher and the sound packs (manifest.render, .reference-fetcher and .voice-music). */
import { COPYLEFT_SOURCES, YT_DLP } from '../../yt-dlp/pins.mjs';
import { TEXTS } from '../texts.mjs';
import { NOTARISED, UNCHANGED } from './common.mjs';

/** deno 2.9.6's Cargo.lock: the MPL-2.0 crates linked into deno (cargo metadata for aarch64-apple-darwin), and
 * cssparser-macros, the procedural macro cssparser is compiled with. */
const DENO_MPL_CRATES = [
  ['cooked-waker', '5.0.0', 11317, '147be55d677052dabc6b22252d5dd0fd4c29c8c27aa4f2fbef0f94aa003b406f'],
  ['cssparser', '0.36.0', 56357, 'dae61cf9c0abb83bd659dab65b7e4e38d8236824c85f0f804f173567bda257d2'],
  ['cssparser-macros', '0.6.1', 7914, '13b588ba4ac1a99f7f2964d24b3d896ddc6bf847ee3855dbd4366f058cfcd331'],
  ['dtoa-short', '0.3.5', 8287, 'cd1511a7b6a56299bd043a9c167a6d2bfb37bf84a6dfceaba651168adfb43c87'],
  ['smartstring', '1.0.1', 29555, '3fb72c633efbaa2dd666986505016c32c3044395ceaf881518399d2f4127ee29'],
  ['webpki-root-certs', '0.26.6', 175644, 'e8c6dfa3ac045bc517de14c7b1384298de1dbd229d38e08e169d9ae8c170937c'],
  ['webpki-roots', '0.26.1', 249748, 'b3de34ae270483955a94f4b21bdaaeb83d508bb84a01435f393818edb0012009'],
];

const crateSource = ([name, version, size, sha256]) => ({
  file: `source/crates/${name}-${version}.crate`,
  what: `${name} ${version} (MPL-2.0${name === 'smartstring' ? ' or later' : ''}), crates.io's package, the one deno 2.9.6's Cargo.lock names by this sha256.`,
  pin: { url: `https://static.crates.io/crates/${name}/${name}-${version}.crate`, size, sha256 },
});

/** The v8 crate deno 2.9.6 links: V8's source, glibc's LGPL sin and cos among it (v8/third_party/glibc). */
const V8_CRATE = {
  file: 'source/crates/v8-150.4.0.crate',
  what: "v8 150.4.0, crates.io's package, the one deno 2.9.6's Cargo.lock names by this sha256: rusty_v8 and V8's source, with the glibc sin and cos (LGPL-2.1-or-later) V8 compiles in at v8/third_party/glibc/src.",
  pin: {
    url: 'https://static.crates.io/crates/v8/v8-150.4.0.crate',
    size: 36296166,
    sha256: '42a978ff11f15b24e5c05a7123cf2b68f41e763546699781a924ef4e2cf43a49',
  },
};

/** The reference fetcher's build scripts, at the paths they have in this repository (no tests). */
const YT_DLP_BUILD = {
  paths: [
    'tools/components/yt-dlp',
    'tools/components/hosting/archive.mjs',
    'tools/components/hosting/codesign.mjs',
    'tools/components/hosting/files.mjs',
    'tools/components/hosting/pinned.mjs',
    'packages/tools/src/sandbox/profiles/fetcher.sb',
  ],
  exclude: '\\.test\\.mjs$',
};

const ytDlpSdist = ([name, source]) => ({
  file: `source/${source.file}`,
  what: `${name} ${source.version}, PyPI's source distribution, the one yt-dlp's hash-locked requirements name by this sha256.`,
  pin: source.pin,
});

export const TOOLS = {
  'hyperframes-headless-shell': {
    file: 'chrome-headless-shell-157.0.8103.50-mac-arm64.tar.zst',
    signature: 'taalcut',
    entitlements: {
      'chrome-headless-shell-mac-arm64/chrome-headless-shell': ['com.apple.security.cs.allow-jit'],
    },
    recipe: { kind: 'shell' },
    sources: [
      {
        file: 'source/chromium-157.0.8103.50.tar.xz',
        what: "Chromium 157.0.8103.50's official source release (chromium-browser-official), the source Chrome for Testing's headless shell 157.0.8103.50 is built from, unchanged.",
        pin: {
          url: 'https://commondatastorage.googleapis.com/chromium-browser-official/chromium-157.0.8103.50.tar.xz',
          size: 4513943692,
          sha256: '289ddb3b5e09e19748c07ad7bd5fb3a87ece46832a4aa450483bf65f00382494',
        },
      },
    ],
    notice: {
      changes: [
        "Chrome for Testing's chrome-headless-shell 157.0.8103.50 (mac-arm64 zip, sha256 082e3fe8…63ed), every Mach-O signed by Taalcut with its Developer ID (hardened runtime, secure timestamp; the shell itself with only the com.apple.security.cs.allow-jit entitlement) and repacked as tar.zst by packages/render/scripts/fetch-shell.mjs. Nothing else changed.",
        NOTARISED,
      ],
      extra: [
        'Copyleft pieces: Blink and the parts of WebKit it comes from (LGPL-2.0 and LGPL-2.1, with BSD parts), FFmpeg (LGPL-2.1) and libusbx (LGPL-2.1), and the symphonia Rust crates (MPL-2.0). Their source is in the Chromium source release hosted beside this file (third_party/blink, third_party/ffmpeg, third_party/libusb, third_party/rust/chromium_crates_io/vendor). Everything else is under the permissive licences in LICENSE.headless_shell below.',
      ],
      inArtifact: [
        {
          title: 'LICENSE.headless_shell (Chromium and its third-party licences, from the archive)',
          path: 'chrome-headless-shell-mac-arm64/LICENSE.headless_shell',
        },
      ],
    },
  },
  'c2pa-sidecar': {
    file: 'c2pa-sidecar-1.0.0-darwin-arm64.tar.zst',
    signature: 'taalcut',
    recipe: { kind: 'c2pa', layout: 'stream' },
    sources: [
      {
        file: 'source/c2pa-sidecar-1.0.0-source.tar.zst',
        what: "taalcut-c2pa's source (AGPL-3.0-or-later): native/c2pa-sidecar as it is in Taalcut's repository, with Cargo.lock (every crate it links, by sha256) and build.sh.",
        repo: { paths: ['native/c2pa-sidecar'] },
      },
    ],
    notice: {
      changes: [
        "Built by Taalcut from native/c2pa-sidecar (cargo build --release --locked), signed with its Developer ID (hardened runtime, secure timestamp) and packed as tar.zst with LICENSES/: the c2pa crate's licences, the test certificate's source and the licences of every crate linked in.",
        NOTARISED,
      ],
      extra: [
        "taalcut-c2pa itself is Taalcut's, under the AGPL-3.0-or-later; its source is hosted beside this file. Every crate it links is under a permissive licence (LICENSES/THIRD-PARTY-CRATES.txt below).",
      ],
      inArtifactDir: 'LICENSES',
    },
  },
  deno: {
    file: 'deno-2.9.6-darwin-arm64.tgz',
    signature: { team: '2H4KBF436B' },
    recipe: {
      kind: 'upstream',
      format: 'tar.gz',
      stripComponents: 1,
      pin: {
        url: 'https://registry.npmjs.org/@deno/darwin-arm64/-/darwin-arm64-2.9.6.tgz',
        size: 39597481,
        sha256: '60321cf03244e275589f0d099575bfc739c72ff5aa6e9d19d47d8f0757c24bad',
      },
    },
    sources: [...DENO_MPL_CRATES.map(crateSource), V8_CRATE],
    notice: {
      changes: [
        "npm's @deno/darwin-arm64 2.9.6 package, unchanged: deno is signed and notarised by Deno Land Inc. (Developer ID, team 2H4KBF436B), and Taalcut keeps that signature.",
      ],
      extra: [
        "Copyleft pieces: deno links six Rust crates under the MPL-2.0 (cooked-waker, cssparser, dtoa-short, smartstring, webpki-root-certs, webpki-roots), and cssparser is compiled with the MPL-2.0 procedural macro cssparser-macros. V8, inside the v8 crate's static library, compiles in glibc's sin and cos (the IBM Accurate Mathematical Library), under the LGPL-2.1-or-later. Their exact sources (the crates deno 2.9.6's Cargo.lock names) are hosted beside this file. Deno's own code is under the MIT licence; everything else it links is under permissive licences.",
        "What follows was generated from deno 2.9.6's Cargo.lock by tools/components/deno (notice.mjs): every crate deno links with each of its licence texts, the native code those crates build in, V8 and what it compiles in, the Rust standard library, and the notices of third-party code in Deno's own source. Identical texts are quoted once and numbered.",
      ],
      generated: 'deno',
    },
  },
  'reference-fetcher': {
    file: `yt-dlp-${YT_DLP.version}-darwin-arm64.tar.zst`,
    signature: 'taalcut',
    recipe: {
      kind: 'script',
      command: ['node', 'tools/components/yt-dlp/pack.mjs', '--out', '{stage}'],
      identity: true,
    },
    sources: [
      {
        file: `source/yt-dlp-${YT_DLP.version}.tar.gz`,
        what: `yt-dlp ${YT_DLP.version}'s source, GitHub's archive of the tag's commit ${YT_DLP.commit}: yt-dlp itself (Unlicense), bundle/pyinstaller.py and the hash-locked requirements the build installs.`,
        pin: YT_DLP.source,
      },
      ...Object.entries(COPYLEFT_SOURCES).map(ytDlpSdist),
      {
        file: `source/taalcut-yt-dlp-build-${YT_DLP.version}.tar.zst`,
        what: "Taalcut's build scripts for this file, at their paths in Taalcut's repository: tools/components/yt-dlp (pack.mjs runs the build), the signing and packing helpers it imports and the sandbox profile the build is tested under.",
        repo: YT_DLP_BUILD,
      },
    ],
    notice: {
      changes: [
        `Built by Taalcut from yt-dlp ${YT_DLP.version}'s tagged source the way upstream builds its macOS release (PyInstaller onedir, lazy extractors, upstream's hash-locked requirements), on python-build-standalone's CPython, arm64 only, by tools/components/yt-dlp/pack.mjs. Every Mach-O file is signed with Taalcut's Developer ID (hardened runtime, secure timestamp, no entitlements), and the build was run before it was packed. yt-dlp's own updater is off: Taalcut updates it with the app.`,
        NOTARISED,
      ],
      extra: [
        "This file as a whole is GPL-3.0-or-later (as upstream says of its own executables): it bundles mutagen (GPL-2.0-or-later) and the PyInstaller bootloader (GPL-2.0-or-later with the bootloader exception), and certifi (MPL-2.0). Their exact sources, yt-dlp's own, and the scripts this file was built with are hosted beside it. Every piece and its licence is in LICENSES/INVENTORY.txt below; the other pieces are under permissive licences, whose texts follow.",
      ],
      inArtifactDir: 'LICENSES',
    },
  },
  'silero-vad': {
    file: 'silero_vad.onnx',
    signature: 'none',
    recipe: {
      kind: 'upstream',
      pin: {
        url: 'https://github.com/snakers4/silero-vad/raw/v6.2.3/src/silero_vad/data/silero_vad.onnx',
        size: 2327524,
        sha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
      },
    },
    notice: { changes: UNCHANGED, texts: [TEXTS.sileroVad] },
  },
  'sfx-pack': {
    file: 'sfx-pack-1.0.0.tar.zst',
    signature: 'none',
    recipe: {
      kind: 'script',
      command: ['node', 'tools/audio-packs/build-sfx-pack.mjs', '--out', '{stage}/sfx-pack'],
    },
    notice: {
      changes: [
        'Synthesised for Taalcut by tools/audio-packs/build-sfx-pack.mjs (reproducible); the dedication is inside the archive as LICENCE.txt.',
      ],
      repoTexts: [
        {
          title: 'CC0 1.0 dedication and legal code (tools/audio-packs/CC0-sfx-pack.txt)',
          path: 'tools/audio-packs/CC0-sfx-pack.txt',
        },
      ],
    },
  },
};
