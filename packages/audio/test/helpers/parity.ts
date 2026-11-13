// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Element-wise distance between two equal-length outputs (WebGPU against CPU). */
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

/** The largest distance from each of `a` to the nearest of `b`, with both lists the same length; else Infinity. */
export function worstMatch(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (const value of a) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of b) nearest = Math.min(nearest, Math.abs(value - other));
    worst = Math.max(worst, nearest);
  }
  return worst;
}
