// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { meetsTarget } from '../../src/gates/gate-metric';
import { bootstrapMedian, mean, median, mulberry32, wilson } from '../../src/gates/stats';

/** Hand-expanded Wilson score for 81/100 at z = 1.96. Not a call into the module. */
const WILSON_81_OF_100 = { low: 0.7222097592919214, high: 0.8748534600729574 };

describe('gate stats', () => {
  it('returns null for an empty proportion, median and mean, never zero', () => {
    expect(wilson(0, 0)).toBeNull();
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
    expect(bootstrapMedian([])).toBeNull();
  });

  it('matches the hand-computed Wilson interval for 81/100', () => {
    const interval = wilson(81, 100);
    expect(interval).not.toBeNull();
    if (interval === null) return;
    expect(interval.low).toBeCloseTo(WILSON_81_OF_100.low, 9);
    expect(interval.high).toBeCloseTo(WILSON_81_OF_100.high, 9);
    expect(Math.abs(interval.low - WILSON_81_OF_100.low)).toBeLessThan(1e-9);
    expect(Math.abs(interval.high - WILSON_81_OF_100.high)).toBeLessThan(1e-9);
  });

  it('keeps the bootstrap median deterministic for a fixed seed', () => {
    const sample = [1, 2, 3, 10, 50];
    const first = bootstrapMedian(sample, 1);
    const second = bootstrapMedian(sample, 1);
    expect(first).not.toBeNull();
    expect(first).toEqual(second);
    expect(first?.median).toBe(3);
    expect(median(sample)).toBe(3);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('does not draw the bootstrap from the global generator', () => {
    const source = readFileSync(new URL('../../src/gates/stats.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('Math.random');
  });

  it('treats an exact fraction on the boundary as a pass for >= and <=', () => {
    const atLeast = { op: '>=' as const, value: 0.4, unit: 'share' };
    expect(meetsTarget(12 / 30, atLeast)).toBe(true);
    expect(meetsTarget(400 / 1000, atLeast)).toBe(true);
    expect(meetsTarget(11 / 30, atLeast)).toBe(false);
    expect(meetsTarget(399 / 1000, atLeast)).toBe(false);
    expect(meetsTarget(0.4, { op: '<=', value: 0.4, unit: 'share' })).toBe(true);
    expect(meetsTarget(3, { op: '<', value: 3, unit: 'seconds' })).toBe(false);
  });
});
