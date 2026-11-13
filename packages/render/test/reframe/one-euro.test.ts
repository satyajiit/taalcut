// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { createOneEuroFilter, smoothingFactor } from '../../src/reframe/one-euro';
import { pathKeys, smoothAxis, type AxisSmoothing } from '../../src/reframe/crop-path';
import { noise } from './support';

/** τ = 1 s at this cutoff, so α over a 1 s step is exactly 1/2. */
const ONE_SECOND_TAU = 1 / (2 * Math.PI);

describe('1€ filter', () => {
  it('computes α from the cutoff and the time step', () => {
    expect(smoothingFactor(ONE_SECOND_TAU, 1)).toBeCloseTo(0.5, 12);
    expect(smoothingFactor(ONE_SECOND_TAU, 3)).toBeCloseTo(0.75, 12);
  });

  it('matches hand-computed values with β = 0', () => {
    const filter = createOneEuroFilter({ minCutoffHz: ONE_SECOND_TAU, beta: 0, dCutoffHz: ONE_SECOND_TAU });
    expect(filter.filter(0, 0)).toBe(0);
    // ẋ = 10, ẋ̂ = 5, α = 1/2: x̂ = 5.
    expect(filter.filter(10, 1)).toBeCloseTo(5, 12);
    // ẋ = (10 − 5)/1 = 5, ẋ̂ = 5, x̂ = 0.5·10 + 0.5·5.
    expect(filter.filter(10, 2)).toBeCloseTo(7.5, 12);
  });

  it('raises the cutoff with speed (β)', () => {
    const filter = createOneEuroFilter({ minCutoffHz: ONE_SECOND_TAU, beta: 0.1, dCutoffHz: ONE_SECOND_TAU });
    filter.filter(0, 0);
    // ẋ̂ = 5 → fc = 1/(2π) + 0.5 = 0.659155 Hz, τ = 0.241452 s, α = 0.805508.
    expect(filter.filter(10, 1)).toBeCloseTo(8.05508, 4);
  });

  it('uses the real time step, not a nominal rate', () => {
    const a = createOneEuroFilter({ minCutoffHz: ONE_SECOND_TAU, beta: 0, dCutoffHz: ONE_SECOND_TAU });
    a.filter(0, 0);
    expect(a.filter(10, 3)).toBeCloseTo(7.5, 12);
  });
});

const smoothing: AxisSmoothing = {
  filter: { minCutoffHz: 0.6, beta: 0.004, dCutoffHz: 1 },
  deadzone: 9.6,
  maxSpeed: 270,
};

describe('smoothAxis', () => {
  it('holds a still subject with noise inside the deadzone: every step is exactly zero', () => {
    const jitter = noise(7, 3);
    const samples = Array.from({ length: 48 }, (_, index) => ({
      tSeconds: index / 12,
      value: 500 + jitter(),
    }));
    const out = smoothAxis(samples, smoothing);
    for (let index = 1; index < out.length; index++) expect(out[index]).toBe(out[index - 1]);
  });

  it('never moves faster than the speed clamp', () => {
    const samples = Array.from({ length: 40 }, (_, index) => ({
      tSeconds: index / 4,
      value: index === 0 ? 0 : 2000,
    }));
    const out = smoothAxis(samples, smoothing);
    for (let index = 1; index < out.length; index++) {
      const step = (out[index] ?? 0) - (out[index - 1] ?? 0);
      expect(step).toBeLessThanOrEqual(270 / 4 + 1e-9);
      expect(step).toBeGreaterThanOrEqual(0);
    }
    expect(out[out.length - 1]).toBeGreaterThan(1900);
  });

  it('eases to a new point (the centre) without snapping or overshooting', () => {
    const samples = Array.from({ length: 60 }, (_, index) => ({
      tSeconds: index / 12,
      value: index < 12 ? 200 : 960,
    }));
    const out = smoothAxis(samples, smoothing);
    const after = out.slice(12);
    expect(after[0]).toBeLessThan(960);
    for (let index = 1; index < after.length; index++) {
      expect(after[index]).toBeGreaterThanOrEqual(after[index - 1] ?? 0);
      expect(after[index]).toBeLessThanOrEqual(960);
    }
  });

  it('starts a shot at its first point', () => {
    expect(smoothAxis([{ tSeconds: 5, value: 123 }], smoothing)).toEqual([123]);
  });
});

describe('pathKeys', () => {
  it('keys whole frames from 0 to the end, interpolating the ends', () => {
    const keys = pathKeys(
      [
        { frame: -5, x: 0, y: 0 },
        { frame: 5, x: 10, y: 0 },
        { frame: 15.4, x: 20, y: 0 },
      ],
      20,
    );
    expect(keys.map((key) => key.frame)).toEqual([0, 5, 15, 20]);
    expect(keys[0]?.x).toBeCloseTo(5, 9);
    expect(keys[3]?.x).toBe(20);
  });
});
