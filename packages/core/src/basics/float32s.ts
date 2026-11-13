// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Float32 vectors from bytes: a model file, or a helper's base64 reply. The bytes are copied into a buffer of their
 * own, so the result is aligned whatever offset `bytes` starts at (a Node Buffer is often a slice of a pooled one).
 * Read in the platform's byte order: little-endian on every platform Taalcut builds for (arm64, x64), as the mac
 * helper and the model files write them.
 */

/** Exactly `count` float32 from `bytes`, or undefined when `bytes` holds any other length. */
export function float32sFrom(bytes: Uint8Array, count: number): Float32Array | undefined {
  if (!Number.isInteger(count) || count < 0 || bytes.byteLength !== count * Float32Array.BYTES_PER_ELEMENT)
    return undefined;
  const out = new Float32Array(count);
  new Uint8Array(out.buffer).set(bytes);
  return out;
}
