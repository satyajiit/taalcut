// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stills as slot fillers with gentle motion (P3-B7, SPEC P3.8): a clip's `stillMotion` as transform segments
 * for tc.js (GSAP's `scale` and `xPercent`; the CSS cubic-bezier through CustomEase, SPEC G.2). Push in scales 1.00 → 1.08 over the clip, pull out the reverse, pans move 4 % of the canvas width
 * at scale 1.06, all eased, and never faster than 4 % of the width a second at any instant (the ease's steepest
 * point included): a short clip moves less. `null` keeps Phase 2's slow linear push; `none` is static. Pure and
 * deterministic.
 */
import type { FrameRate, StillMotion } from '@taalcut/core';
import type { AnimatedProperty, Segment, TrackValue } from '../compile/tracks';
import type { FrameSpan } from '../plan/types';

/** The ease's control points (x1, y1, x2, y2); STILL_EASE is the same curve as CSS. */
export const STILL_EASE_POINTS = [0.45, 0, 0.55, 1] as const;
export const STILL_EASE = `cubic-bezier(${STILL_EASE_POINTS.join(', ')})`;

/** A cubic Bézier's coordinate at t with end points 0 and 1 and control values a and b. */
const bezier = (a: number, b: number, t: number) =>
  3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;

/**
 * The steepest slope of a CSS cubic-bezier ease (progress per unit of time at its fastest), sampled finely: an
 * eased move of average speed v peaks at v times this.
 */
export function easePeakSlope(points: readonly [number, number, number, number] = STILL_EASE_POINTS): number {
  const [x1, y1, x2, y2] = points;
  const steps = 2_000;
  let peak = 0;
  for (let index = 0; index < steps; index++) {
    const t0 = index / steps;
    const t1 = (index + 1) / steps;
    const dx = bezier(x1, x2, t1) - bezier(x1, x2, t0);
    const dy = bezier(y1, y2, t1) - bezier(y1, y2, t0);
    if (dx > 0) peak = Math.max(peak, dy / dx);
  }
  return peak;
}

const PEAK_SLOPE = easePeakSlope();

/** Versioned knobs (SPEC P3.8). */
export const STILL_MOTION = {
  version: 1,
  /** Push in and pull out: the scale at the far end. */
  pushScale: 1.08,
  /** Pans run at this scale, so the frame never shows an edge. */
  panScale: 1.06,
  /** How far a pan travels, as a share of the canvas width. */
  panShare: 0.04,
  /** The fastest any motion may move a frame edge, as a share of the width per second. */
  maxShareperSecond: 0.04,
} as const;

/** Phase 2's default for stills without a choice. */
const DEFAULT_SCALE = 1.08;

export interface StillMotionTrack {
  readonly property: AnimatedProperty;
  readonly rest: TrackValue;
  readonly segments: readonly Segment[];
}

const fixed = (value: number) => Math.round(value * 1e5) / 1e5;
/** A motion amount at the keyframes' precision, rounded down so rounding never pushes it over the cap. */
const capped = (value: number) => Math.floor(value * 1e5) / 1e5;

/**
 * The share of the full motion a clip of `frames` may make: 1 when it lasts long enough to stay under the
 * speed cap at the ease's fastest point, less for a short clip.
 */
export function motionShare(frames: number, rate: FrameRate, fullShare: number): number {
  const seconds = (frames * rate.den) / rate.num;
  if (seconds <= 0 || fullShare <= 0) return 0;
  return Math.min(1, (STILL_MOTION.maxShareperSecond * seconds) / (fullShare * PEAK_SLOPE));
}

/**
 * The tracks one still's motion adds over `span` (the clip's window, already clear of any transition that
 * animates the same property). Empty for `none`.
 */
export function stillMotionTracks(
  motion: StillMotion | null,
  span: FrameSpan,
  rate: FrameRate,
): StillMotionTrack[] {
  const frames = span.end - span.start;
  if (frames <= 0 || motion === 'none') return [];
  const whole = { from: span.start, to: span.end };
  if (motion === null)
    return [{ property: 'scale', rest: 1, segments: [{ ...whole, start: 1, end: DEFAULT_SCALE }] }];
  if (motion === 'pushIn' || motion === 'pullOut') {
    // A scale change of d moves each edge by d / 2 of the width.
    const growth = capped(
      (STILL_MOTION.pushScale - 1) * motionShare(frames, rate, (STILL_MOTION.pushScale - 1) / 2),
    );
    const [start, end] = motion === 'pushIn' ? [1, 1 + growth] : [1 + growth, 1];
    return [
      {
        property: 'scale',
        rest: fixed(start),
        segments: [{ ...whole, start: fixed(start), end: fixed(end), easing: STILL_EASE }],
      },
    ];
  }
  const travel = STILL_MOTION.panShare * motionShare(frames, rate, STILL_MOTION.panShare);
  // Percent of the element's own width, which is the canvas width.
  const offset = capped((travel / 2) * 100);
  const [from, to] = motion === 'panLeft' ? [offset, -offset] : [-offset, offset];
  const scale = fixed(STILL_MOTION.panScale);
  return [
    { property: 'scale', rest: scale, segments: [{ ...whole, start: scale, end: scale }] },
    {
      property: 'xPercent',
      rest: fixed(from),
      segments: [{ ...whole, start: fixed(from), end: fixed(to), easing: STILL_EASE }],
    },
  ];
}
