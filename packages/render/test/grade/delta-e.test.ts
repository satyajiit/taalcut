// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { ciede2000, frameDeltaE, labOfRgb, type Lab } from '../../src/grade/delta-e';

/** Pairs from Sharma, Wu and Dalal (2005), table 1. */
const SHARMA: readonly (readonly [Lab, Lab, number])[] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
];

describe('ciede2000', () => {
  it.each(SHARMA)('matches the published test pair %#', (one, two, expected) => {
    expect(ciede2000(one, two)).toBeCloseTo(expected, 4);
    expect(ciede2000(two, one)).toBeCloseTo(expected, 4);
  });

  it('is zero for a colour and itself', () => {
    expect(ciede2000([62, 12, -30], [62, 12, -30])).toBe(0);
  });
});

describe('labOfRgb', () => {
  it('puts white at L 100 and black at L 0 with no chroma', () => {
    const white = labOfRgb(255, 255, 255);
    expect(white[0]).toBeCloseTo(100, 3);
    expect(Math.hypot(white[1], white[2])).toBeLessThan(0.01);
    expect(labOfRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });
});

describe('frameDeltaE', () => {
  it('reports mean, p95 and max over every pixel', () => {
    const one = Uint8Array.from([10, 20, 30, 200, 100, 50]);
    const same = frameDeltaE(one, one);
    expect(same).toEqual({ mean: 0, p95: 0, max: 0, pixels: 2 });
    const shifted = frameDeltaE(one, Uint8Array.from([10, 20, 30, 210, 100, 50]));
    expect(shifted.max).toBeGreaterThan(0);
    expect(shifted.mean).toBeCloseTo(shifted.max / 2, 6);
  });
});
