// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A CLAP embedding as plain JSON (EAR1-B2): base64 of its 512 little-endian float32 values, exact and about a third
 * the size of a number list, for job results and the derived cache.
 */
import { LISTEN_CONFIG } from '../config';

const DIM = LISTEN_CONFIG.clap.embedDim;

export function encodeEmbedding(vector: Float32Array): string {
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
  return bytes.toString('base64');
}

/** Undefined unless it is exactly 512 finite values. */
export function decodeEmbedding(text: string): Float32Array | undefined {
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length !== DIM * 4) return undefined;
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = bytes.readFloatLE(i * 4);
  return out.every(Number.isFinite) ? out : undefined;
}
