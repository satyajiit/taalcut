// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** How far apart two reads of the same frame are: the frame-sets and analysis-pass parity tests. */

/** The largest byte difference (−1 when either is missing or the lengths differ). */
export function maxByteDifference(a: Buffer | undefined, b: Buffer | undefined): number {
  if (!a || !b || a.length !== b.length) return -1;
  return a.reduce((max, value, i) => Math.max(max, Math.abs(value - (b[i] ?? 0))), 0);
}

/** The share of bytes that differ (1 when either is missing or the lengths differ). */
export function differingShare(a: Buffer | undefined, b: Buffer | undefined): number {
  if (!a || !b || a.length !== b.length) return 1;
  return a.reduce((count, value, i) => count + (value === b[i] ? 0 : 1), 0) / a.length;
}
