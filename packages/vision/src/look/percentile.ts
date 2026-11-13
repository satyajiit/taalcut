// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Linear-interpolated percentile of values already sorted ascending (rank `p · (n − 1)`).
 * An empty list is 0; one value is itself.
 */
export function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const first = sorted[0];
  if (n === 0 || first === undefined) return 0;
  if (n === 1) return first;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const t = rank - lo;
  return (sorted[lo] ?? first) * (1 - t) + (sorted[hi] ?? first) * t;
}
