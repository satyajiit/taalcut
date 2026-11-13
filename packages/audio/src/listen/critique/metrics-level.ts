// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The level-shape measurements behind the critique (earshot profile.py): energy means, salient hits, stop-downs,
 * the start and end of sound refined on the 2 ms level, the 11-point loudness arc, the longest silent run and the
 * final hit's ring-out. Times in seconds; curves are F6's loudness curves (block centres and LUFS).
 */
import type { LoudnessCurve } from '../dsp/loudness';
import { median, pairwiseSum, percentile } from '../dsp/stats';
import { pyRound } from '../dsp/pcm';
import { ATTACK_FRAME_S, ONSET_HOP, ONSET_SR, attackTimes } from './onsets';
import { pyRoundTo } from '../realness/py-round';

/** profile._energy_mean: 10·log10 of the mean power; null for no values. */
export function energyMean(values: ArrayLike<number>): number | null {
  if (values.length === 0) return null;
  const p = Float64Array.from(values as ArrayLike<number>, (v) => 10 ** (v / 10));
  return 10 * Math.log10(pairwiseSum(p, 0, p.length) / p.length);
}

/** The values of `curve.lufs` whose block centres pass `keep`. */
export function select(curve: LoudnessCurve, keep: (t: number) => boolean): number[] {
  const out: number[] = [];
  curve.t.forEach((t, i) => {
    if (keep(t)) out.push(curve.lufs[i] ?? 0);
  });
  return out;
}

/** profile._windows_min_max: the minimum of the `a` blocks before each block, the maximum of it and `b − 1` after. */
function windowsMinMax(l: Float64Array, a: number, b: number): { pre: Float64Array; post: Float64Array } {
  const n = l.length;
  const pre = new Float64Array(n);
  const post = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = Infinity;
    for (let k = i - a; k < i; k++) lo = Math.min(lo, l[Math.max(0, k)] ?? 0);
    let hi = -Infinity;
    for (let k = i; k < i + b; k++) hi = Math.max(hi, l[Math.min(n - 1, k)] ?? 0);
    pre[i] = lo;
    post[i] = hi;
  }
  return { pre, post };
}

/**
 * profile.salient_hits: the 100 ms level jumps ≥ `jump` dB within 80 ms (over the quietest block of the 200 ms
 * before) that land within `rel` LU of the integrated level; one per run of such blocks, at the run's strongest
 * onset-envelope frame, moved to its attack.
 */
export function salientHits(
  level: LoudnessCurve,
  lufs: number,
  env: Float32Array,
  e2: Float32Array,
  jump = 6.0,
  rel = -8.0,
): number[] {
  const { t: tf, lufs: lf } = level;
  if (lf.length < 20) return [];
  const h = (tf[1] ?? 0) - (tf[0] ?? 0);
  const { pre, post } = windowsMinMax(lf, pyRound(0.2 / h), pyRound(0.08 / h));
  const idx: number[] = [];
  for (let i = 0; i < lf.length; i++) {
    if ((post[i] ?? 0) - (pre[i] ?? 0) >= jump && (post[i] ?? 0) >= lufs + rel) idx.push(i);
  }
  if (idx.length === 0) return [];
  const runs: number[][] = [];
  for (const i of idx) {
    const run = runs[runs.length - 1];
    if (run && i - (run[run.length - 1] ?? 0) <= 2) run.push(i);
    else runs.push([i]);
  }
  const out: number[] = [];
  for (const run of runs) {
    const from = (tf[run[0] ?? 0] ?? 0) - 0.05;
    const to = (tf[run[run.length - 1] ?? 0] ?? 0) + 0.1;
    let best = -1;
    let bestT = 0;
    for (let k = 0; k < env.length; k++) {
      const te = (k * ONSET_HOP) / ONSET_SR;
      if (te < from || te > to) continue;
      if (best < 0 || (env[k] ?? 0) > (env[best] ?? 0)) {
        best = k;
        bestT = te;
      }
    }
    const t = best >= 0 ? bestT : (tf[run[0] ?? 0] ?? 0) + 0.03;
    const last = out[out.length - 1];
    if (last === undefined || t - last > 0.1) out.push(t);
  }
  return attackTimes(out, e2);
}

/** A short dip before a hit: where it starts (s), how long (s), how deep (dB). */
export type Stopdown = readonly [start: number, length: number, depthDb: number];

