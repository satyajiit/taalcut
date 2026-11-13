// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 sbx: the workspace shell's toolchain (manifest.workspace.provisional.json), each component built from its
 * pins by tools/components/workspace/pack.mjs. Hosted since 2026-11-11, with Node's upstream signature preserved
 * and the Python/CLI Mach-O files Developer ID-signed and notarised by Matterward Labs.
 */
import { NODE, VERSIONS } from '../../workspace/pins.mjs';
import { CLI_ENGINE, HYPERFRAMES_SOURCE } from '../../workspace/patch-cli-engine.mjs';
import { NOTARISED } from './common.mjs';

const pack = (component) => ({
  kind: 'script',
  command: ['node', 'tools/components/workspace/pack.mjs', '--component', component, '--out', '{stage}'],
  identity: true,
});

export const WORKSPACE = {
  'workspace-node': {
    file: `node-v${NODE.version}-darwin-arm64.tar.zst`,
    // The Node.js Foundation's Developer ID and notarisation, kept (as Deno's are).
    signature: { team: NODE.team },
    recipe: pack('workspace-node'),
    notice: {
      changes: [
        `nodejs.org's node-v${NODE.version}-darwin-arm64.tar.gz (sha256 ${NODE['darwin-arm64'].sha256.slice(0, 8)}…), reduced to bin/node and LICENSE and repacked as tar.zst by tools/components/workspace/pack.mjs. npm, npx and corepack are left out. bin/node is unchanged and keeps the Node.js Foundation's Developer ID signature (team ${NODE.team}) and Apple's notarisation.`,
      ],
      extra: [
        "Node.js is under the MIT licence. Its executable statically links V8, ICU (Unicode-3.0), zlib (Zlib), OpenSSL (Apache-2.0), libuv, llhttp, c-ares, nghttp2, ngtcp2, nghttp3, simdjson, simdutf, ada, brotli, zstd and the other libraries Node's LICENSE below lists with each one's licence text. All are under permissive licences. The LICENSE also quotes npm's, though npm is not in this component.",
      ],
      inArtifact: [{ title: 'LICENSE (Node.js and what it links in, from the archive)', path: 'LICENSE' }],
    },
  },
  'workspace-python': {
    file: 'python-3.14.9-1-darwin-arm64.tar.zst',
    signature: 'taalcut',
    recipe: pack('workspace-python'),
    notice: {
      changes: [
        "python-build-standalone's CPython 3.14.9 (release 20261021, aarch64-apple-darwin install_only_stripped) with NumPy 2.5.4 and Pillow 13.0.0 installed from PyPI's wheels by its own pip, offline and without dependencies. Then pip was removed, every module was compiled to hash-checked bytecode, LICENSES/ was added, and every Mach-O file was signed with Taalcut's Developer ID (hardened runtime, secure timestamp, no entitlements). Packed as tar.zst by tools/components/workspace/pack.mjs. No source file changed.",
        NOTARISED,
      ],
      extra: [
        'CPython is under the Python Software Foundation licence (PSF-2.0, with the CNRI and BeOpen history in LICENSE.cpython.txt). Its extension modules link OpenSSL (Apache-2.0), libffi, expat (MIT), mpdecimal (BSD-2-Clause), libedit, libuuid, zstd (BSD-3-Clause), xz (0BSD), bzip2, zlib, zlib-ng, SQLite (public domain), ncurses (X11) and Tcl/Tk (TCL). NumPy is BSD-3-Clause and uses Apple Accelerate, so it bundles no BLAS. Pillow is MIT-CMU and bundles libjpeg-turbo, libpng, libtiff, libwebp, libavif with dav1d and aom, OpenJPEG, FreeType (under its FTL), HarfBuzz, Little CMS, Brotli, xz, zlib-ng and libxcb. Every one is under a permissive licence, and LICENSES/ below holds each text.',
      ],
      inArtifactDir: 'LICENSES',
    },
  },
  'hyperframes-cli': {
    file: `hyperframes-cli-${VERSIONS['hyperframes-cli']}-darwin-arm64.tar.zst`,
    signature: 'taalcut',
    recipe: pack('hyperframes-cli'),
    sources: [
      {
        file: 'source/hyperframes-53c975966611e7012b09b6d46707c26511ea077d.tar.gz',
        what: 'The upstream preferred TypeScript source at the CLI npm release gitHead, including CLI and engine 0.8.209, build scripts, package manifests and bun.lock.',
        pin: HYPERFRAMES_SOURCE,
      },
      {
        file: 'source/hyperframes-engine-0.8.209.tgz',
        what: 'The exact published engine package used as the patch build input. Its preferred TypeScript sources are in the pinned upstream repository archive.',
        pin: CLI_ENGINE.source,
      },
      {
        file: `source/taalcut-hyperframes-cli-${VERSIONS['hyperframes-cli']}-complete-source.tar.zst`,
        what: 'Taalcut build and patch source, hash-locked npm inputs, the exact app engine patch, loopback preload, AGPL licence and additional permission. workspace/SOURCE.md describes reproducing the modified CLI.',
        repo: {
          paths: [
            'LICENSE',
            'LICENSE-EXCEPTIONS.md',
            'tools/components/workspace',
            'tools/components/yt-dlp/pins.mjs',
            'tools/components/yt-dlp/inventory.mjs',
            'tools/components/yt-dlp/requirements.mjs',
            'tools/components/hosting/archive.mjs',
            'tools/components/hosting/codesign.mjs',
            'tools/components/hosting/files.mjs',
            'tools/components/hosting/pinned.mjs',
            'patches/@hyperframes__engine@0.8.209.patch',
            'apps/desktop/packaging/licences/GSAP-standard-license.txt',
            'apps/desktop/packaging/licences/GSAP-provenance.json',
          ],
          exclude: '\\.test\\.mjs$',
        },
      },
    ],
    notice: {
      changes: [
        "npm's hyperframes 0.8.209 and its macOS dependencies (workspace/hyperframes-cli.lock.json, each tarball by sha256), unpacked without install scripts. Taalcut replaces the known-hash embedded drawElement service with the app's patched service and ports recoverable paint-timeout handling: current-frame paint waits, Chrome 155+ canvas attributes and preserved source geometry. Other app engine patches are not ported. PATCH-PROVENANCE.json records the inputs and output. sharp is omitted. Added command shims, loopback preload and LICENSES/. esbuild is Developer ID-signed (hardened runtime, secure timestamp). Packed by workspace/pack.mjs as component revision 0.8.209-1.",
        NOTARISED,
      ],
      extra: [
        "Upstream HyperFrames is HeyGen's under Apache-2.0. Its npm dependencies use MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or CC0-1.0; LICENSES/INVENTORY.txt lists them. The CLI also embeds unchanged GSAP 3.15.0 under the GSAP Standard License, whose text is included separately. Taalcut's patch and preload additions are AGPL-3.0-or-later with the included section 7 additional permission; their preferred corresponding source and upstream source are hosted beside this component. Original copyright and licence notices remain in place.",
      ],
      inArtifactDir: 'LICENSES',
    },
  },
};
