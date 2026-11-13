// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The beat-alignment metric after the warp (SPEC P3.5 step 5): the warped file is tracked again and every target
 * beat inside the music is matched to the nearest tracked beat. A target beat with no tracked beat within half a
 * beat interval is missed; a beat within half a beat of the music's end isn't counted (its sound would be cut
 * off). Pass: every downbeat within one frame of the canvas rate, the 95th percentile of all
 * matched beats within one frame, and at most 5 % missed. Pure.
 */
import { MUSIC_CONFIG } from './config';
import { medianBeatMs, type BeatGrid } from './beat-grid';

export interface GridCheck {
  readonly maxErrorMs: number;
  readonly p95ErrorMs: number;
  /** Share of target beats with no tracked beat near them, 0..1. */
  readonly missed: number;
  readonly downbeatsOnGrid: boolean;
  readonly passed: boolean;
}

export interface GridCheckInput {
  readonly target: BeatGrid;
  readonly tracked: BeatGrid;
  /** One frame of the canvas rate, in ms (33.37 at 29.97 fps). */
  readonly frameMs: number;
  /** The warped music's length on the timeline, in ms: beats after it aren't counted. */
  readonly musicMs: number;
}

function nearest(sorted: readonly number[], t: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [sorted[lo - 1], sorted[lo]].filter((v): v is number => v !== undefined);
  return candidates.reduce((best, v) => Math.min(best, Math.abs(v - t)), Number.POSITIVE_INFINITY);
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function checkGrid(input: GridCheckInput): GridCheck {
  const tracked = [...input.tracked.beatsMs].sort((a, b) => a - b);
  const beat = medianBeatMs(input.target) ?? 500;
  const missLimit = beat * MUSIC_CONFIG.grid.missShare;
  const downbeats = new Set(input.target.downbeats);
  const errors: number[] = [];
  let missed = 0;
  let counted = 0;
  let downbeatsOnGrid = true;
  input.target.beatsMs.forEach((t, index) => {
    if (t < 0 || t > input.musicMs - missLimit) return;
    counted += 1;
    const error = tracked.length > 0 ? nearest(tracked, t) : Number.POSITIVE_INFINITY;
    if (error > missLimit) {
      missed += 1;
      if (downbeats.has(index)) downbeatsOnGrid = false;
      return;
    }
    errors.push(error);
    if (downbeats.has(index) && error > input.frameMs) downbeatsOnGrid = false;
  });
  const p95 = quantile(errors, MUSIC_CONFIG.grid.p95Quantile);
  const missedShare = counted === 0 ? 1 : missed / counted;
  return {
    maxErrorMs: round2(errors.reduce((max, e) => Math.max(max, e), 0)),
    p95ErrorMs: round2(p95),
    missed: round2(missedShare),
    downbeatsOnGrid,
    passed:
      counted > 0 &&
      downbeatsOnGrid &&
      p95 <= input.frameMs &&
      missedShare <= MUSIC_CONFIG.grid.maxMissedShare,
  };
}
