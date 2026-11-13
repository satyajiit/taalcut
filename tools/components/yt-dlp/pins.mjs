// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the reference fetcher is built from. Bumping yt-dlp (tools/components/README.md, "The reference fetcher"):
 * the newest stable tag's commit and its source archive, then a build; the build fails on any bundled distribution
 * whose declared licence isn't the one reviewed below, so a bump also reviews the licences.
 */

/** yt-dlp's tagged source (the GitHub archive of the tag's commit), with bundle/ and its hash-locked requirements. */
export const YT_DLP = {
  version: '2026.10.21',
  commit: '6ccd977303412151ee23352c6257dd658ffc1987',
  source: {
    url: 'https://codeload.github.com/yt-dlp/yt-dlp/tar.gz/6ccd977303412151ee23352c6257dd658ffc1987',
    size: 3140619,
    sha256: 'd2eb949012dbb1a8e4e7ff06003c0c6c29c01fbccf6dea5d0d04ff79c770e8a7',
  },
};

/**
 * CPython from python-build-standalone (astral-sh, release 20261021): relocatable (no absolute install path, so
 * PyInstaller collects a libpython that loads from @rpath), built from source by a public, pinned pipeline, arm64
 * native, with every C library it links (OpenSSL, libffi, …) listed with its licence in PYTHON.json. 3.14 is the
 * series upstream's own macOS release runs on; every wheel in upstream's lock has a cp314 or abi3 arm64 build.
 * `install` is what the build runs; `full` is read only for PYTHON.json and the licence texts it lists.
 */
export const PYTHON = {
  version: '3.14.9',
  install: {
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.14.9%2B20261021-aarch64-apple-darwin-install_only_stripped.tar.gz',
    size: 26705294,
    sha256: '9f8c3480b8f0db553c270db548e8a21ae8e39df412e5661d66e8050c5c6ed2a8',
  },
  full: {
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261021/cpython-3.14.9%2B20261021-aarch64-apple-darwin-pgo%2Blto-full.tar.zst',
    size: 63579089,
    sha256: '6404c3ca06e7a8abf3bb5247bf359c8f06c3d0e1d0421a6c539b5457cd885537',
  },
};

/** Upstream's hash-locked requirement files, in install order (pip itself first), relative to the source root. */
export const REQUIREMENTS = {
  pip: 'bundle/requirements/pip.txt',
  bundle: ['bundle/requirements/macos.txt', 'bundle/requirements/macos-curl_cffi.txt'],
};

/** Written into yt_dlp/version.py: Taalcut ships updates with the app, so yt-dlp's own -U says so and does nothing. */
export const VARIANT = 'taalcut';
export const UPDATE_HINT =
  'This yt-dlp is part of Taalcut, which updates it with the app; its own updater is off.';

/**
 * Every distribution a build may bundle, with the licence it declares (License-Expression, else License, else its
 * classifiers) and the SPDX expression Taalcut ships it under. `copyleft`: its exact source is hosted beside the
 * build. `bundles` names what a distribution links in that its own metadata doesn't declare.
 */
export const DISTRIBUTIONS = {
  brotli: { declared: 'MIT', spdx: 'MIT' },
  certifi: { declared: 'MPL-2.0', spdx: 'MPL-2.0', copyleft: true },
  cffi: { declared: 'MIT-0', spdx: 'MIT-0' },
  'charset-normalizer': { declared: 'MIT', spdx: 'MIT' },
  curl_cffi: {
    declared: 'MIT',
    spdx: 'MIT',
    bundles:
      'libcurl 8.21.0-IMPERSONATE (curl), BoringSSL (Apache-2.0 AND ISC AND OpenSSL), nghttp2 1.63.0, ngtcp2 1.20.0, nghttp3 1.15.0 (MIT), zstd 1.5.7 (BSD-3-Clause), zlib 1.3.1 (Zlib), brotli 1.2.0 (MIT)',
  },
  idna: { declared: 'BSD-3-Clause', spdx: 'BSD-3-Clause' },
  mutagen: { declared: 'GPL-2.0-or-later', spdx: 'GPL-2.0-or-later', copyleft: true },
  pycparser: { declared: 'BSD-3-Clause', spdx: 'BSD-3-Clause' },
  pycryptodomex: { declared: 'BSD, Public Domain', spdx: 'BSD-2-Clause AND Unlicense' },
  pyinstaller: {
    declared:
      'GPLv2-or-later with a special exception which allows to use PyInstaller to build and distribute non-free programs (including commercial ones)',
    spdx: 'GPL-2.0-or-later WITH Bootloader-exception',
    copyleft: true,
  },
  requests: { declared: 'Apache-2.0', spdx: 'Apache-2.0' },
  typing_extensions: { declared: 'PSF-2.0', spdx: 'PSF-2.0' },
  urllib3: { declared: 'MIT', spdx: 'MIT' },
  websockets: { declared: 'BSD-3-Clause', spdx: 'BSD-3-Clause' },
  'yt-dlp-ejs': {
    declared: 'Unlicense AND MIT AND ISC',
    spdx: 'Unlicense AND MIT AND ISC',
    bundles: 'Meriyah (ISC) and Astring (MIT), JavaScript',
  },
};

/**
 * The exact sources hosted beside the build for its copyleft pieces (inventory.mjs marks them from the build; the
 * build fails unless they are exactly these): PyPI's sdists, each sha256 one of upstream's lock hashes for it.
 * PyInstaller's carries the bootloader's C source, which is the executable's own code.
 */
export const COPYLEFT_SOURCES = {
  certifi: {
    version: '2026.10.19',
    file: 'certifi-2026.10.19.tar.gz',
    pin: {
      url: 'https://files.pythonhosted.org/packages/a6/bd/1436c50cc46699de0230fbaacc1d1de7bfec413176099949e9d5112e88f2/certifi-2026.10.19.tar.gz',
      size: 137598,
      sha256: '035c1e85572b141bf1c3a3eff0e33a8eb74917522f2559075ff8d2fea780a1ae',
    },
  },
  mutagen: {
    version: '1.48.1',
    file: 'mutagen-1.48.1.tar.gz',
    pin: {
      url: 'https://files.pythonhosted.org/packages/df/70/1675da133ea92227da41bf5b24e1c66be597ff736a1533ade41da986852f/mutagen-1.48.1.tar.gz',
      size: 1276978,
      sha256: '8f95637ab9f6f305cec6bd1294e197debe207998e3e068596563c74f86b0a173',
    },
  },
  pyinstaller: {
    version: '6.22.0',
    file: 'pyinstaller-6.22.0.tar.gz',
    pin: {
      url: 'https://files.pythonhosted.org/packages/05/03/669d06735cf57d7e2e5dfc3c2e1643554b34c559eff21449c58172ca0335/pyinstaller-6.22.0.tar.gz',
      size: 4072247,
      sha256: '8b0166fff4583b374bbe7fa044bf03ddc33cab0f792a665807d96048e63f060e',
    },
  },
};

/** PYTHON.json licences that are copyleft: a Python whose bundled libraries name one must not be shipped as is. */
export const COPYLEFT = /\b(A?GPL|LGPL|MPL|EPL|CDDL|EUPL|OSL|Sleepycat)\b/i;
