// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BS.1770 loudness as earshot computes it (features.loudness_curve, integrated_lufs, lra): K-weighted power summed
 * over the two channels, sliding blocks from sample 0 with a whole-block stride (0.4 s / 0.1 s momentary, 3 s
 * short-term), the −70 LUFS absolute gate, −10 LU relative for integrated, −20 LU and the 10th–95th percentiles of
 * 3 s / 0.1 s blocks for LRA (EBU 3342). Taalcut's `measureBs1770Loudness` is mono with 100 ms sub-blocks and a
 * gated-block LRA; its numbers differ by up to tenths of an LU, so the listening port keeps earshot's (SPEC).
 */
import { LISTEN_SR, type Stereo } from './pcm';
import { kWeight } from './filters';
import { percentile } from './stats';

/** Prefix sums of the K-weighted power: per channel (loudness curves) and of their sum per sample (envelopes). */
export interface KPower {
  readonly left: Float64Array;
  readonly right: Float64Array;
  readonly sum: Float64Array;
  readonly length: number;
}

/** K-weights both channels once; every loudness curve and K-weighted envelope of one sound reads these sums. */
export function kPowerOf(x: Stereo): KPower {
  const yl = kWeight(x.left);
  const yr = x.right === x.left ? yl : kWeight(x.right);
  const left = new Float64Array(x.length + 1);
  const right = yr === yl ? left : new Float64Array(x.length + 1);
  const sum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) {
    const a = (yl[i] ?? 0) ** 2;
    const b = (yr[i] ?? 0) ** 2;
    left[i + 1] = (left[i] ?? 0) + a;
    if (right !== left) right[i + 1] = (right[i] ?? 0) + b;
    sum[i + 1] = (sum[i] ?? 0) + (a + b);
  }
  return { left, right, sum, length: x.length };
}

export interface LoudnessCurve {
  /** Block centres, seconds. */
  readonly t: Float64Array;
  /** LUFS per block (unfloored: −0.691 + 10·log10(power + 1e-20)). */
  readonly lufs: Float64Array;
}

/** `features.loudness_curve(x, win, hop)`. */
export function loudnessCurve(k: KPower, win: number, hop: number): LoudnessCurve {
  const pl = k.left;
  const pr = k.right;
  const n = k.length;
  const w = Math.trunc(win * LISTEN_SR);
  const h = Math.trunc(hop * LISTEN_SR);
  if (n < w) {
    const count = Math.max(1, n);
    const ms = ((pl[n] ?? 0) - (pl[0] ?? 0)) / count + ((pr[n] ?? 0) - (pr[0] ?? 0)) / count;
    return {
      t: Float64Array.of(n / LISTEN_SR / 2),
      lufs: Float64Array.of(-0.691 + 10 * Math.log10(ms + 1e-20)),
    };
  }
  const blocks = Math.floor((n - w) / h) + 1;
  const t = new Float64Array(blocks);
  const lufs = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    const s = b * h;
    const ms = ((pl[s + w] ?? 0) - (pl[s] ?? 0)) / w + ((pr[s + w] ?? 0) - (pr[s] ?? 0)) / w;
    t[b] = (s + w / 2) / LISTEN_SR;
    lufs[b] = -0.691 + 10 * Math.log10(ms + 1e-20);
  }
  return { t, lufs };
}

function energyMean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += 10 ** (v / 10);
  return 10 * Math.log10(sum / values.length);
}

/** `features.integrated_lufs`: −70 when every block is gated out. */
export function integratedLufs(k: KPower): number {
  const { lufs } = loudnessCurve(k, 0.4, 0.1);
  const gated = Array.from(lufs).filter((v) => v > -70);
  if (gated.length === 0) return -70;
  const rel = energyMean(gated) - 10;
  const kept = gated.filter((v) => v > rel);
  return kept.length > 0 ? energyMean(kept) : rel + 10;
}

/** `features.lra`: null with fewer than 5 blocks over the gates. */
export function loudnessRange(k: KPower): number | null {
  const { lufs } = loudnessCurve(k, 3.0, 0.1);
  const gated = Array.from(lufs).filter((v) => v > -70);
  if (gated.length < 5) return null;
  const rel = energyMean(gated) - 20;
  const kept = gated.filter((v) => v > rel);
  return kept.length > 4 ? percentile(kept, 95) - percentile(kept, 10) : null;
}
