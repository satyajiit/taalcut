// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** How far a WebGPU output is from the CPU's for the same input. */
export interface Difference {
  readonly maxAbs: number;
  readonly meanAbs: number;
}

export function difference(a: ArrayLike<number>, b: ArrayLike<number>): Difference {
  if (a.length !== b.length) throw new Error(`lengths differ: ${a.length} vs ${b.length}`);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    sum += d;
    if (d > max) max = d;
  }
  return { maxAbs: max, meanAbs: a.length === 0 ? 0 : sum / a.length };
}

/** Cosine similarity of two vectors of any length (1 = same direction). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Cosine of each vector of `a` to the vector at the same index of `b`. */
export function pairwise(a: readonly Float32Array[], b: readonly Float32Array[]): number[] {
  return a.map((vector, i) => cosine(vector, b[i] ?? new Float32Array(vector.length)));
}

/** Indexes of `candidates` from most to least similar to `query`. */
export function ranking(query: Float32Array, candidates: readonly Float32Array[]): number[] {
  return candidates
    .map((candidate, index) => ({ index, score: cosine(query, candidate) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.index);
}
