// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** listen-parity's summaries: null when there was nothing to summarise, so an empty part never passes a bar. */

export function share(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

/** The largest value; NaN (a number missing on one side) wins, so it fails any bar. */
export function maxOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let worst = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (Number.isNaN(v)) return Number.NaN;
    worst = Math.max(worst, v);
  }
  return worst;
}

/** The value at quantile `q` (0..1) of the sorted values, as the parity tests take it; 1 is the maximum. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  if (values.some(Number.isNaN)) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? null;
}
