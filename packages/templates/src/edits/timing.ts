// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pacing stats and beat anchors: what every structural change recomputes
 * (breakdown, formats, slot edits). All arithmetic is in whole frames at the
 * canvas rate; beats are rescaled to that grid the way core's anchor check
 * does (round to the nearest frame), so an anchor made here always passes it.
 */
import {
  RationalTime,
  type BeatAnchor,
  type BeatMap,
  type FrameRate,
  type PacingStats,
  type TemplateSlot,
} from '@taalcut/core';

/** The hook rule's horizon: pacing.hookEnd is capped here (taste rule: hook in the first 1.5 s). */
const HOOK_CAP_SECONDS = 3;

/** Each beat as a whole frame at `rate`, rounded like checkAnchor. */
export function beatFrames(beatMap: BeatMap | null, rate: FrameRate): number[] {
  return beatMap ? beatMap.beats.map((beat) => RationalTime.toFrames(beat, rate, 'round')) : [];
}

/** Index of the beat frame nearest `frame` (the earlier one on a tie), or -1 with no beats. */
export function nearestBeat(frames: readonly number[], frame: number): number {
  if (frames.length === 0) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (frames[mid]! < frame) low = mid + 1;
    else high = mid;
  }
  // `low` is the first beat at or after `frame`; the one before may be nearer.
  if (low > 0 && Math.abs(frame - frames[low - 1]!) <= Math.abs(frames[low]! - frame)) return low - 1;
  return low;
}

/**
 * The anchor for a slot starting at `frame`: the nearest beat and the signed
 * offset from it, so `beat + offset` is the cut exactly. Null without beats.
 */
export function anchorAt(frames: readonly number[], frame: number, rate: FrameRate): BeatAnchor | null {
  const index = nearestBeat(frames, frame);
  if (index < 0) return null;
  return { beatIndex: index, offset: RationalTime.of(frame - frames[index]!, rate) };
}

/** Is `frame` within one frame of a beat? */
export function onBeat(frames: readonly number[], frame: number): boolean {
  const index = nearestBeat(frames, frame);
  return index >= 0 && Math.abs(frames[index]! - frame) <= 1;
}

function median(sorted: readonly number[]): number {
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * PacingStats for `slots` at `rate`. `cutsOnBeat` is the share of cuts (slot
 * starts after the first) within one frame of a beat; null without a beat map
 * or without a cut to measure.
 */
export function computePacing(
  slots: readonly Pick<TemplateSlot, 'start' | 'duration'>[],
  beatMap: BeatMap | null,
  rate: FrameRate,
): PacingStats {
  const lengths = slots.map((slot) => RationalTime.toFrames(slot.duration, rate));
  const sorted = [...lengths].sort((a, b) => a - b);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const at = (frames: number) => RationalTime.of(frames, rate);
  const firstEnd = lengths[0] ?? 0;
  const hookCap = RationalTime.toFrames(RationalTime.fromSeconds(HOOK_CAP_SECONDS, rate), rate);
  const cuts = slots.slice(1).map((slot) => RationalTime.toFrames(slot.start, rate));
  const beats = beatFrames(beatMap, rate);
  const cutsOnBeat =
    beatMap && cuts.length > 0 ? cuts.filter((cut) => onBeat(beats, cut)).length / cuts.length : null;
  return {
    shotCount: slots.length,
    meanShot: at(Math.round(total / Math.max(1, lengths.length))),
    medianShot: at(sorted.length > 0 ? median(sorted) : 0),
    shortestShot: at(sorted[0] ?? 0),
    longestShot: at(sorted[sorted.length - 1] ?? 0),
    hookEnd: at(Math.min(firstEnd, hookCap)),
    cutsOnBeat,
  };
}