/**
 * profile.stopdowns: dips ≥ `drop` dB under the median of the preceding 2 s for `minS`..`maxS`, back within `back`
 * dB of that median within 0.3 s.
 */
export function stopdowns(level: LoudnessCurve, drop = 10, back = 3, minS = 0.15, maxS = 1.5): Stopdown[] {
  const { t: tf, lufs: lf } = level;
  const n = lf.length;
  if (n < 3) return [];
  const h = (tf[1] ?? 0) - (tf[0] ?? 0);
  const w = pyRound(2.0 / h);
  if (n <= w) return [];
  const out: Stopdown[] = [];
  const backBlocks = pyRound(0.3 / h) + 1;
  const skip = pyRound(0.5 / h);
  let i = w;
  while (i < n) {
    const r = median(lf.subarray(i - w, i));
    if ((lf[i] ?? 0) < r - drop) {
      let j = i;
      while (j < n && (lf[j] ?? 0) < r - drop) j++;
      const len = (j - i) * h;
      let after = -Infinity;
      for (let k = j; k < Math.min(n, j + backBlocks); k++) after = Math.max(after, lf[k] ?? -Infinity);
      if (minS <= len && len <= maxS && j < n && after >= r - back) {
        let low = Infinity;
        for (let k = i; k < j; k++) low = Math.min(low, lf[k] ?? Infinity);
        out.push([pyRoundTo((tf[i] ?? 0) - 0.05, 3), pyRoundTo(len, 3), pyRoundTo(r - low, 1)]);
      }
      i = j + skip;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * profile._edge: the start (`first`) or end of sound found with a 100 ms block centred at `t`, refined to the first
 * (last) 2 ms frame of that block within 20 dB of the loudest 2 ms of the next (previous) 150 ms.
 */
export function edgeOf(e2: Float32Array, t: number, first: boolean, h = ATTACK_FRAME_S): number {
  const a = Math.max(0, Math.trunc((t - 0.05) / h));
  const b = Math.min(e2.length, Math.trunc((t + 0.05) / h) + 1);
  if (b <= a) return Math.max(0, t);
  const reach = Math.trunc(0.15 / h);
  let ref = -Infinity;
  const [r0, r1] = first ? [a, Math.min(e2.length, a + reach)] : [Math.max(0, b - reach), b];
  for (let k = r0; k < r1; k++) ref = Math.max(ref, e2[k] ?? -Infinity);
  const floor = Math.fround(ref - 20);
  let hit = -1;
  for (let k = a; k < b; k++) {
    if ((e2[k] ?? -Infinity) >= floor) {
      hit = k - a;
      if (first) break;
    }
  }
  if (hit < 0) return Math.max(0, t);
  return pyRoundTo((a + (first ? hit : hit + 1)) * h, 3);
}

/** profile._arc: momentary loudness around 0 %, 10 % … 100 % of the film, LU against integrated (0.1 LU). */
export function loudnessArc(momentary: LoudnessCurve, lufs: number, dur: number): (number | null)[] {
  const w = Math.max(1.5, 0.05 * dur);
  return Array.from({ length: 11 }, (_, k) => {
    const sel = select(momentary, (t) => Math.abs(t - (k / 10) * dur) <= w);
    const e = energyMean(sel);
    return e === null ? null : pyRoundTo(e - lufs, 1);
  });
}

/** profile._longest_run. */
export function longestRun(mask: readonly boolean[]): number {
  let best = 0;
  let cur = 0;
  for (const b of mask) {
    cur = b ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/**
 * profile._final_hit_tail: seconds from the strongest onset of the last `look` s of sound to the end of sound, when
 * that onset is a real hit (its strength in the film's top quarter); null when the film just stops or fades.
 */
export function finalHitTail(
  env: Float32Array,
  onsets: readonly number[],
  tEnd: number,
  look = 4.0,
): number | null {
  if (onsets.length === 0) return null;
  const st = onsets.map((t) => {
    const i = Math.min(env.length - 1, Math.max(0, pyRound((t * ONSET_SR) / ONSET_HOP)));
    return env[i] ?? 0;
  });
  let j = -1;
  onsets.forEach((t, k) => {
    if (t >= tEnd - look && t < tEnd && (j < 0 || (st[k] ?? 0) > (st[j] ?? 0))) j = k;
  });
  if (j < 0) return null;
  return (st[j] ?? 0) >= Math.fround(percentile(st, 75)) ? tEnd - (onsets[j] ?? 0) : null;
}
