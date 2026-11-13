// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-points (SPEC, casting step 5): inside the chosen shot, the window of the
 * slot's length where the action is under way, whose motion peak (full-rate
 * peak frames) lands within the beat tolerance of the slot's anchor.
 *
 * FIX-TRIM: a window is scored by its mean sharpness on the 100 ms curve, less
 * how far it sits in the shot's onset or stop (settle.ts) and in the
 * recording's first second or last half second (recording.ts), plus a pull
 * toward vision's best frame; slot 0 also rewards motion and sharpness in its
 * opening. An aligned window wins when it is about as settled as the shot
 * allows (within `alignSlack` of the most settled window); otherwise the best
 * window plays with no sync point. Equal windows: the one nearest the middle.
 */
import { RationalTime, type FrameRate, type ShotProfile } from '@taalcut/core';
import { sourceFrames } from '../model/speed';
import type { CastingConfig } from './config';
import { recordingHandles, recordingPenalty } from './recording';
import { settleOf, settlePenalty, type Settle } from './settle';
import type { SlotSpec } from './slots';

export interface InPoint {
  /** First source frame used, at the media's rate. */
  readonly sourceStart: RationalTime;
  /** The motion peak that lands on the anchor; null when none does. */
  readonly syncPoint: RationalTime | null;
  /** The slot has an anchor and a peak landed on it. */
  readonly aligned: boolean;
}

/** Cumulative sums of curve samples by media frame, for O(1) window means. */
interface Prefix {
  readonly sum: Float64Array;
  readonly count: Float64Array;
}

function prefix(
  values: readonly number[] | null,
  framesAt: (index: number) => number,
  length: number,
): Prefix {
  const sum = new Float64Array(length + 1);
  const count = new Float64Array(length + 1);
  values?.forEach((value, index) => {
    const frame = framesAt(index);
    if (frame < 0 || frame >= length) return;
    sum[frame + 1] = (sum[frame + 1] as number) + value;
    count[frame + 1] = (count[frame + 1] as number) + 1;
  });
  for (let frame = 1; frame <= length; frame++) {
    sum[frame] = (sum[frame] as number) + (sum[frame - 1] as number);
    count[frame] = (count[frame] as number) + (count[frame - 1] as number);
  }
  return { sum, count };
}

function mean(table: Prefix, from: number, to: number): number {
  const count = (table.count[to] as number) - (table.count[from] as number);
  return count === 0 ? 0 : ((table.sum[to] as number) - (table.sum[from] as number)) / count;
}

interface CachedPrefixes {
  readonly config: CastingConfig['inPoint'];
  readonly sharp: Prefix;
  readonly settle: Settle;
  opening?: Prefix;
}

const prefixCache = new WeakMap<ShotProfile, CachedPrefixes>();

function prefixesFor(
  profile: ShotProfile,
  config: CastingConfig['inPoint'],
  needOpening: boolean,
): CachedPrefixes {
  const rate = profile.range.start.rate;
  const length = profile.range.duration.value;
  const { sampleMs } = config;
  const framesAt = (index: number) => Math.round((index * sampleMs * rate.num) / (1000 * rate.den));
  let entry = prefixCache.get(profile);
  if (!entry || entry.config !== config) {
    entry = {
      config,
      sharp: prefix(profile.sharpnessCurve, framesAt, length),
      settle: settleOf(profile.motionCurve, length, framesAt, config.settle, sampleMs),
    };
    prefixCache.set(profile, entry);
  }
  if (needOpening && !entry.opening) {
    const motion = profile.motionCurve;
    const sharpness = profile.sharpnessCurve;
    entry.opening = prefix(
      motion && sharpness
        ? motion.slice(0, sharpness.length).map((value, index) => (value + (sharpness[index] as number)) / 2)
        : null,
      framesAt,
      length,
    );
  }
  return entry;
}

/** Media frames the slot needs from this shot: its consumed source time at the shot's rate, rounded up. */
export function windowFrames(slot: SlotSpec, mediaRate: FrameRate): number {
  return RationalTime.rescale(slot.consumes, mediaRate, 'ceil').value;
}

/**
 * FIX-TRIM: more terms on a window, from outside the shot's profile (the person in it, subject-terms.ts; a slip's
 * limits). A window's penalty counts in its score and in how settled it is; only allowed starts may be chosen.
 */
export interface WindowTerms {
  /** Media frames from the shot's start; absent, every start that fits. */
  readonly allowed?: (start: number) => boolean;
  readonly penalty?: (start: number) => number;
}

