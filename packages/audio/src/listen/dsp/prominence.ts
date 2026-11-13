// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How much an event stands out (earshot detect_events, after the merge): prominence is the loudest K-weighted 10 ms
 * power in the 80 ms after the attack minus the bed, the median of 300 to 20 ms before (the 10th percentile of the
 * next 2 s when there is no such stretch), floored at −80 dB; an event that starts the file has the −80 floor as its
 * bed. Also the event's sample peak and the momentary loudness at its time.
 */
import { LISTEN_SR, db, pyRound, roundTo, type Stereo } from './pcm';
import { maxOf, median, percentile } from './stats';

export interface Prominence {
  readonly prominenceDb: number;
  /** Rounded to 0.1 dB, as upstream stores it. */
  readonly bedDb: number;
}

/** `kw` is kWeightedEnvelopeDb (1 ms steps); `t` the attack (s). */
export function prominenceAt(kw: Float64Array, t: number, startsFile: boolean): Prominence {
  const j = pyRound(t * 1000);
  const preFrom = Math.max(0, j - 300);
  const preTo = Math.min(kw.length, Math.max(0, j - 20));
  let bed: number;
  if (startsFile) {
    bed = -80;
  } else {
    const fallback = () => percentile(kw.subarray(0, Math.min(kw.length, j + 2000)), 10);
    bed = Math.max(preTo - preFrom >= 20 ? median(kw.subarray(preFrom, preTo)) : fallback(), -80);
  }
  const prominenceDb = j < kw.length ? Math.max(0, maxOf(kw, j, Math.min(kw.length, j + 80)) - bed) : 0;
  return { prominenceDb, bedDb: roundTo(bed, 1) };
}

/** The sample peak (dBFS, 0.1) over the event's first max(50 ms, min(length, 300 ms)). */
export function eventPeakDbfs(x: Stereo, t: number, lengthMs: number): number {
  const a = Math.trunc(t * LISTEN_SR);
  const b = a + Math.trunc(Math.max(0.05, Math.min(lengthMs / 1000, 0.3)) * LISTEN_SR);
  const end = Math.min(x.length, Math.max(b, a + 1));
  let peak = 0;
  for (let i = a; i < end; i++) peak = Math.max(peak, Math.abs(x.left[i] ?? 0), Math.abs(x.right[i] ?? 0));
  return roundTo(db(peak), 1);
}

/** `np.interp(t, xs, ys)`: linear, clamped at the ends. */
export function interp(t: number, xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  if (t <= (xs[0] ?? 0)) return ys[0] ?? 0;
  if (t >= (xs[n - 1] ?? 0)) return ys[n - 1] ?? 0;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] ?? 0;
  const x1 = xs[hi] ?? 0;
  const y0 = ys[lo] ?? 0;
  const y1 = ys[hi] ?? 0;
  return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
}
