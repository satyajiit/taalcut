// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The arithmetic of a style profile (LRN1-STY): quartile bands, tallies and fixed rounding. Everything here is
 * pure and order-independent where it should be (a band sorts its values, a tally sorts its rows), so the same set
 * gives the same profile whatever order its members are read in.
 */
import type { StyleBand } from '@taalcut/core';

/**
 * Rounds to `places` decimals, half away from zero, in binary floating point (1.0005 may round down: what matters
 * is that the same input always gives the same output). Never returns -0, which canonical JSON would print as 0
 * while a comparison keeps it apart.
 */
export function round(value: number, places: number): number {
  const factor = 10 ** places;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Seconds to the millisecond. */
export const roundSeconds = (seconds: number): number => round(seconds, 3);
/** A share to three places. */
export const roundShare = (share: number): number => round(share, 3);

/**
 * The p-quantile of sorted values by linear interpolation between closest ranks (R's type 7, numpy's default):
 * h = (n − 1)·p, then x[⌊h⌋] + (h − ⌊h⌋)·(x[⌊h⌋ + 1] − x[⌊h⌋]).
 */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('quantile of no values');
  const h = (sorted.length - 1) * p;
  const lower = Math.floor(h);
  const below = sorted[lower] ?? 0;
  const above = sorted[Math.min(lower + 1, sorted.length - 1)] ?? below;
  return below + (h - lower) * (above - below);
}

/** Quartiles of the values, each rounded with `rounding`; null for no values. */
export function bandOf(
  values: readonly number[],
  rounding: (value: number) => number = roundSeconds,
): StyleBand | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    q1: rounding(quantile(sorted, 0.25)),
    median: rounding(quantile(sorted, 0.5)),
    q3: rounding(quantile(sorted, 0.75)),
  };
}

/** The median of the values, unrounded; null for none. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return quantile(
    [...values].sort((a, b) => a - b),
    0.5,
  );
}

export interface TallyRow<V extends string> {
  readonly value: V;
  readonly count: number;
}

/** How often each value came up, most first, ties by value; values never seen are left out. */
export function tally<V extends string>(values: readonly V[]): TallyRow<V>[] {
  const counts = new Map<V, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/** The most common value of a tally (its first row); null when it is empty. */
export function modeOf<V extends string>(rows: readonly TallyRow<V>[]): V | null {
  return rows[0]?.value ?? null;
}
