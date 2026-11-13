// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One shot or two (BRK1, SPEC "Cuts that are one shot"). Method B's scan finds a gradual change wherever a shot's
 * embedding drifts: a walk down a street, a pan across a square. The drift reaches the soft threshold
 * and locateRamp puts a "dissolve" (or a whip, when the camera moves) in its middle. A real transition is a change
 * between steadier pictures: the embedding moves far faster across it than the shot does either side. A drift
 * isn't: the picture moves as fast just before or just after the ramp as in it, or the ramp fills its shot so there
 * is no steady picture either side to dissolve from. Such a soft cut is dropped.
 *
 * A fade to black makes its own soft cut too: the darkening frames move the embedding, and the cut lands a few
 * frames before the end. A cut whose frames keep darkening to black until the shot ends is the fade's tail, and
 * joins the shot before it. Pure: the distances, scores and luma come in.
 */
import type { BreakdownConfig } from './config';
import { cosineDistance } from './cut-merge';
import type { FrameValue } from './transitions';

type OneShotConfig = Pick<BreakdownConfig, 'scdet' | 'soft' | 'fadeTail'>;

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** A ramp and the stretch of its own shot either side it is compared with: `before` ≤ `start` < `end` ≤ `after`. */
export interface DriftSpan {
  readonly before: number;
  readonly start: number;
  readonly end: number;
  readonly after: number;
}

/**
 * The frames a ramp is compared with: as many either side as it is long (at least `soft.minPlateau`), never past
 * the hard cuts around it. A ramp that runs on to the next hard cut (the scan's window reached the cut's frame) stops
 * before it. `bounds` are the frames shots start at, with 0 and the reel's length.
 */
export function driftSpan(
  ramp: { readonly start: number; readonly end: number },
  bounds: readonly number[],
  config: OneShotConfig,
): DriftSpan {
  const shotStart = Math.max(0, ...bounds.filter((frame) => frame <= ramp.start));
  const shotEnd = Math.min(...bounds.filter((frame) => frame > ramp.start));
  const end = Math.max(ramp.start, Math.min(ramp.end, shotEnd - 1));
  const length = Math.max(config.soft.minPlateau, end - ramp.start);
  return {
    before: Math.max(shotStart, ramp.start - length),
    start: ramp.start,
    end,
    after: Math.min(shotEnd - 1, end + length),
  };
}

/**
 * A soft cut's ramp that is one shot drifting: the scene score proposes no cut inside it, and either fewer than
 * `soft.minPlateau` frames of its shot lie on each side, or the embedding moves under `soft.bump` times as fast
 * across the ramp as across the stretch before or after it. `distance` is the embedding distance between two frames,
 * null when either has no vector (then the cut stays).
 */
export function isDrift(
  span: DriftSpan,
  distance: (a: number, b: number) => number | null,
  scores: readonly number[],
  config: OneShotConfig,
): boolean {
  const inside = scores.slice(span.start, span.end + 1);
  if (inside.length > 0 && Math.max(...inside) >= config.scdet.propose) return false;
  const roomBefore = span.start - span.before;
  const roomAfter = span.after - span.end;
  if (roomBefore < config.soft.minPlateau && roomAfter < config.soft.minPlateau) return true;
  const across = distance(span.start, span.end);
  if (across === null) return false;
  const rate = across / Math.max(1, span.end - span.start);
  const rates: number[] = [];
  const before = roomBefore > 0 ? distance(span.before, span.start) : null;
  const after = roomAfter > 0 ? distance(span.end, span.after) : null;
  if (before !== null) rates.push(before / roomBefore);
  if (after !== null) rates.push(after / roomAfter);
  if (rates.length === 0) return false;
  return rate < config.soft.bump * Math.max(...rates);
}

/**
 * A cut at `frame` inside a fade to black: from the cut to the end of its shot (`end`, exclusive) the picture never
 * brightens by more than `fadeTail.rise`, gets darker than the frames just before the cut, and ends under
 * `fadeTail.luma`. Without luma there it can't tell, and the cut stays.
 */
export function isFadeTail(
  frame: number,
  end: number,
  luma: readonly FrameValue[],
  config: OneShotConfig,
): boolean {
  const sorted = [...luma].sort((a, b) => a.frame - b.frame);
  const after = sorted.filter((item) => item.frame >= frame && item.frame < end).map((item) => item.value);
  const before = sorted
    .filter((item) => item.frame >= frame - 3 && item.frame < frame)
    .map((item) => item.value);
  if (after.length < 2) return false;
  for (let i = 1; i < after.length; i++) if (after[i]! - after[i - 1]! > config.fadeTail.rise) return false;
  const last = after[after.length - 1]!;
  if (last > config.fadeTail.luma) return false;
  return before.length === 0 || mean(after) < mean(before);
}

/** A frame darker than the one before it by more than this is still fading. */
const FADE_STEP = 0.005;
/** Mean luma at or under this is black already. */
const DARK = 0.1;

/**
 * Where the fade that a tail at `frame` belongs to begins (BRK1 moves): back over any black it has reached, then
 * back while each frame is darker than the one before. Null without luma at `frame`.
 */
export function fadeStart(frame: number, luma: readonly FrameValue[]): number | null {
  const at = new Map(luma.map((item) => [item.frame, item.value]));
  const value = (f: number) => at.get(f)!;
  if (!at.has(frame)) return null;
  let start = frame;
  while (at.has(start - 1) && value(start) <= DARK && Math.abs(value(start - 1) - value(start)) <= FADE_STEP)
    start -= 1;
  while (at.has(start - 1) && value(start - 1) > value(start) + FADE_STEP) start -= 1;
  return start;
}

/**
 * How far a shot's picture travels (BRK1 moves): the embedding distance between its first and last embedded frames,
 * a frame in from each end (a transition's blend is not the shot) and before `fadeFrom` when it fades out. Null
 * with fewer than two embedded frames there. The scan embeds 4 frames a second, so every shot of a few frames has two.
 */
export function shotChange(
  vectors: ReadonlyMap<number, Float32Array>,
  shot: { readonly start: number; readonly end: number },
  fadeFrom?: number,
): number | null {
  const last = Math.min(shot.end, fadeFrom ?? shot.end) - 2;
  const frames = [...vectors.keys()]
    .filter((frame) => frame >= shot.start + 1 && frame <= last)
    .sort((a, b) => a - b);
  if (frames.length < 2) return null;
  return cosineDistance(vectors.get(frames[0]!)!, vectors.get(frames[frames.length - 1]!)!);
}

/**
 * How fast the camera moves through a shot (BRK1 moves): the mean of vision.motionCurve's samples inside it (the whole
 * picture's shift, frame widths a second), before `fadeFrom` when it fades out, without its fastest and slowest sample
 * when it has three or more (a cut's blend, a flash). A subject moving in a locked-off frame barely shifts the picture.
 * Null when the curve has no sample in the shot.
 */
export function shotMotion(
  motion: readonly FrameValue[],
  shot: { readonly start: number; readonly end: number },
  fadeFrom?: number,
): number | null {
  const last = Math.min(shot.end - 1, fadeFrom ?? shot.end);
  const values = motion
    .filter((sample) => sample.frame > shot.start && sample.frame <= last)
    .map((sample) => sample.value)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const kept = values.length >= 3 ? values.slice(1, -1) : values;
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}
