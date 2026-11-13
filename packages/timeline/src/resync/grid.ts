// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The grid edits re-sync to (SPEC, "Re-sync" step 1): the beat map's beats
 * rescaled to canvas frames (rounded, as core's anchor check does), plus half
 * beats when shots are shorter than a beat. No beat map: every frame.
 */
import { RationalTime, type BeatAnchor, type BeatMap, type FrameRate } from '@taalcut/core';

export interface BeatGrid {
  /** Beat frames at the canvas rate, by beat index. Empty without a beat map. */
  readonly beats: readonly number[];
  /** Sorted grid frames; null when every frame is on the grid. */
  readonly points: readonly number[] | null;
  /** Median beat interval in frames; null without two beats. */
  readonly interval: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function beatGrid(beatMap: BeatMap | null, rate: FrameRate, medianItemFrames: number): BeatGrid {
  if (!beatMap || beatMap.beats.length === 0) return { beats: [], points: null, interval: null };
  const beats = beatMap.beats.map((beat) => RationalTime.rescale(beat, rate, 'round').value);
  const gaps = beats.slice(1).map((beat, index) => beat - (beats[index] as number));
  const interval = median(gaps);
  const points = new Set(beats);
  if (interval !== null && medianItemFrames < interval) {
    beats.slice(1).forEach((beat, index) => points.add(Math.round(((beats[index] as number) + beat) / 2)));
  }
  return { beats, points: [...points].sort((a, b) => a - b), interval };
}

/** Index of the first value ≥ target. */
function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((values[mid] as number) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The anchor of `frame`: its nearest beat (ties go earlier) and the offset from it. Null without beats. */
export function anchorAt(grid: BeatGrid, frame: number, rate: FrameRate): BeatAnchor | null {
  if (grid.beats.length === 0) return null;
  const after = lowerBound(grid.beats, frame);
  const before = after - 1;
  let index = after;
  if (after >= grid.beats.length) index = before;
  else if (before >= 0 && frame - (grid.beats[before] as number) <= (grid.beats[after] as number) - frame)
    index = before;
  return { beatIndex: index, offset: RationalTime.of(frame - (grid.beats[index] as number), rate) };
}

/** Where an anchor lands, in canvas frames; null when its beat doesn't exist. */
export function anchorFrame(grid: BeatGrid, anchor: BeatAnchor): number | null {
  const beat = grid.beats[anchor.beatIndex];
  return beat === undefined ? null : beat + anchor.offset.value;
}

/** Grid frames in [from, to], nearest `target` first; ties go earlier. Every frame without a beat map. */
export function gridPointsNear(grid: BeatGrid, target: number, from: number, to: number): number[] {
  if (!grid.points) {
    const all: number[] = [];
    for (let frame = from; frame <= to; frame++) all.push(frame);
    return all.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  }
  const start = lowerBound(grid.points, from);
  const near: number[] = [];
  for (let index = start; index < grid.points.length && (grid.points[index] as number) <= to; index++)
    near.push(grid.points[index] as number);
  return near.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
}

export function isOnGrid(grid: BeatGrid, frame: number): boolean {
  if (!grid.points) return true;
  const index = lowerBound(grid.points, frame);
  return grid.points[index] === frame;
}
