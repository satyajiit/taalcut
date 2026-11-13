// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type PerfRow } from './schema';

/** Odd length is the middle value. Even length is the mean of the two middle values. */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty list');
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const right = sorted[mid];
  if (right === undefined) throw new Error('median of an empty list');
  if (sorted.length % 2 === 1) return right;
  const left = sorted[mid - 1];
  if (left === undefined) throw new Error('median of an empty list');
  return (left + right) / 2;
}

/**
 * Most recent first. Later `date` wins. When dates tie, later file order is more recent.
 */
export function mostRecent(rows: readonly PerfRow[], count: number): PerfRow[] {
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((left, right) => {
    if (left.row.date !== right.row.date) return left.row.date < right.row.date ? 1 : -1;
    return right.index - left.index;
  });
  return indexed.slice(0, Math.max(0, count)).map((entry) => entry.row);
}

/**
 * Median of the last 7 history rows with the same runner, metric, and footage, leaving out noisy rows.
 * `history` is previous rows only. Undefined when none match.
 */
export function baselineOf(history: readonly PerfRow[], row: PerfRow): number | undefined {
  const matches = history.filter(
    (item) =>
      item.runner.id === row.runner.id &&
      item.metric === row.metric &&
      item.footage === row.footage &&
      item.noisy === undefined,
  );
  if (matches.length === 0) return undefined;
  const recent = mostRecent(matches, 7);
  return median(recent.map((item) => item.value));
}

/**
 * Fractional change in the bad direction. Exactly 10% does not regress; only worseBy > 0.10 does.
 * A zero baseline has no ratio: no change stays 0, a worse value is infinite, a better value stays 0.
 */
export function regressionOf(
  baseline: number,
  value: number,
  better: 'lower' | 'higher',
): { worseBy: number; regresses: boolean } {
  let worseBy: number;
  if (baseline === 0) {
    const worse = better === 'lower' ? value > 0 : value < 0;
    worseBy = value === 0 ? 0 : worse ? Number.POSITIVE_INFINITY : 0;
  } else if (better === 'lower') {
    worseBy = (value - baseline) / baseline;
  } else {
    worseBy = (baseline - value) / baseline;
  }
  return { worseBy, regresses: worseBy > 0.1 };
}
