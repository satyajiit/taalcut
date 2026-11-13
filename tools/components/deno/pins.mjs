// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Deno's notice is generated from (notice.mjs), and the decisions a person reviewed. The texts these name are
 * resolved to urls, sizes and sha256s by discover.mjs into licences.json, and the build fetches them by those pins.
 * Bumping Deno: change DENO (the tag's commit, its archive fetched twice to check it is stable, the toolchain its
 * rust-toolchain.toml names), run discover.mjs, review what changed in licences.json and in the checks the build
 * fails on (a new native crate, a crate with no licence file, a new copyright holder in Deno's own source), then
 * build.
 */

export const DENO = {
  version: '2.9.6',
  /** The v2.9.6 tag's commit. */
  commit: 'e518fbd66dda5debcbdefc0beb0b3756b37b64fa',
  source: {
    url: 'https://codeload.github.com/denoland/deno/tar.gz/e518fbd66dda5debcbdefc0beb0b3756b37b64fa',
    size: 32726352,
    sha256: '58de72aabd2686284528259e4b268b9d3d38e628743ac1ac422b13f0e7619db7',
  },
  package: 'deno',
  target: 'aarch64-apple-darwin',
  /** rust-toolchain.toml at that commit; the build checks it. */
  toolchain: '1.95.0',
};

/**
 * The standard library every Rust binary links, from that toolchain's rust-src: `std` with the features the
 * distributed std is built with. RUSTC_BOOTSTRAP lets stable cargo read the library's own workspace.
 */
export const RUST_STD = {
  root: 'std',
  features: ['backtrace', 'panic-unwind'],
  /** The licence of the rust-lang/rust repository, which the library's own crates (path crates) are under. */
  repository: {
    url: 'https://github.com/rust-lang/rust.git',
    ref: '1.95.0',
    files: ['COPYRIGHT', 'LICENSE-APACHE', 'LICENSE-MIT'],
  },
};

/**
 * Crates whose Cargo.toml names no GitHub repository, or which were published without a commit: where their licence
 * files are. Checked by hand: the commit is the one .cargo_vcs_info.json names, or the version bump's.
 */
export const UPSTREAM_REPOS = {
  'aead-gcm-stream@0.4.0': { repo: 'littledivy/aead-gcm-stream' },
  'cranelift-assembler-x64@0.117.2': { repo: 'bytecodealliance/wasmtime' },
  'dlopen2@0.6.1': {
    repo: 'OpenByteDev/dlopen2',
    ref: '8580a7c1eafad6507b6c5fd37cb2e404af7e214d',
    path: 'dlopen2',
  },
  'zune-core@0.4.12': { repo: 'etemesi254/zune-image' },
};

/**
 * Crates that compile or link native code (a `links` key or a native build dependency): the licence files of the
 * code they build in, as paths inside the crate, and why. Every native crate deno links must be here; an entry for
 * a crate it no longer links fails the build too.
 */
export const NATIVE = {
  'aws-lc-rs': { paths: [], why: "Rust bindings; the C is aws-lc-sys's" },
  'aws-lc-sys': {
    paths: ['aws-lc/LICENSE', 'aws-lc/third_party/fiat/LICENSE'],
    why: 'AWS-LC (from BoringSSL and OpenSSL), its LICENSE listing and quoting every library compiled in; fiat-crypto',
  },
  cdivsufsort: { paths: ['c-sources/LICENSE'], why: 'libdivsufsort, compiled from c-sources' },
  deno_node: { paths: [], why: "its own C (Deno's)" },
  'lcms2-sys': { paths: ['vendor/LICENSE'], why: 'Little CMS, built from vendor/ (the static feature)' },
  'libdeflate-sys': { paths: ['libdeflate/COPYING'], why: 'libdeflate' },
  'libffi-sys': { paths: ['libffi/LICENSE'], why: 'libffi (LICENSE-BUILDTOOLS covers build scripts only)' },
  'liblzma-sys': {
    paths: ['xz/COPYING', 'xz/COPYING.0BSD'],
    why: 'liblzma from xz (0BSD; COPYING says which xz parts are under what)',
  },
  libnghttp2: {
    paths: ['nghttp2/COPYING'],
    why: 'nghttp2’s library (its apps and third-party/ are not built)',
  },
  'libsqlite3-sys': {
    paths: [],
    why: 'SQLite (bundled feature) is in the public domain; sqlcipher/ is not built',
  },
  'libuv-sys-lite': {
    paths: [],
    why: 'bindings only: libuv symbols are looked up at run time, none is built in',
  },
  'libz-sys': {
    paths: ['src/zlib-ng/LICENSE.md'],
    why: 'zlib-ng (the zlib-ng feature; src/zlib is not built)',
  },
  psm: { paths: [], why: 'its own assembly, under its own licence' },
  'rayon-core': { paths: [], why: 'a links key only, no native code' },
  stacker: { paths: [], why: 'its own C, under its own licence' },
  v8: { paths: [], why: "rusty_v8's prebuilt static library: V8 and what it compiles in (the V8 section)" },
  'zstd-sys': {
    paths: ['zstd/LICENSE'],
    why: "zstd (BSD-3-Clause, the BSD option of zstd's BSD or GPL-2.0)",
  },
};

/**
 * The licence files of what rusty_v8 150.4.0's static library compiles in, with its GN arguments (.gn) on macOS
 * arm64: `repo` is a submodule path in denoland/rusty_v8 at the v8 crate's commit ('' is rusty_v8 itself), `files`
 * are paths in that repository; or a `url` where the code's own repository has none. Reviewed against V8's BUILD.gn at that commit; the Rust crates of its Temporal
 * support come from the v8 crate's own BUILD.gn files (gn.mjs).
 */
export const V8_FILES = [
  { repo: '', files: ['LICENSE'], why: "rusty_v8's own code (src/binding.cc, the inspector glue)" },
  {
    repo: 'v8',
    files: ['LICENSE', 'LICENSE.fdlibm', 'LICENSE.strongtalk', 'LICENSE.v8'],
    why: 'V8, and the fdlibm and Strongtalk code in it',
  },
  {
    repo: 'v8',
    files: ['third_party/glibc/LICENSE'],
    why: "glibc's sin/cos (IBM Accurate Mathematical Library), LGPL-2.1-or-later: v8_use_libm_trig_functions = is_clang",
  },
  { repo: 'v8', files: ['third_party/inspector_protocol/LICENSE'], why: 'the inspector protocol (crdtp)' },
  { repo: 'v8', files: ['third_party/rapidhash-v8/LICENSE'], why: 'rapidhash' },
  { repo: 'v8', files: ['third_party/siphash/LICENSE'], why: 'halfsiphash.cc' },
  { repo: 'v8', files: ['third_party/utf8-decoder/LICENSE'], why: 'the UTF-8 decoder' },
  { repo: 'v8', files: ['third_party/valgrind/LICENSE'], why: 'valgrind.h' },
  { repo: 'v8', files: ['third_party/wasm-api/LICENSE'], why: 'the WebAssembly C API' },
  { repo: 'third_party/abseil-cpp', files: ['LICENSE'], why: 'Abseil (v8_abseil)' },
  { repo: 'third_party/dragonbox/src', files: ['LICENSE-Apache2-LLVM', 'LICENSE-Boost'], why: 'Dragonbox' },
  {
    repo: 'third_party/fast_float/src',
    files: ['LICENSE-APACHE', 'LICENSE-BOOST', 'LICENSE-MIT'],
    why: 'fast_float',
  },
  { repo: 'third_party/fp16/src', files: ['LICENSE'], why: 'FP16' },
  { repo: 'third_party/highway/src', files: ['LICENSE'], why: 'Highway (libhwy)' },
  { repo: 'third_party/icu', files: ['LICENSE'], why: 'ICU (v8_enable_i18n_support), its data built in' },
  { repo: 'third_party/libc++/src', files: ['LICENSE.TXT'], why: 'libc++ (use_custom_libcxx)' },
  { repo: 'third_party/libc++abi/src', files: ['LICENSE.TXT'], why: 'libc++abi' },
  { repo: 'third_party/llvm-libc/src', files: ['LICENSE.TXT'], why: "LLVM's libc, which libc++ uses" },
  {
    url: 'https://raw.githubusercontent.com/chromium/chromium/152.0.7977.30/LICENSE',
    file: 'LICENSE (Chromium)',
    why: "PartitionAlloc, which is Chromium's and under Chromium's LICENSE (its repository has no licence file)",
  },
  { repo: 'third_party/simdutf', files: ['LICENSE'], why: 'simdutf' },
];

/** V8's Temporal support, as V8's BUILD.gn names it (v8_maybe_temporal). */
export const V8_TEMPORAL = '//third_party/rust/temporal_capi';

/**
 * Third-party code inside Deno's own crates, known by the copyright lines in its files' first comment (embedded.mjs):
 * a holder (a pattern over such a line) and the licence texts its notices refer to (EMBEDDED_TEXTS). A line no entry
 * matches is accepted only when its comment says MIT or carries the MIT permission text (then the MIT text applies);
 * any other fails the build. The notice quotes every such comment as it stands, then these texts.
 */
export const EMBEDDED = [
  {
    holder: /Microsoft Corporation\. All rights reserved/,
    texts: ['typescript', 'typescriptThirdParty'],
    what: 'TypeScript 6.0.3 and its lib files',
  },
];

/** The texts EMBEDDED names, by id; discover.mjs pins their sizes and sha256s. */
export const EMBEDDED_TEXTS = {
  mit: {
    title: 'The MIT License (SPDX license list v3.29.0)',
    url: 'https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text/MIT.txt',
  },
  typescript: {
    title: 'TypeScript LICENSE.txt (Apache-2.0), tag v6.0.3',
    url: 'https://raw.githubusercontent.com/microsoft/TypeScript/v6.0.3/LICENSE.txt',
  },
  typescriptThirdParty: {
    title: 'TypeScript ThirdPartyNoticeText.txt, tag v6.0.3',
    url: 'https://raw.githubusercontent.com/microsoft/TypeScript/v6.0.3/ThirdPartyNoticeText.txt',
  },
};
