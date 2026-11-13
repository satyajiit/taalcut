// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Media time on a ramped clip: integrals per curve, trimming keeps the shape, gentler ramps fit the media. */
import { FrameRates, RationalTime, TimeRange, type SpeedRamp } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { consumedMedia, gentlerRamp, rampFrames, sourceFrames, speedAt, trimRamp } from '../src/model/speed';

const rate = FrameRates.fps30;
const at = (frame: number) => RationalTime.of(frame, rate);
const ramp = (curve: SpeedRamp['curve'], points: readonly [number, number][]): SpeedRamp => ({
  curve,
  points: points.map(([frame, speed]) => ({ at: at(frame), speed })),
});

describe('speed ramps', () => {
  it('integrates hold, linear and ease segments', () => {
    expect(
      rampFrames(
        ramp('hold', [
          [0, 2],
          [10, 1],
        ]),
        20,
      ),
    ).toBe(30);
    // Linear 1 → 3 over 10 frames: mean speed 2.
    expect(
      rampFrames(
        ramp('linear', [
          [0, 1],
          [10, 3],
        ]),
        10,
      ),
    ).toBeCloseTo(20, 9);
    // Ease (smoothstep) has the same mean as linear over a whole segment.
    expect(
      rampFrames(
        ramp('ease', [
          [0, 1],
          [10, 3],
        ]),
        10,
      ),
    ).toBeCloseTo(20, 9);
    // Half way through, ease has gone less far than linear.
    expect(
      rampFrames(
        ramp('ease', [
          [0, 1],
          [10, 3],
        ]),
        5,
      ),
    ).toBeLessThan(
      rampFrames(
        ramp('linear', [
          [0, 1],
          [10, 3],
        ]),
        5,
      ),
    );
    // Past the last point the last speed holds.
    expect(
      rampFrames(
        ramp('linear', [
          [0, 1],
          [10, 3],
        ]),
        20,
      ),
    ).toBeCloseTo(50, 9);
  });

  it('measures the source a clip plays over its first frames with the integral, before it with the start speed', () => {
    const linear = ramp('linear', [
      [0, 0.5],
      [60, 2],
    ]);
    expect(sourceFrames(linear, 30)).toBeCloseTo(26.25, 9);
    expect(sourceFrames(linear, -10)).toBeCloseTo(-5, 9);
    expect(sourceFrames(null, 30)).toBe(30);
  });

  it('reads the speed at a frame', () => {
    const linear = ramp('linear', [
      [0, 1],
      [10, 3],
    ]);
    expect(speedAt(linear, 0)).toBe(1);
    expect(speedAt(linear, 5)).toBeCloseTo(2, 9);
    expect(speedAt(linear, 15)).toBe(3);
    expect(
      speedAt(
        ramp('hold', [
          [0, 2],
          [10, 1],
        ]),
        9,
      ),
    ).toBe(2);
    expect(
      speedAt(
        ramp('ease', [
          [0, 1],
          [10, 3],
        ]),
        5,
      ),
    ).toBeCloseTo(2, 9);
  });

  it.each(['linear', 'ease', 'hold'] as const)(
    'retains the original %s curve through partial and repeated cuts',
    (curve) => {
      const original = ramp(curve, [
        [0, 1],
        [10, 3],
        [20, 1],
      ]);
      const trimmed = trimRamp(original, 15);
      for (let frame = 0; frame <= 15; frame++)
        expect(rampFrames(trimmed, frame)).toBeCloseTo(rampFrames(original, frame), 9);
      const window = { ...trimmed, windowStart: at(4) };
      for (let frame = 0; frame <= 11; frame++) {
        expect(rampFrames(window, frame)).toBeCloseTo(
          rampFrames(original, frame + 4) - rampFrames(original, 4),
          9,
        );
        expect(speedAt(window, frame)).toBeCloseTo(speedAt(original, frame + 4), 9);
      }
      const again = { ...trimRamp(window, 7), windowStart: at(7) };
      expect(rampFrames(again, 4)).toBeCloseTo(rampFrames(original, 11) - rampFrames(original, 7), 9);
    },
  );

  it('rounds consumed media up to whole media frames, exact in real time', () => {
    const duration = at(30);
    expect(consumedMedia({ duration, speed: null }, FrameRates.fps29_97, rate)).toEqual(duration);
    const fast = ramp('hold', [
      [0, 2],
      [30, 2],
    ]);
    expect(consumedMedia({ duration, speed: fast }, FrameRates.fps25, rate)).toEqual(
      RationalTime.of(50, FrameRates.fps25),
    );
    const third = ramp('hold', [
      [0, 1 / 3],
      [30, 1 / 3],
    ]);
    expect(consumedMedia({ duration, speed: third }, FrameRates.fps30, rate).value).toBe(10);
  });

  it('softens a ramp until the media fits, or gives up', () => {
    const fast = ramp('hold', [
      [0, 3],
      [30, 3],
    ]);
    const available = TimeRange.of(at(0), at(60));
    const clip = { duration: at(30), speed: fast, sourceStart: at(0) };
    const gentler = gentlerRamp(clip, available, rate);
    expect(gentler).not.toBeNull();
    const used = consumedMedia({ duration: clip.duration, speed: gentler }, rate, rate);
    expect(used.value).toBeLessThanOrEqual(60);
    expect(used.value).toBeGreaterThan(55);
    expect(gentlerRamp({ ...clip, sourceStart: at(40) }, available, rate)).toBeNull();
    expect(gentlerRamp({ ...clip, speed: null }, available, rate)).toBeNull();
  });
});
