// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What chance gives (earshot timeline `_chance`): the share of times every 5 ms in [lo, hi) that fall within `tol`
 * of one of the sorted event times. A 60 % hit rate means little when chance is 50 %.
 */
import { roundTo } from '../dsp/pcm';
import { searchSorted } from '../dsp/stats';

export const CHANCE_STEP_S = 0.005;

/** `ts` sorted ascending (seconds); 0 without events. Rounded to 3 decimals, as upstream. */
export function chanceShare(ts: readonly number[], lo: number, hi: number, tol: number): number {
  const n = ts.length;
  if (n === 0) return 0;
  // np.arange(lo, hi, 0.005): ceil((hi − lo) / step) values lo + i·step.
  const count = Math.max(0, Math.ceil((hi - lo) / CHANCE_STEP_S));
  if (count === 0) return Number.NaN;
  let within = 0;
  for (let i = 0; i < count; i++) {
    const g = lo + i * CHANCE_STEP_S;
    const k = Math.min(Math.max(searchSorted(ts, g), 1), Math.max(1, n - 1));
    const a = Math.abs(g - (ts[k - 1] ?? 0));
    const b = Math.abs(g - (ts[Math.min(k, n - 1)] ?? 0));
    if (Math.min(a, b) <= tol) within++;
  }
  return roundTo(within / count, 3);
}
