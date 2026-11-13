// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ramp in the export follows its exact curve (SPEC section 3, "Speed"): the integral, its inverse,
 * the setpts expression the conform runs, and the sound's tempo pieces. The review case: a linear
 * ramp from 0.5× to 2× over 60 frames has played 26.25 frames of source 30 frames in, not the mean's
 * 37.5.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type SpeedRamp } from '@taalcut/core';
import {
  curveKnots,
  KNOT_TOLERANCE,
  outputFramesAt,
  sourceFramesAt,
  speedCurve,
  tempoPieces,
} from '../../src/plan/speed-curve';
import { speedFilter } from '../../src/plan/speed-filters';
import { samplesForFrames } from '../../src/time/frames';

const rate = FrameRate.of(30);
const ramp = (curve: SpeedRamp['curve'], points: readonly [number, number][]): SpeedRamp => ({
  curve,
  points: points.map(([at, speed]) => ({ at: RationalTime.of(at, rate), speed })),
});
const slowToFast = ramp('linear', [
  [0, 0.5],
  [60, 2],
]);

/** Runs the setpts expression in JS: output seconds for source seconds `u` from the first frame. */
function setptsOf(filter: string): (u: number) => number {
  const body = /^setpts='st\(0,T-STARTT\);\((.*)\)\/TB'$/.exec(filter)?.[1];
  if (!body) throw new Error(`unexpected filter ${filter.slice(0, 60)}`);
  const js = body
    .replace(/ld\(0\)/g, 'u')
    .replace(/\bif\(/g, 'IF(')
    .replace(/\blt\(/g, 'LT(');
  const run = new Function('u', 'IF', 'LT', `return ${js};`) as (
    u: number,
    IF: (c: number, a: number, b: number) => number,
    LT: (a: number, b: number) => number,
  ) => number;
  return (u) =>
    run(
      u,
      (c, a, b) => (c ? a : b),
      (a, b) => (a < b ? 1 : 0),
    );
}

describe('speed curve', () => {
  it('plays the integral of the ramp, not its mean', () => {
    const curve = speedCurve(slowToFast, 0, rate);
    expect(sourceFramesAt(curve, 30)).toBeCloseTo(26.25, 9);
    expect(sourceFramesAt(curve, 60)).toBeCloseTo(75, 9);
    // Past the last point the last speed holds.
    expect(sourceFramesAt(curve, 70)).toBeCloseTo(95, 9);
  });

  it('plays a transition lead-in at real time, then the ramp from the cut', () => {
    const curve = speedCurve(slowToFast, 4, rate);
    expect(sourceFramesAt(curve, 3)).toBe(3);
    expect(sourceFramesAt(curve, 34)).toBeCloseTo(4 + 26.25, 9);
  });

  it('inverts exactly enough to place words', () => {
    const curve = speedCurve(
      ramp('ease', [
        [0, 2],
        [20, 0.25],
        [50, 1],
      ]),
      3,
      rate,
    );
    for (const k of [0, 2.5, 3, 10, 22.75, 49, 80])
      expect(outputFramesAt(curve, sourceFramesAt(curve, k))).toBeCloseTo(k, 6);
    expect(outputFramesAt(speedCurve(null, 0, rate), 12.5)).toBe(12.5);
  });

  it('keeps knots within a hundredth of a frame of the curve', () => {
    for (const shape of ['linear', 'ease'] as const) {
      const curve = speedCurve(
        ramp(shape, [
          [0, 0.1],
          [90, 4],
          [120, 1],
        ]),
        2,
        rate,
      );
      const knots = curveKnots(curve, 150);
      for (let index = 0; index + 1 < knots.length; index++) {
        const a = knots[index]!;
        const b = knots[index + 1]!;
        for (let k = a.out; k <= b.out; k += 0.25) {
          const chord = a.src + ((b.src - a.src) * (k - a.out)) / (b.out - a.out);
          const exact = sourceFramesAt(curve, k);
          expect(Math.abs(chord - exact)).toBeLessThanOrEqual(KNOT_TOLERANCE + 1e-9);
        }
      }
    }
  });

  it('builds a setpts that puts every output frame on its curve position', () => {
    expect(speedFilter(speedCurve(null, 0, rate), 30, rate)).toBe('setpts=PTS-STARTPTS');
    const curve = speedCurve(slowToFast, 2, rate);
    const filter = speedFilter(curve, 91, rate);
    const tau = setptsOf(filter);
    for (let k = 0; k <= 91; k++) {
      // Half a frame along both axes, so fps (round=near) shows the source frame nearest the curve.
      const out = tau((sourceFramesAt(curve, k) + 0.5) / 30) * 30;
      expect(Math.abs(out - (k + 0.5))).toBeLessThan(0.02);
    }
    // The mean speed (1.25) would put frame 30 of the ramp 11 source frames late.
    expect(Math.abs(tau(38 / 30) * 30 - 32.5)).toBeGreaterThan(5);
    // The first frame keeps time zero: fps starts its output there.
    expect(tau(0)).toBe(0);
  });

  it('cuts the sound into pieces that tile exactly and follow the ramp', () => {
    const curve = speedCurve(slowToFast, 0, rate);
    const pieces = tempoPieces(curve, 90, rate, 48_000);
    expect(pieces.reduce((sum, piece) => sum + piece.samples, 0)).toBe(samplesForFrames(90, rate, 48_000));
    expect(pieces.reduce((sum, piece) => sum + piece.consumed, 0)).toBe(
      Math.round((sourceFramesAt(curve, 90) * 48_000) / 30),
    );
    const tempos = pieces.map((piece) => piece.consumed / piece.samples);
    expect(tempos[0]).toBeLessThan(0.6);
    expect(tempos.at(-1)).toBeCloseTo(2, 6);
    // Inside the ramp each piece is about 200 ms and faster than the one before.
    expect(pieces.slice(0, 10).every((piece) => piece.samples === 9600)).toBe(true);
    for (let index = 1; index < 10; index++) expect(tempos[index]!).toBeGreaterThan(tempos[index - 1]!);
  });
});
