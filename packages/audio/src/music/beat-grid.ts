// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beats and bars in milliseconds, the shape the warp and the grid check work in. From core's BeatMap (the
 * timeline's target grid) or a tracker's result (the generated track). Downbeats are indices into `beatsMs`;
 * a map without them gets one every `beatsPerBar` beats from the first beat.
 */
import { RationalTime, type BeatMap } from '@taalcut/core';

export interface BeatGrid {
  readonly beatsMs: readonly number[];
  readonly downbeats: readonly number[];
}

export function gridFromBeatMap(map: BeatMap): BeatGrid {
  const beatsMs = map.beats.map((beat) => RationalTime.toSeconds(beat) * 1000);
  const downbeats =
    map.downbeats.length >= 2 ? [...map.downbeats] : everyNth(beatsMs.length, map.beatsPerBar ?? 4);
  return { beatsMs, downbeats };
}

function everyNth(count: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += Math.max(1, n)) out.push(i);
  return out;
}

export function downbeatTimes(grid: BeatGrid): number[] {
  return grid.downbeats.map((index) => grid.beatsMs[index]).filter((t): t is number => t !== undefined);
}

/** The median interval between beats, in ms; null with fewer than two beats. */
export function medianBeatMs(grid: BeatGrid): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < grid.beatsMs.length; i++)
    gaps.push((grid.beatsMs[i] ?? 0) - (grid.beatsMs[i - 1] ?? 0));
  if (gaps.length === 0) return null;
  const sorted = gaps.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** Tempo from the median beat interval, rounded to a whole BPM; null without beats. */
export function gridBpm(grid: BeatGrid): number | null {
  const beat = medianBeatMs(grid);
  return beat && beat > 0 ? Math.round(60_000 / beat) : null;
}
