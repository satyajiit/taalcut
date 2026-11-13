// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FRAME, toFrame } from '../timecode';

/**
 * How a cut moves on the review's strip, the app's rules (packages/ui/src/templates/cut-math.ts): ← → a frame,
 * ⇧← ⇧→ to the next music beat, never closer than a frame to the cut beside it, never off the reel.
 */

/** The times a cut may take: a frame after the cut before it, a frame before the cut after it. */
export function cutRange(times: readonly number[], index: number, duration: number): readonly [number, number] {
  const before = index > 0 ? (times[index - 1] ?? 0) : 0;
  const after = index < times.length - 1 ? (times[index + 1] ?? duration) : duration;
  return [toFrame(before + FRAME), toFrame(after - FRAME)];
}

function clampTo(times: readonly number[], index: number, duration: number, value: number): number {
  const [min, max] = cutRange(times, index, duration);
  return toFrame(Math.min(max, Math.max(min, value)));
}

/** One frame earlier or later. */
export function nudgeCut(times: readonly number[], index: number, direction: -1 | 1, duration: number): number {
  const now = times[index] ?? 0;
  return clampTo(times, index, duration, now + direction * FRAME);
}

/** To the next music beat in that direction that the cut may reach; where it is when there is none. */
export function cutToBeat(
  times: readonly number[],
  index: number,
  direction: -1 | 1,
  beats: readonly number[],
  duration: number,
): number {
  const now = times[index] ?? 0;
  const [min, max] = cutRange(times, index, duration);
  const half = FRAME / 2;
  const candidates = beats.filter((beat) => (direction > 0 ? beat > now + half : beat < now - half)).filter((beat) => beat >= min - half && beat <= max + half);
  const next = direction > 0 ? candidates[0] : candidates[candidates.length - 1];
  return next === undefined ? now : clampTo(times, index, duration, next);
}

/** Whether a time lands on a music beat, within half a frame. */
export function onBeat(time: number, beats: readonly number[]): boolean {
  return beats.some((beat) => Math.abs(beat - time) <= FRAME / 2 + 1e-9);
}

/** A time the pointer let go at: on a beat within 80 ms of one (the app's snap), else on the nearest frame. */
export function snapCut(times: readonly number[], index: number, value: number, beats: readonly number[], duration: number): number {
  const near = beats.find((beat) => Math.abs(beat - value) <= 0.08);
  return clampTo(times, index, duration, near ?? value);
}

/**
 * The lanes' narrowest width, in CSS px (36rem). Below it they scroll sideways inside the plate, so the reel's fast
 * run never packs two cut grips into one 24 px target (WCAG 2.5.8). The grips alternate rows, so it is the closest
 * two cuts that share a row that set it; test/unit/showcase-breakdown.test.ts checks the sample against it, and the
 * lanes' hint (`@min-[36rem]:hidden`) shows below it.
 */
export const LANES_MIN_PX = 576;

/** Each cut's grip is this wide where there is room: the target size WCAG 2.5.8 asks for. */
export const GRIP_PX = 24;

/** The closest two cuts on one row of grips (every other cut), in seconds; Infinity with fewer than three cuts. */
export function closestOnRow(times: readonly number[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 2; i < times.length; i += 1) closest = Math.min(closest, (times[i] ?? 0) - (times[i - 2] ?? 0));
  return closest;
}

/**
 * How far a cut's grip may reach each way, in seconds: half the way to the next cut on its row, or to the reel's end.
 * Capped at half a grip in the lanes, it keeps two grips from ever overlapping, however close a cut is moved.
 */
export function gripReach(times: readonly number[], index: number, duration: number): readonly [number, number] {
  const now = times[index] ?? 0;
  const before = index >= 2 ? times[index - 2] : undefined;
  const after = times[index + 2];
  return [before === undefined ? now : (now - before) / 2, after === undefined ? duration - now : (after - now) / 2];
}
