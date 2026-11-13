// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's source time across its rendered frames (SPEC section 3, "Speed"). The picture (conform),
 * the sound (mix), captions and still frames all read this one curve, so a ramp is exact everywhere
 * in the export; only preview plays the mean speed.
 *
 * Positions are in output frames, fractional: frame k counts from the clip's `visible.start`, and
 * source time counts from its `sourceIn` (source seconds × the output rate). Frames before the cut
 * (a transition's lead-in handle) play at real time, which is how render-plan puts `sourceIn` that
 * many frames before the cut's in-point. From the cut on, source time is the ramp's integral, with
 * timeline's `rampFrames` (the integral trims and re-syncs use); past the ramp's last point it keeps
 * that point's speed.
 */
import { RationalTime, type FrameRate, type SpeedRamp } from '@taalcut/core';
import { rampFrames } from '@taalcut/timeline';
import { samplesForFrames, toFrame } from '../time/frames';

export interface SpeedCurve {
  /** Frames from `visible.start` to the cut, played at real time. */
  readonly lead: number;
  /** The ramp with its points at output frames from the cut, or null for real time. */
  readonly ramp: SpeedRamp | null;
}

/** One point of the curve: source position `src` shows at output frame `out`. */
export interface CurveKnot {
  readonly out: number;
  readonly src: number;
}

/** A stretch of constant tempo in the sound: `samples` on the render, playing `consumed` source samples. */
export interface TempoPiece {
  readonly samples: number;
  readonly consumed: number;
}

export function speedCurve(speed: SpeedRamp | null, lead: number, rate: FrameRate): SpeedCurve {
  if (!speed) return { lead, ramp: null };
  const points = speed.points.map((point) => ({
    at: RationalTime.of(toFrame(point.at, rate), rate),
    speed: point.speed,
  }));
  return {
    lead,
    ramp: {
      ...speed,
      points,
      ...(speed.windowStart ? { windowStart: RationalTime.of(toFrame(speed.windowStart, rate), rate) } : {}),
    },
  };
}

/** The curve of a planned visual: its lead is the handle between `visible.start` and the cut. */
export function visualCurve(
  visual: {
    readonly speed: SpeedRamp | null;
    readonly cut: { readonly start: number };
    readonly visible: { readonly start: number };
  },
  rate: FrameRate,
): SpeedCurve {
  return speedCurve(visual.speed, visual.cut.start - visual.visible.start, rate);
}

/** Source position shown at output frame `k`. */
export function sourceFramesAt(curve: SpeedCurve, k: number): number {
  if (!curve.ramp || k <= curve.lead) return k;
  return curve.lead + rampFrames(curve.ramp, k - curve.lead);
}

/** The output frame at which source position `src` shows: the inverse (speeds are at least 0.1, so it is monotone). */
export function outputFramesAt(curve: SpeedCurve, src: number): number {
  if (!curve.ramp || src <= curve.lead) return src;
  let low = curve.lead;
  let high = curve.lead + 1;
  while (sourceFramesAt(curve, high) < src) high = curve.lead + (high - curve.lead) * 2;
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (sourceFramesAt(curve, mid) < src) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

interface Stretch {
  readonly from: number;
  readonly to: number;
  /** Speed changes inside it (a linear or ease ramp segment); null when constant. */
  readonly bend: { readonly length: number; readonly delta: number } | null;
}

/** [0, frames] split where the speed's formula changes: the cut, then each ramp point. */
function stretches(curve: SpeedCurve, frames: number): Stretch[] {
  const ramp = curve.ramp;
  if (!ramp) return frames > 0 ? [{ from: 0, to: frames, bend: null }] : [];
  const offset = ramp.windowStart?.value ?? 0;
  const bounds = [
    ...new Set([0, frames, curve.lead, ...ramp.points.map((point) => curve.lead + point.at.value - offset)]),
  ]
    .filter((at) => at >= 0 && at <= frames)
    .sort((a, b) => a - b);
  const out: Stretch[] = [];
  bounds.forEach((from, index) => {
    const to = bounds[index + 1];
    if (to === undefined || to <= from) return;
    const middle = (from + to) / 2;
    const source = middle - curve.lead + offset;
    const pointIndex = ramp.points.findLastIndex((point) => point.at.value <= source);
    const point = ramp.points[pointIndex];
    const next = ramp.points[pointIndex + 1];
    const bend =
      middle >= curve.lead && point && next && ramp.curve !== 'hold' && next.speed !== point.speed
        ? { length: next.at.value - point.at.value, delta: next.speed - point.speed }
        : null;
    out.push({ from, to, bend });
  });
  return out;
}

/** Chords between knots stay this close to the curve, in frames of source time. */
export const KNOT_TOLERANCE = 0.01;

/** The longest chord inside a bend that stays within KNOT_TOLERANCE (at least 1/8 frame). */
function knotStep(bend: NonNullable<Stretch['bend']>, curve: 'linear' | 'ease' | 'hold'): number {
  // Source time is the speed's integral: its second derivative peaks at |Δspeed| / length (linear)
  // or 1.5× that (smoothstep). A chord over h frames misses by at most h² / 8 × that.
  const bendiness = ((curve === 'ease' ? 1.5 : 1) * Math.abs(bend.delta)) / bend.length;
  return Math.max(1 / 8, Math.sqrt((8 * KNOT_TOLERANCE) / bendiness));
}

/**
 * Knots over output frames [0, frames]: straight stretches get their two ends, ramp segments get
 * evenly spaced knots, so straight lines between them are the curve to within KNOT_TOLERANCE.
 */
export function curveKnots(curve: SpeedCurve, frames: number): CurveKnot[] {
  const at = new Set<number>([0, frames]);
  for (const stretch of stretches(curve, frames)) {
    at.add(stretch.from);
    at.add(stretch.to);
    if (!stretch.bend || !curve.ramp) continue;
    const length = stretch.to - stretch.from;
    const count = Math.ceil(length / knotStep(stretch.bend, curve.ramp.curve));
    for (let index = 1; index < count; index++) at.add(stretch.from + (length * index) / count);
  }
  return [...at].sort((a, b) => a - b).map((out) => ({ out, src: sourceFramesAt(curve, out) }));
}

/**
 * The sound of `frames` output frames as pieces of constant tempo: one per straight stretch, and
 * pieces of about 200 ms inside a ramp segment (short enough to follow the curve, long enough for
 * atempo to stay clean). Sample counts are whole and tile exactly: the pieces sum to the frames'
 * samples, and the consumed samples to the source the curve plays.
 */
export function tempoPieces(
  curve: SpeedCurve,
  frames: number,
  rate: FrameRate,
  sampleRate: number,
): TempoPiece[] {
  const chunk = Math.max(1, Math.round(rate.num / rate.den / 5));
  const at = new Set<number>([0, frames]);
  for (const stretch of stretches(curve, frames)) {
    at.add(stretch.from);
    at.add(stretch.to);
    if (stretch.bend) for (let k = stretch.from + chunk; k < stretch.to; k += chunk) at.add(k);
  }
  const bounds = [...at].sort((a, b) => a - b);
  const sourceSample = (k: number) =>
    Math.round((sourceFramesAt(curve, k) * sampleRate * rate.den) / rate.num);
  const pieces: TempoPiece[] = [];
  for (let index = 0; index + 1 < bounds.length; index++) {
    const from = bounds[index]!;
    const to = bounds[index + 1]!;
    pieces.push({
      samples: samplesForFrames(to, rate, sampleRate) - samplesForFrames(from, rate, sampleRate),
      consumed: sourceSample(to) - sourceSample(from),
    });
  }
  return pieces;
}
