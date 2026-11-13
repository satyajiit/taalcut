// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FRM1-MOT: a shot's label and numbers from its frame pairs. */
import { describe, expect, it } from 'vitest';
import { classifyShot, type MotionPair } from '../../src/motion/classify';
import { stepIn } from '../../src/motion/estimate';
import type { PairMotion } from '../../src/motion/pair';

const frame = { width: 384, height: 216 };
const still: PairMotion = {
  dx: 0,
  dy: 0,
  scale: 0,
  rotation: 0,
  inliers: 0.95,
  points: 150,
  residual: 0.001,
  subject: null,
};

/** `n` pairs a tenth of a second apart, each from `make(i)`. */
function shot(n: number, make: (i: number) => Partial<PairMotion> | null): MotionPair[] {
  return Array.from({ length: n }, (_, i) => {
    const part = make(i);
    return { frame: (i + 1) * 3, seconds: 0.1, motion: part === null ? null : { ...still, ...part } };
  });
}

describe('classifyShot', () => {
  it('a still camera is static, whatever a subject does', () => {
    const m = classifyShot(
      shot(15, () => ({ subject: { dx: 0.03, dy: 0 } })),
      frame,
    );
    expect(m.label).toBe('static');
    expect(m.confidence).toBeGreaterThan(0.8);
  });

  it('pans and tilts, with their direction', () => {
    const right = classifyShot(
      shot(15, () => ({ dx: -0.015 })),
      frame,
    );
    expect(right.label).toBe('pan');
    expect(right.panX).toBeCloseTo(0.15, 5);
    const up = classifyShot(
      shot(15, () => ({ dy: 0.02 })),
      frame,
    );
    expect(up.label).toBe('tilt');
    expect(up.panY).toBeCloseTo(-0.2, 5);
  });

  it('a pan is pan and a tilt is tilt in a portrait frame too, by pixels', () => {
    const portrait = { width: 216, height: 384 };
    // 0.02 heights a tenth of a second is more pixels than 0.02 widths.
    expect(
      classifyShot(
        shot(10, () => ({ dx: -0.02, dy: -0.02 })),
        portrait,
      ).label,
    ).toBe('tilt');
  });

  it('push-in and pull-out by the sign of the zoom', () => {
    expect(
      classifyShot(
        shot(15, () => ({ scale: 0.01 })),
        frame,
      ).label,
    ).toBe('push-in');
    expect(
      classifyShot(
        shot(15, () => ({ scale: -0.01 })),
        frame,
      ).label,
    ).toBe('pull-out');
  });

  it('shake with no sustained move is handheld; a pan through shake is still a pan', () => {
    const shake = (i: number) => 0.008 * Math.sin(i * 1.9) + 0.006 * Math.sin(i * 3.1 + 1);
    expect(
      classifyShot(
        shot(20, (i) => ({ dx: shake(i), dy: shake(i + 4) })),
        frame,
      ).label,
    ).toBe('handheld');
    expect(
      classifyShot(
        shot(20, (i) => ({ dx: -0.03 + shake(i) })),
        frame,
      ).label,
    ).toBe('pan');
  });

  it('the background moving while the subject holds still is tracking', () => {
    const m = classifyShot(
      shot(12, () => ({ dx: -0.02, subject: { dx: 0.0005, dy: 0 } })),
      frame,
    );
    expect(m.label).toBe('tracking');
    expect(m.subjectSteady).toBe(true);
    // The subject moving with the picture is no tracking: it is a pan past something.
    expect(
      classifyShot(
        shot(12, () => ({ dx: -0.02, subject: { dx: -0.02, dy: 0 } })),
        frame,
      ).label,
    ).toBe('pan');
  });

  it('a walk behind someone is tracking: the far background barely moves, the walker keeps their place', () => {
    const sway = (i: number) => 0.003 * Math.sin(i * 2.3);
    const walk = classifyShot(
      shot(10, (i) => ({ scale: 0.003, dy: -0.002 + sway(i), subject: { dx: 0.002, dy: 0 } })),
      frame,
    );
    expect(walk.label).toBe('tracking');
    // The same slow move with no subject seen is a hand's wander.
    expect(
      classifyShot(
        shot(10, (i) => ({ scale: 0.003, dy: -0.002 + sway(i) })),
        frame,
      ).label,
    ).toBe('handheld');
  });

  it('a drift under 3% of the frame over the shot is a hand, not a pan', () => {
    const shake = (i: number) => 0.003 * Math.sin(i * 1.9);
    // 0.035 widths a second for half a second: 1.75% of the frame.
    expect(
      classifyShot(
        shot(5, (i) => ({ dx: -0.0035 + shake(i) })),
        frame,
      ).label,
    ).toBe('handheld');
    // The same speed for two seconds travels 7%: a slow pan.
    expect(
      classifyShot(
        shot(20, (i) => ({ dx: -0.0035 + shake(i) })),
        frame,
      ).label,
    ).toBe('pan');
  });

  it('nothing measured is no label', () => {
    const m = classifyShot(
      shot(5, () => null),
      frame,
    );
    expect(m.label).toBeNull();
    expect(m.confidence).toBe(0);
  });

  it('poorly measured pairs lower the confidence', () => {
    const half = classifyShot(
      shot(10, (i) => (i % 2 ? null : { dx: -0.02, inliers: 0.3 })),
      frame,
    );
    expect(half.confidence).toBeLessThan(0.5);
  });
});

describe('stepIn', () => {
  it('reads every third frame at 30 fps, closer in a short shot', () => {
    expect(stepIn({ start: 0, end: 90 }, 30, 10, 6)).toBe(3);
    expect(stepIn({ start: 196, end: 214 }, 30, 10, 6)).toBe(2);
    expect(stepIn({ start: 317, end: 326 }, 30, 10, 6)).toBe(1);
  });
});