/** The shot's best frame inside the shot, or null (a photo, or none stored). */
function bestFrameOf(profile: ShotProfile, length: number): number | null {
  const frame = profile.bestFrame;
  return typeof frame === 'number' && Number.isFinite(frame)
    ? Math.max(0, Math.min(length - 1, Math.round(frame)))
    : null;
}

export function selectInPoint(
  profile: ShotProfile,
  slot: SlotSpec,
  canvasRate: FrameRate,
  config: CastingConfig,
  hook: boolean,
  terms: WindowTerms = {},
): InPoint | null {
  const rate = profile.range.start.rate;
  if (profile.kind === 'image')
    return { sourceStart: RationalTime.zero(rate), syncPoint: null, aligned: false };
  const length = profile.range.duration.value;
  const window = windowFrames(slot, rate);
  const last = length - window;
  if (last < 0 || window < 1) return null;

  const { sharp, opening, settle } = prefixesFor(profile, config.inPoint, hook);
  const settling = config.inPoint.settle;
  const hookFrames = hook
    ? Math.min(window, RationalTime.fromSeconds(config.hook.openingSeconds, rate).value)
    : 0;
  const best = bestFrameOf(profile, length);
  const recording = config.inPoint.recording;
  const handles = recordingHandles(profile, window, recording);
  const penalty = (start: number) =>
    settlePenalty(settle, length, start, window, settling) +
    recordingPenalty(handles, start, window, recording) +
    (terms.penalty ? terms.penalty(start) : 0);
  const allowed = terms.allowed ?? (() => true);
  const objective = (start: number) =>
    mean(sharp, start, start + window) +
    (hook && opening ? config.hook.openingWeight * mean(opening, start, start + hookFrames) : 0) +
    (best === null
      ? 0
      : config.inPoint.bestFrameWeight * (1 - Math.abs(start + window / 2 - best) / length)) -
    penalty(start);

  // Equal windows go to the one nearest the middle of the shot (then the earlier), not to the shot's start.
  const middle = last / 2;
  const nearer = (start: number, other: number) =>
    Math.abs(start - middle) < Math.abs(other - middle) ||
    (Math.abs(start - middle) === Math.abs(other - middle) && start < other);
  const pick = (starts: Iterable<number>): number | null => {
    let chosen: number | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const start of starts) {
      const value = objective(start);
      if (
        value > bestValue + config.tieEpsilon ||
        (Math.abs(value - bestValue) <= config.tieEpsilon && chosen !== null && nearer(start, chosen))
      ) {
        chosen = start;
        bestValue = Math.max(value, bestValue);
      }
    }
    return chosen;
  };
  const everyStart = function* () {
    for (let start = 0; start <= last; start++) if (allowed(start)) yield start;
  };

  const at = (frame: number) => RationalTime.add(profile.range.start, RationalTime.of(frame, rate));
  if (slot.anchorRel !== null) {
    // A peak lands on the beat when the media before it is what the slot plays in its first anchorRel canvas
    // frames: the ramp's integral (never the speed at frame 0), times R / M media frames per canvas frame.
    const perCanvas = (rate.num * canvasRate.den) / (rate.den * canvasRate.num);
    const tolerance = config.inPoint.beatToleranceFrames;
    const low = sourceFrames(slot.speed, slot.anchorRel - tolerance) * perCanvas;
    const high = sourceFrames(slot.speed, slot.anchorRel + tolerance) * perCanvas;
    const peakFor = new Map<number, number>();
    for (const peak of [...profile.motionPeakFrames].sort((a, b) => a - b)) {
      const from = Math.max(0, Math.ceil(peak - high - config.tieEpsilon), peak - window + 1);
      const to = Math.min(last, Math.floor(peak - low + config.tieEpsilon), peak);
      for (let start = from; start <= to; start++) if (!peakFor.has(start)) peakFor.set(start, peak);
    }
    // FIX-TRIM: a peak on the beat counts only in a window about as settled as the shot allows, so a person only
    // starting to walk never opens a clip because a step landed on the beat.
    let floor = Number.POSITIVE_INFINITY;
    if (peakFor.size > 0) for (const start of everyStart()) floor = Math.min(floor, penalty(start));
    const settled = [...peakFor.keys()].filter(
      (start) => allowed(start) && penalty(start) <= floor + settling.alignSlack + config.tieEpsilon,
    );
    const start = pick(settled);
    if (start !== null)
      return { sourceStart: at(start), syncPoint: at(peakFor.get(start) as number), aligned: true };
  }
  const start = pick(everyStart());
  // Nothing allowed (a span that holds no whole window): no in-point, which the caller reads as "keep yours".
  if (start === null) return terms.allowed ? null : { sourceStart: at(0), syncPoint: null, aligned: false };
  return { sourceStart: at(start), syncPoint: null, aligned: false };
}
