// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The repo sources (sources.mjs) already hosted, by key: { size, sha256 }. Add a line when a release uploads a new
 * one. A release of that version then fetches these bytes from the public domain instead of packing the repository's
 * current files, which may have changed since; a new version has a new key and packs them afresh.
 */
export const HOSTED_REPO_SOURCES = {
  'hyperframes-cli/0.8.209-1/source/taalcut-hyperframes-cli-0.8.209-1-complete-source.tar.zst': {
    size: 59146,
    sha256: '3b9a25268d8ca4288bb1474b91429ed2353ccb7fedb6f85c592d61aede09635b',
  },
  'local-llm-runtime-mlx/1.0.0/source/taalcut-mlx-server-1.0.0-source.tar.zst': {
    size: 51442,
    sha256: '1d2171327eddccce4d26176a686315c6a6a0a2b9be32b5114bc9e54847fcd170',
  },
  'c2pa-sidecar/1.0.0/source/c2pa-sidecar-1.0.0-source.tar.zst': {
    size: 32018,
    sha256: 'a26f4187f3ba93a8e12b9d889790eaab1aeeb2b87ee2388406317325c212eda4',
  },
  'reference-fetcher/2026.10.21/source/taalcut-yt-dlp-build-2026.10.21.tar.zst': {
    size: 15976,
    sha256: '4ec0027979f668db0b11f8a825cec9de8c5b155b1fc88c2bea73852c10957608',
  },
};
