// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stills with gentle motion (P3-B7, SPEC P3.8, G.2): the v1 knobs, GSAP segments per kind, the 4 %-of-the-width-a-second
 * cap at the ease's steepest point (short clips move less), determinism, `none` static and `null` Phase 2's
 * linear push.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, STILL_MOTIONS, type StillMotion } from '@taalcut/core';
import {
  easePeakSlope,
  motionShare,
  STILL_EASE,
  STILL_MOTION,
  stillMotionTracks,
  type StillMotionTrack,
} from '../../src/stills/still-motion';

const rate = FrameRate.of(30);
const span = (frames: number, start = 12) => ({ start, end: start + frames });

/** How far a frame edge travels over the clip, as a share of the canvas width. */
function edgeTravel(tracks: readonly StillMotionTrack[]): number {
  const scale = tracks.find((track) => track.property === 'scale')?.segments[0];
  const translate = tracks.find((track) => track.property === 'xPercent')?.segments[0];
  // A scale change of d moves each edge by d / 2 of the width (the origin is the centre).
  const zoom = scale ? Math.abs(Number(scale.end) - Number(scale.start)) / 2 : 0;
  const pan = translate ? Math.abs(Number(translate.end) - Number(translate.start)) / 100 : 0;
  return zoom + pan;
}

describe('still motion (P3-B7)', () => {
  it('keeps the v1 knobs and the ease', () => {
    expect(STILL_MOTION).toEqual({
      version: 1,
      pushScale: 1.08,
      panScale: 1.06,
      panShare: 0.04,
      maxShareperSecond: 0.04,
    });
    expect(STILL_EASE).toBe('cubic-bezier(0.45, 0, 0.55, 1)');
    // dy/dx at the curve's middle: (6t − 6t²) / (3·0.45·(1−t)² + 6·0.1·t(1−t) + 3·0.45·t²) at t = ½ is 1.5 / 0.825.
    expect(easePeakSlope()).toBeCloseTo(1.5 / 0.825, 4);
    expect(easePeakSlope([0, 0, 1, 1])).toBeCloseTo(1, 6);
  });

  it('pushes in from 1 to 1.08 over a long clip and pulls out the reverse, eased', () => {
    const push = stillMotionTracks('pushIn', span(120), rate);
    expect(push).toEqual([
      {
        property: 'scale',
        rest: 1,
        segments: [{ from: 12, to: 132, start: 1, end: 1.08, easing: STILL_EASE }],
      },
    ]);
    const pull = stillMotionTracks('pullOut', span(120), rate);
    expect(pull).toEqual([
      {
        property: 'scale',
        rest: 1.08,
        segments: [{ from: 12, to: 132, start: 1.08, end: 1, easing: STILL_EASE }],
      },
    ]);
  });

  it('pans 4 % of the width at scale 1.06, left and right', () => {
    const left = stillMotionTracks('panLeft', span(150), rate);
    expect(left).toEqual([
      { property: 'scale', rest: 1.06, segments: [{ from: 12, to: 162, start: 1.06, end: 1.06 }] },
      {
        property: 'xPercent',
        rest: 2,
        segments: [{ from: 12, to: 162, start: 2, end: -2, easing: STILL_EASE }],
      },
    ]);
    const right = stillMotionTracks('panRight', span(150), rate);
    expect(right[1]?.segments[0]).toMatchObject({ start: -2, end: 2 });
  });

  it('never moves an edge faster than 4 % of the width a second, at the ease’s fastest point', () => {
    const moving = STILL_MOTIONS.filter(
      (motion): motion is Exclude<StillMotion, 'none'> => motion !== 'none',
    );
    const peak = easePeakSlope();
    for (const motion of moving)
      for (let frames = 1; frames <= 300; frames++) {
        const seconds = frames / 30;
        const peakSpeed = (edgeTravel(stillMotionTracks(motion, span(frames), rate)) * peak) / seconds;
        expect(peakSpeed, `${motion} over ${frames} frames`).toBeLessThanOrEqual(
          STILL_MOTION.maxShareperSecond + 1e-6,
        );
      }
    // A half-second push moves a fraction of a long one's; past ~1.8 s it makes the whole move.
    const short = stillMotionTracks('pushIn', span(15), rate)[0]?.segments[0];
    expect(Number(short?.end)).toBeGreaterThan(1);
    expect(Number(short?.end)).toBeLessThan(1.03);
    expect(motionShare(55, rate, 0.04)).toBe(1);
    expect(motionShare(54, rate, 0.04)).toBeLessThan(1);
    expect(motionShare(0, rate, 0.04)).toBe(0);
  });

  it('is deterministic and leaves `none` static', () => {
    for (const motion of STILL_MOTIONS)
      expect(stillMotionTracks(motion, span(97), FrameRate.of(30000, 1001))).toEqual(
        stillMotionTracks(motion, span(97), FrameRate.of(30000, 1001)),
      );
    expect(stillMotionTracks('none', span(90), rate)).toEqual([]);
    expect(stillMotionTracks('pushIn', span(0), rate)).toEqual([]);
  });

  it('keeps Phase 2’s slow linear push for a still without a choice', () => {
    expect(stillMotionTracks(null, span(60), rate)).toEqual([
      { property: 'scale', rest: 1, segments: [{ from: 12, to: 72, start: 1, end: 1.08 }] },
    ]);
  });
});
