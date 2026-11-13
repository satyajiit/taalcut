// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cut frames for one energy section (P3-V12). Half beats are the midpoints, rounded to the frame.
 * A remainder shorter than a musical beat (or MIN_CLIP_FRAMES) joins its neighbour; a half-beat cut is
 * the requested grid, so those pieces stay when beats per clip is a half.
 */
import { MIN_CLIP_FRAMES } from '@taalcut/core';

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
export function buildGrid(beats: readonly number[], firstIndex: number, until: number): number[] {
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

function unique(frames: readonly number[]): number[] {
  const sorted = [...frames].sort((a, b) => a - b);
  return sorted.filter((frame, index) => index === 0 || frame !== sorted[index - 1]);
}

export interface SectionCutInput {
  readonly start: number;
  readonly end: number;
  readonly beats: readonly number[];
  readonly downbeats: readonly number[];
  readonly beatsPerClip: number;
  readonly align: 'beat' | 'downbeat';
  /** When the section starts at 0, slot 0 must end by this frame. */
  readonly hookMax: number | null;
}

/** Every `step`th grid point after index `origin`. */
function everyStep(grid: readonly number[], origin: number, step: number, end: number): number[] {
  const frames: number[] = [];
  for (let k = origin + step; k < grid.length; k += step) frames.push(grid[k] ?? end);
  return frames;
}

/** The grid cuts after `start`: from the section's first downbeat, or from its own beat. */
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

/** True when a piece is too short to keep. Half-beat mode keeps a half that still clears MIN_CLIP_FRAMES. */
export function pieceTooShort(
  start: number,
  length: number,
  beats: readonly number[],
  beatsPerClip: number,
): boolean {
  const span = beatInterval(beats, beatIndexAt(beats, start));
  const unit = beatsPerClip < 1 ? MIN_CLIP_FRAMES : Math.max(span, MIN_CLIP_FRAMES);
  return length < unit;
}

/**
 * Merge a short piece into its neighbour. `keepFirst` refuses a merge that would push slot 0 past the hook.
 * Each pass removes one cut, so it terminates.
 */
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
        const after = frames[index + 2] ?? end;
        if (keepFirst(after)) continue;
        frames = [start, ...frames.slice(index + 2)];
      } else {
        const mergedFrom = frames[index - 1] ?? start;
        if (index === 1 && keepFirst(end) && mergedFrom === frames[0]) continue;
        frames = [...frames.slice(0, index), ...frames.slice(index + 1)];
      }
      changed = true;
      break;
    }
  }
  return frames;
}
