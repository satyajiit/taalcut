// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Content hashing (ADR 0001): BLAKE3 identity and the XXH3-128 partial hash, behind a port. */
export {
  createWasmContentHasher,
  hashBytes,
  PARTIAL_SAMPLE_THRESHOLD,
  PARTIAL_WINDOW_BYTES,
  partialWindows,
  sizePrefix,
  type ContentHasher,
} from './content-hasher';
