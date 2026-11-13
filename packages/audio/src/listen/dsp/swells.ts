// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Build-ups a transient detector misses (earshot timeline `_swells` and `level_peak`), on the 10 ms level
 * envelopes. A swell (whoosh, riser) rises ≥ 8 dB over 0.25–2 s, mostly monotonically, then falls; it is timed at
 * its peak. A level peak is the loudest frame within ±150 ms of a cut that rises ≥ 3 dB over the 0.6 s before it
 * and falls ≥ 2 dB within 0.3 s: the cut-sync matcher's `peak` answer.
 */
import type { LevelEnvelopes } from './envelopes';
import { pyRound, roundTo } from './pcm';
import { argMax, argMin, maxOf, maximumFilter1d, minOf } from './stats';

/** timeline.SWELL_RISE_DB. */
export const SWELL_RISE_DB = 8.0;

export interface Swell {
  /** The peak, seconds (frame / 100). */
  readonly t: number;
  readonly band: 'full' | 'high';
  readonly riseDb: number;
  /** The level it rose from (dB, 1 decimal). */
  readonly bedDb: number;
  readonly riseMs: number;
  readonly lengthMs: number;
}

const BANDS = ['full', 'high'] as const;

/** timeline._swells(x, hits): `hitTimes` are the hit events' times (s). */
export function detectSwells(levels: LevelEnvelopes | null, hitTimes: readonly number[]): Swell[] {
  if (!levels || levels.full.length < 60) return [];
  const out: Swell[] = [];
  for (const band of BANDS) {
    const s = levels[band];
    const top = maximumFilter1d(s, 31);
    for (let i = 0; i < s.length; i++) {
      const v = s[i] ?? 0;
      if (!(v === top[i] && v > -70)) continue;
      const a = Math.max(0, i - 200);
      if (i - a < 25) continue;
      const j = argMin(s, a, i - 15);
      const rise = v - (s[j] ?? 0);
      const dur = (i - j) / 100;
      const afterEnd = Math.min(s.length, i + 100);
      if (rise < SWELL_RISE_DB || dur < 0.25 || afterEnd - i < 10 || v - minOf(s, i, afterEnd) < 4) continue;
      let up = 0;
      for (let k = j; k < i; k++) if ((s[k + 1] ?? 0) - (s[k] ?? 0) > 0) up++;
      if (up / (i - j) < 0.6) continue;
      const t = i / 100;
      if (hitTimes.some((h) => Math.abs(h - (t - 0.03)) < 0.05)) continue;
      if (out.some((o) => Math.abs(o.t - t) < 0.15)) continue;
      let fall = -1;
      for (let k = i; k < afterEnd; k++) {
        if ((s[k] ?? 0) < v - 10) {
          fall = k - i;
          break;
        }
      }
      out.push({
        t,
        band,
        riseDb: rise,
        bedDb: roundTo(s[j] ?? 0, 1),
        riseMs: Math.trunc(dur * 1000),
        lengthMs: fall >= 0 ? Math.trunc(fall * 10) : 1000,
      });
    }
  }
  return out;
}

export interface LevelPeak {
  readonly t: number;
  readonly band: 'full' | 'high';
  readonly riseDb: number;
}

/** timeline.level_peak(envs, t): the strongest qualifying level peak near `t` over both bands, or null. */
export function levelPeak(
  levels: LevelEnvelopes | null,
  t: number,
  radius = 0.15,
  minRiseDb = 3.0,
  minFallDb = 2.0,
  local = 0.3,
): LevelPeak | null {
  if (!levels) return null;
  let best: LevelPeak | null = null;
  for (const band of BANDS) {
    const s = levels[band];
    const c = pyRound(t * 100);
    const r = Math.trunc(radius * 100);
    const a = Math.max(0, c - r);
    const b = Math.min(s.length, c + r + 1);
    if (b - a < 3) continue;
    const i = argMax(s, a, b);
    const w = Math.trunc(local * 100);
    const v = s[i] ?? 0;
    if (v < maxOf(s, Math.max(0, i - w), Math.min(s.length, i + w + 1)) || i < 5) continue;
    const rise = v - minOf(s, Math.max(0, i - 60), i);
    const afterEnd = Math.min(s.length, i + 31);
    if (rise < minRiseDb || afterEnd - i < 5 || v - minOf(s, i, afterEnd) < minFallDb) continue;
    if (best === null || rise > best.riseDb)
      best = { t: roundTo(i / 100, 3), band, riseDb: roundTo(rise, 1) };
  }
  return best;
}
