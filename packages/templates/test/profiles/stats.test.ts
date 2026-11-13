// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A profile's arithmetic: type-7 quartiles, tallies in a fixed order, rounding that never gives -0. */
import { describe, expect, it } from 'vitest';
import { bandOf, medianOf, modeOf, quantile, round, roundSeconds, tally } from '../../src/profiles/stats';

describe('profile stats', () => {
  it('interpolates quartiles between closest ranks (R type 7)', () => {
    const sorted = [1, 2, 3, 4];
    expect(quantile(sorted, 0.25)).toBe(1.75);
    expect(quantile(sorted, 0.5)).toBe(2.5);
    expect(quantile(sorted, 0.75)).toBe(3.25);
    expect(quantile([7], 0.25)).toBe(7);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
  });

  it('bands values in any order, rounded to the millisecond', () => {
    expect(bandOf([0.4, 0.1, 0.3, 0.2])).toEqual({ n: 4, q1: 0.175, median: 0.25, q3: 0.325 });
    expect(bandOf([1 / 3, 1 / 3, 1 / 3])).toEqual({ n: 3, q1: 0.333, median: 0.333, q3: 0.333 });
    expect(bandOf([])).toBeNull();
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([])).toBeNull();
  });

  it('tallies most first, ties by value, unseen values left out', () => {
    const rows = tally(['cut', 'whip', 'cut', 'dissolve', 'whip', 'cut']);
    expect(rows).toEqual([
      { value: 'cut', count: 3 },
      { value: 'whip', count: 2 },
      { value: 'dissolve', count: 1 },
    ]);
    expect(tally(['b', 'a'])).toEqual([
      { value: 'a', count: 1 },
      { value: 'b', count: 1 },
    ]);
    expect(modeOf(rows)).toBe('cut');
    expect(modeOf([])).toBeNull();
  });

  it('rounds half away from zero and never returns -0', () => {
    expect(round(-0.0004, 3)).toBe(0);
    expect(Object.is(round(-0.0004, 3), 0)).toBe(true);
    expect(round(2.5, 0)).toBe(3);
    expect(round(-2.5, 0)).toBe(-3);
    expect(roundSeconds(1.23456)).toBe(1.235);
  });
});
