// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The envelopes the event detector reads (earshot timeline): 1 ms max-abs envelopes of the full signal, its lows
 * (< 200 Hz) and highs (> 2 kHz) for the attack; 10 ms RMS levels (full and highs, smoothed over 90 ms) for swells
 * and level peaks; the K-weighted 10 ms power at 1 ms steps for prominence. Filtering and statistics, CPU work.
 */
import { log10Exact } from './exact-math';
import { butter4, filterWithLeadIn } from './filters';
import type { KPower } from './loudness';
import { LISTEN_SR, type Stereo } from './pcm';
import { pairwiseSum, uniformFilter1d } from './stats';

export type EnvelopeBand = 'full' | 'low' | 'high';

/** 1 ms frames: index i covers samples [48 i, 48 i + 48). */
export type BandEnvelopes = Readonly<Record<EnvelopeBand, Float64Array>>;

const MS = LISTEN_SR / 1000;

function maxAbsEnv(y: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let m = 0;
    for (let i = f * MS; i < (f + 1) * MS; i++) m = Math.max(m, Math.abs(y[i] ?? 0));
    out[f] = m + 1e-7;
  }
  return out;
}

/**
 * The mono signal's highs (> 2 kHz), filtered once: the band envelopes and the level envelopes both run
 * `butter(4, 2000, 'high')` over the same reflected lead-in, so upstream computes the same samples twice.
 */
export function highsOf(mono: ArrayLike<number>): Float64Array {
  return filterWithLeadIn(butter4(2000, 'high'), mono);
}

/** timeline._band_envs(x); `mono` is `to_mono(x)` (float64 in upstream). */
export function bandEnvelopes(x: Stereo, mono: ArrayLike<number>, highs = highsOf(mono)): BandEnvelopes {
  const n = Math.floor(mono.length / MS);
  const full = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let m = 0;
    for (let i = f * MS; i < (f + 1) * MS; i++) {
      m = Math.max(m, Math.abs(x.left[i] ?? 0), Math.abs(x.right[i] ?? 0));
    }
    full[f] = m + 1e-7;
  }
  return {
    full,
    low: maxAbsEnv(filterWithLeadIn(butter4(200, 'low'), mono), n),
    high: maxAbsEnv(highs, n),
  };
}

/** 10 ms frames (frame i at i·10 ms), dB floored at −80 and smoothed over 9 frames. */
export interface LevelEnvelopes {
  readonly full: Float64Array;
  readonly high: Float64Array;
}

function rmsDb(y: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(n);
  const sq = new Float64Array(480);
  for (let f = 0; f < n; f++) {
    for (let i = 0; i < 480; i++) sq[i] = (y[f * 480 + i] ?? 0) ** 2;
    // Bit-exact with NumPy (pairwise mean, correctly rounded log10): upstream's swell search takes argmin over
    // −80 dB plateaus, and their 1e-14 drift in the smoothing's running sum depends on every earlier last bit.
    out[f] = Math.max(20 * log10Exact(Math.sqrt(pairwiseSum(sq, 0, 480) / 480) + 1e-9), -80);
  }
  return uniformFilter1d(out, 9);
}

/** timeline.level_envs(x); null with fewer than 3 frames. */
export function levelEnvelopes(mono: ArrayLike<number>, highs?: Float64Array): LevelEnvelopes | null {
  const n = Math.floor(mono.length / 480);
  if (n < 3) return null;
  return { full: rmsDb(mono, n), high: rmsDb(highs ?? highsOf(mono), n) };
}

/** timeline._kw_env_db(x): K-weighted 10 ms power (dB) at 1 ms steps, index i = the window starting at i ms. */
export function kWeightedEnvelopeDb(k: KPower): Float64Array {
  const n = k.length;
  const count = Math.max(1, Math.ceil(Math.max(1, n - 480) / 48));
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const s = i * 48;
    const e = Math.min(s + 480, n);
    out[i] = 10 * Math.log10(((k.sum[e] ?? 0) - (k.sum[s] ?? 0)) / 480 + 1e-12);
  }
  return out;
}
