// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: where the action in a shot is under way (SPEC, casting step 5, "settled action"). On the owner's trip
 * footage clips opened on a person only starting to walk: the in-point step chose by sharpness alone, which is flat
 * across such a shot, so the shot's first frame won. The motion curve shows it: motion climbs from the shot's start to
 * a steady level. The onset is that climb, from the shot's start until the curve first holds a share of its steady
 * level (the median over the shot's middle half) for a few samples in a row; the stop is the same from the end. Each
 * is capped (`maxSeconds`, and never more than half the shot). A shot that is still in its middle (motion under
 * `minSteady`) has neither: there is no action to wait for.
 */
import type { CastingConfig } from './config';

export interface Settle {
  /** Media frames from the shot's start where the action is under way: 0 when it is from the first frame. */
  readonly onsetEnd: number;
  /** Media frames from the shot's start where it comes to a stop: the shot's length when it doesn't. */
  readonly stopStart: number;
}

export type SettleConfig = CastingConfig['inPoint']['settle'];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The onset and stop of a shot `length` media frames long, from its 100 ms motion curve; `framesAt` is a sample's
 * media frame. No curve, or too few samples to tell: neither.
 */
export function settleOf(
  curve: readonly number[] | null,
  length: number,
  framesAt: (index: number) => number,
  config: SettleConfig,
  sampleMs: number,
): Settle {
  const none: Settle = { onsetEnd: 0, stopStart: length };
  const n = curve?.length ?? 0;
  const run = config.steadySamples;
  if (!curve || n < 2 * run) return none;
  const steady = median(curve.slice(Math.floor(n / 4), Math.max(Math.floor(n / 4) + 1, Math.ceil((3 * n) / 4))));
  if (steady < config.minSteady) return none;
  const threshold = steady * config.steadyFraction;
  const cap = Math.min(Math.round((config.maxSeconds * 1000) / sampleMs), Math.floor(n / 2));
  // A run of `run` samples from `from`, all at the threshold or above.
  const holds = (from: number) => {
    for (let i = from; i < from + run; i++) if ((curve[i] as number) < threshold) return false;
    return true;
  };
  let onset = 0;
  while (onset < cap && !holds(onset)) onset++;
  let stop = 0;
  while (stop < cap && !holds(n - run - stop)) stop++;
  const at = (index: number) => Math.max(0, Math.min(length, framesAt(index)));
  return { onsetEnd: at(onset), stopStart: stop === 0 ? length : at(n - stop) };
}

/**
 * How far a window `[start, start + window)` sits in the onset and the stop, weighted: each part is the share of the
 * window inside it, over the share it could be (the window's length, or the stretch's when that is shorter), so a
 * window wholly inside counts in full and one that starts as the onset ends counts nothing.
 */
export function settlePenalty(settle: Settle, length: number, start: number, window: number, config: SettleConfig): number {
  const end = start + window;
  const onset = settle.onsetEnd;
  const stop = length - settle.stopStart;
  const inOnset = onset > 0 ? Math.max(0, Math.min(end, onset) - start) / Math.min(window, onset) : 0;
  const inStop = stop > 0 ? Math.max(0, end - Math.max(start, settle.stopStart)) / Math.min(window, stop) : 0;
  return config.onsetWeight * inOnset + config.stopWeight * inStop;
}
