// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media time on a clip (SPEC, "Media time on a clip"). A clip lasts `duration`
 * canvas frames; `speed` maps those frames to source time. Real-time clips
 * consume exactly their duration; a ramp consumes its integral, rounded up to
 * whole media frames. Ramp speeds are floats (the template's), so this is the
 * one place float seconds appear, and they never go back into the document.
 */
import { FrameRate, RationalTime, TimeRange, type Clip, type SpeedRamp } from '@taalcut/core';

const EPSILON = 1e-9;

type Point = SpeedRamp['points'][number];

/** Integral of the speed over [a, a + u·len] of one segment, in canvas frames of source time. */
function segmentIntegral(curve: SpeedRamp['curve'], from: Point, to: Point, len: number, u: number): number {
  const s0 = from.speed;
  const ds = to.speed - from.speed;
  if (curve === 'hold') return len * s0 * u;
  // ease is smoothstep 3u² − 2u³, whose integral from 0 to u is u³ − u⁴/2.
  const shape = curve === 'linear' ? (u * u) / 2 : u ** 3 - u ** 4 / 2;
  return len * (s0 * u + ds * shape);
}

/** Source time a ramp plays over its first `frames` canvas frames, in canvas frames (fractional). */
function integral(ramp: SpeedRamp, frames: number): number {
  if (frames < 0) return frames * (ramp.points[0]?.speed ?? 1);
  let total = 0;
  const points = ramp.points;
  for (let index = 0; index < points.length; index++) {
    const point = points[index] as Point;
    const start = point.at.value;
    if (frames <= start) break;
    const next = points[index + 1];
    if (!next) {
      total += (frames - start) * point.speed;
      break;
    }
    const len = next.at.value - start;
    const u = Math.min(1, (frames - start) / len);
    total += segmentIntegral(ramp.curve, point, next, len, u);
  }
  return total;
}

/** Integrate a retained window of the original curve; truncating points would reshape easing. */
export function rampFrames(ramp: SpeedRamp, frames: number): number {
  const offset = ramp.windowStart?.value ?? 0;
  return integral(ramp, offset + frames) - integral(ramp, offset);
}

/**
 * Source time, in canvas frames, a clip plays over its first `frames` canvas frames: the ramp's integral
 * (never the speed at frame 0, which misplaces anything past a ramp's start), real time without a ramp.
 * Negative `frames` (before the clip's start) extend it at its starting speed.
 */
export function sourceFrames(ramp: SpeedRamp | null, frames: number): number {
  if (!ramp) return frames;
  return rampFrames(ramp, frames);
}

/** Source time per timeline frame over a clip's first `frames` frames: 1 in real time (EDT1-OPS: timeline.get). */
export function meanSpeedOf(ramp: SpeedRamp | null, frames: number): number {
  return !ramp || frames <= 0 ? 1 : rampFrames(ramp, frames) / frames;
}

/** Speed at canvas frame `frame` of the item, for trimming a ramp without changing its shape. */
export function speedAt(ramp: SpeedRamp, frame: number): number {
  frame += ramp.windowStart?.value ?? 0;
  const points = ramp.points;
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index] as Point;
    if (frame < point.at.value) continue;
    const next = points[index + 1];
    if (!next || ramp.curve === 'hold') return point.speed;
    const u = (frame - point.at.value) / (next.at.value - point.at.value);
    const shape = ramp.curve === 'linear' ? u : 3 * u * u - 2 * u ** 3;
    return point.speed + (next.speed - point.speed) * shape;
  }
  return points[0]?.speed ?? 1;
}

/** Retain the curve's control points when trimming: easing depends on both ends of each segment. */
export function trimRamp(ramp: SpeedRamp, _frames: number): SpeedRamp {
  const rate = ramp.points[0]?.at.rate ?? FrameRate.of(30);
  return { ...ramp, windowStart: ramp.windowStart ?? RationalTime.of(0, rate) };
}

/** Media a clip uses from its sourceStart, at the media's rate for ramps; exact (canvas rate) in real time. */
export function consumedMedia(
  clip: Pick<Clip, 'duration' | 'speed'>,
  mediaRate: FrameRate,
  canvasRate: FrameRate,
): RationalTime {
  if (!clip.speed) return clip.duration;
  const seconds = rampFrames(clip.speed, clip.duration.value) / FrameRate.toNumber(canvasRate);
  return RationalTime.of(Math.ceil(seconds * FrameRate.toNumber(mediaRate) - EPSILON), mediaRate);
}

/** The media's frame rate; null for stills. */
export function mediaRate(media: Clip['media']): FrameRate | null {
  return media.kind === 'image' ? null : media.available.start.rate;
}

/** The clip's media, from sourceStart, lies inside its available range (stills always fit). */
export function clipMediaFits(clip: Clip, canvasRate: FrameRate): boolean {
  if (clip.media.kind === 'image') return true;
  if (clip.holdFrame) return TimeRange.contains(clip.media.available, clip.holdFrame);
  const { available } = clip.media;
  const used = consumedMedia(clip, available.start.rate, canvasRate);
  const end = RationalTime.add(clip.sourceStart, used);
  return (
    RationalTime.compare(available.start, clip.sourceStart) <= 0 &&
    RationalTime.compare(end, TimeRange.end(available)) <= 0
  );
}

/**
 * A gentler copy of `ramp`: speeds pulled toward real time until the media from `sourceStart` fits in
 * `available`. Null when even real time doesn't fit.
 */
export function gentlerRamp(
  clip: Pick<Clip, 'duration' | 'speed' | 'sourceStart'>,
  available: TimeRange,
  canvasRate: FrameRate,
): SpeedRamp | null {
  const ramp = clip.speed;
  if (!ramp) return null;
  const fits = (candidate: SpeedRamp | null) => {
    const used = consumedMedia(
      { duration: clip.duration, speed: candidate },
      available.start.rate,
      canvasRate,
    );
    return RationalTime.compare(RationalTime.add(clip.sourceStart, used), TimeRange.end(available)) <= 0;
  };
  if (!fits(null)) return null;
  const soften = (k: number): SpeedRamp => ({
    ...ramp,
    points: ramp.points.map((point) => ({ ...point, speed: Math.max(0.1, 1 + (point.speed - 1) * k) })),
  });
  let low = 0;
  let high = 1;
  // Twenty halvings resolve k to a millionth: the ramp is as close to the template's as the media allows.
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2;
    if (fits(soften(mid))) low = mid;
    else high = mid;
  }
  return low === 0 ? null : soften(low);
}
