// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type Interval } from './gate-metric';

const WILSON_Z = 1.96;
const BOOTSTRAP_SAMPLES = 1000;

/** Wilson score interval for a proportion. `0/0` is null, not zero: there is no proportion. */
export function wilson(successes: number, n: number, z = WILSON_Z): Interval | null {
  if (n === 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { low: centre - margin, high: centre + margin };
}

/**
 * Median over durations where null means "never happened" (a participant who did not export). Null sorts after every
 * number. When the middle of the list is a null, the median is longer than anything observed: `not reached`. Empty
 * input is null.
 */
export function censoredMedian(values: readonly (number | null)[]): number | 'not reached' | null {
  if (values.length === 0) return null;
  const observed = values.filter((value): value is number => value !== null);
  const sorted = [...observed].sort((left, right) => left - right);
  const mid = Math.floor(values.length / 2);
  // `sorted[mid]` is past the observed times when the middle (or the upper of two middles) is censored.
  const right = sorted[mid];
  if (right === undefined) return 'not reached';
  if (values.length % 2 === 1) return right;
  const left = sorted[mid - 1];
  if (left === undefined) return 'not reached';
  return (left + right) / 2;
}

/** Empty input is null, not zero. Even counts average the two central values. */
export function median(values: readonly number[]): number | null {
  const point = censoredMedian(values);
  if (point === 'not reached') throw new Error('a median with no censored value was not reached');
  return point;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** mulberry32. Reports stay put across runs, so this is seeded rather than the global generator. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap of the median. 1000 resamples, 2.5 and 97.5 indexes on the sorted
 * resamples (`floor(0.025 * n)` and `ceil(0.975 * n) - 1`). Empty input is null.
 */
export function bootstrapMedian(
  values: readonly number[],
  seed = 1,
  resamples = BOOTSTRAP_SAMPLES,
): { median: number; interval: Interval } | null {
  const point = median(values);
  if (point === null || values.length === 0) return null;
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    const draw: number[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const picked = values[Math.floor(random() * values.length)];
      if (picked === undefined) throw new Error('bootstrap drew past the end of the sample');
      draw.push(picked);
    }
    const drawn = median(draw);
    if (drawn === null) throw new Error('bootstrap median of a non-empty draw was empty');
    samples.push(drawn);
  }
  samples.sort((left, right) => left - right);
  const low = samples[Math.floor(0.025 * resamples)];
  const high = samples[Math.min(resamples - 1, Math.ceil(0.975 * resamples) - 1)];
  if (low === undefined || high === undefined) throw new Error('bootstrap percentile index was empty');
  return { median: point, interval: { low, high } };
}
