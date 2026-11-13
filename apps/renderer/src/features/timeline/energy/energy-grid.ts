// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The beat grid an energy section is cut on (P3-V12), as @taalcut/templates' energy-grid.ts and edits/timing.ts
 * make it: beats and half beats in canvas frames, every `beatsPerClip × 2`th point a cut, a piece shorter than a
 * beat joining its neighbour, the hook's first piece capped. The renderer can't import the templates package, so
 * this is its port: the fake's planEnergyCurve and the template page's preview cut with it.
 */
import { MIN_CLIP_FRAMES, RationalTime, type BeatAnchor, type BeatMap, type FrameRate } from '@taalcut/core';

/** Every beat of the map in frames at `rate` (rounded); none without a map. */
export function beatFrames(beatMap: BeatMap | null, rate: FrameRate): number[] {
  return beatMap ? beatMap.beats.map((beat) => RationalTime.toFrames(beat, rate, 'round')) : [];
}

/** Index of the beat nearest `frame` (the earlier on a tie), or -1 with no beats. */
function nearestBeat(frames: readonly number[], frame: number): number {
  if (frames.length === 0) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((frames[mid] ?? 0) < frame) low = mid + 1;
    else high = mid;
  }
  const before = frames[low - 1];
  const here = frames[low] ?? 0;
  if (low > 0 && before !== undefined && Math.abs(frame - before) <= Math.abs(here - frame)) return low - 1;
  return low;
}

/** The anchor for a slot starting at `frame`: the nearest beat and the signed offset from it. */
export function anchorAt(frames: readonly number[], frame: number, rate: FrameRate): BeatAnchor | null {
  const index = nearestBeat(frames, frame);
  const beat = frames[index];
  if (index < 0 || beat === undefined) return null;
  return { beatIndex: index, offset: RationalTime.of(frame - beat, rate) };
}

/** Is `frame` within one frame of a beat? */
export function onBeat(frames: readonly number[], frame: number): boolean {
  const beat = frames[nearestBeat(frames, frame)];
  return beat !== undefined && Math.abs(beat - frame) <= 1;
}

export function beatIndexAt(beats: readonly number[], frame: number): number {
  let found = 0;
  for (let index = 0; index < beats.length; index++) if ((beats[index] ?? Infinity) <= frame) found = index;
  return found;
}

export function beatInterval(beats: readonly number[], index: number): number {
  const here = beats[index];
  const next = beats[index + 1];
  if (here !== undefined && next !== undefined && next > here) return next - here;
  const previous = beats[index - 1];
  if (here !== undefined && previous !== undefined && here > previous) return here - previous;
  const last = beats[beats.length - 1];
  const before = beats[beats.length - 2];
  if (last !== undefined && before !== undefined && last > before) return last - before;
  return 1;
}

/** Beats and the half-beat midpoints from `firstIndex` until `until`, extrapolating the last interval. */
function buildGrid(beats: readonly number[], firstIndex: number, until: number): number[] {
  const points: number[] = [];
  if (beats.length === 0) return points;
  const index0 = Math.min(Math.max(firstIndex, 0), beats.length - 1);
  const start = beats[index0];
  if (start === undefined) return points;
  let frame = start;
  let step = beatInterval(beats, index0);
  let index = index0;
  points.push(frame);
  while (frame < until && points.length < 8000) {
    const next = beats[index + 1];
    const end = next ?? frame + step;
    if (end <= frame) break;
    const mid = Math.round((frame + end) / 2);
    if (mid > frame && mid < end) points.push(mid);
    points.push(end);
    frame = end;
    if (next !== undefined) {
      index += 1;
      step = beatInterval(beats, index);
    }
  }
  return points;
}

const unique = (frames: readonly number[]) =>
  [...frames]
    .sort((a, b) => a - b)
    .filter((frame, index, sorted) => index === 0 || frame !== sorted[index - 1]);

export interface SectionCutInput {
  readonly start: number;
  readonly end: number;
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly beatsPerClip: number;
  readonly align: 'beat' | 'downbeat';
  /** When the section starts at 0, the first piece must end by this frame. */
  readonly hookMax: number | null;
}

function everyStep(grid: readonly number[], origin: number, step: number, end: number): number[] {
  const frames: number[] = [];
  for (let k = origin + step; k < grid.length; k += step) frames.push(grid[k] ?? end);
  return frames;
}

function alignedCuts(grid: readonly number[], step: number, input: SectionCutInput): number[] {
  const { start, end } = input;
  if (input.align === 'beat') {
    const origin = grid.findIndex((frame) => frame >= start);
    return origin >= 0 ? everyStep(grid, origin, step, end) : [];
  }
  const next = input.downbeats.find((frame) => frame > start && frame < end);
  if (next === undefined) return [];
  const at = grid.indexOf(next);
  return [next, ...(at >= 0 ? everyStep(grid, at, step, end) : [])];
}

/** A maximum, not a target: a cut by `hookMax` only when the first piece would run past it. */
function hookCut(cuts: readonly number[], grid: readonly number[], input: SectionCutInput): number | null {
  const { start, end, hookMax } = input;
  if (hookMax === null || hookMax <= 0) return null;
  const limit = start + hookMax;
  const next = [...cuts, end].find((frame) => frame > start);
  if (next === undefined || next <= limit || limit >= end) return null;
  let best: number | null = null;
  for (const frame of grid) if (frame > start && frame <= limit && frame < end) best = frame;
  return best ?? limit;
}

export function sectionCutFrames(input: SectionCutInput): number[] {
  const { start, end, beats } = input;
  if (end <= start) return [start, end];
  const grid = buildGrid(beats, beatIndexAt(beats, start), end);
  const step = Math.max(1, Math.round(input.beatsPerClip * 2));
  const inside = (frame: number) => frame > start && frame < end;
  const cuts = [start, ...alignedCuts(grid, step, input).filter(inside)];
  const hook = hookCut(cuts, grid, input);
  if (hook !== null && inside(hook)) cuts.push(hook);
  return unique([...cuts, end]);
}

/** True when a piece is too short to keep; half-beat pacing keeps a half that clears MIN_CLIP_FRAMES. */
export function pieceTooShort(start: number, length: number, beats: readonly number[], beatsPerClip: number) {
  const span = beatInterval(beats, beatIndexAt(beats, start));
  const unit = beatsPerClip < 1 ? MIN_CLIP_FRAMES : Math.max(span, MIN_CLIP_FRAMES);
  return length < unit;
}

/** Merges a short piece into its neighbour; `keepFirst` refuses a merge that pushes slot 0 past the hook. */
export function mergeShort(
  cuts: readonly number[],
  tooShort: (start: number, length: number) => boolean,
  keepFirst: (end: number) => boolean,
): number[] {
  let frames = [...cuts];
  let changed = true;
  while (changed && frames.length > 2) {
    changed = false;
    for (let index = 0; index < frames.length - 1; index++) {
      const start = frames[index] ?? 0;
      const end = frames[index + 1] ?? start;
      if (!tooShort(start, end - start)) continue;
      if (index === 0) {
        if (keepFirst(frames[index + 2] ?? end)) continue;
        frames = [start, ...frames.slice(index + 2)];
      } else {
        if (index === 1 && keepFirst(end) && (frames[index - 1] ?? start) === frames[0]) continue;
        frames = [...frames.slice(0, index), ...frames.slice(index + 1)];
      }
      changed = true;
      break;
    }
  }
  return frames;
}
