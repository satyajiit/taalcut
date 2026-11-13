// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { baselineOf, median, regressionOf } from '../../src/perf/baseline';
import { type PerfRow } from '../../src/perf/schema';

function row(overrides: Partial<PerfRow> = {}): PerfRow {
  const runner = { id: 'm1-8gb', chip: 'apple-m1', memoryGb: 8, macos: '15', ...overrides.runner };
  const build = { flavour: 'dev', version: '0.0.0', ...overrides.build };
  return {
    v: 1,
    suite: 'perf',
    metric: 'index-1h',
    unit: 'minutes',
    value: 30,
    better: 'lower',
    commit: 'abc123',
    date: '2026-01-01',
    synthetic: false,
    footage: 'device-lab',
    ...overrides,
    runner,
    build,
  };
}

describe('median', () => {
  it('picks the middle of an odd list after sorting', () => {
    expect(median([1, 9, 3])).toBe(3);
  });

  it('averages the two middle values of an even list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('rejects an empty list', () => {
    expect(() => median([])).toThrow(/empty/);
  });
});

describe('baselineOf', () => {
  it('uses the median of the last 7 by date, ignoring other series', () => {
    const history = [
      row({ date: '2026-01-10', value: 100 }),
      row({ date: '2026-01-01', value: 1 }),
      row({ date: '2026-01-02', value: 2 }),
      row({ date: '2026-01-03', value: 3 }),
      row({ date: '2026-01-04', value: 4 }),
      row({ date: '2026-01-05', value: 5 }),
      row({ date: '2026-01-06', value: 6 }),
      row({ date: '2026-01-07', value: 7 }),
      row({ date: '2026-01-08', value: 8 }),
      row({ date: '2026-01-09', value: 9 }),
      row({ date: '2026-01-11', value: 999, metric: 'render-60s' }),
      row({
        date: '2026-01-11',
        value: 999,
        runner: { id: 'recommended', chip: 'm', memoryGb: 16, macos: '15' },
      }),
      row({ date: '2026-01-11', value: 999, footage: 'synthetic' }),
    ];
    const current = row({ date: '2026-01-12', value: 1 });
    expect(baselineOf(history, current)).toBe(7);
  });

  it('breaks date ties by later file order', () => {
    const history = [
      row({ date: '2026-01-01', value: 1 }),
      row({ date: '2026-01-01', value: 100 }),
      row({ date: '2026-01-02', value: 2 }),
      row({ date: '2026-01-03', value: 3 }),
      row({ date: '2026-01-04', value: 4 }),
      row({ date: '2026-01-05', value: 5 }),
      row({ date: '2026-01-06', value: 6 }),
      row({ date: '2026-01-07', value: 7 }),
    ];
    expect(baselineOf(history, row({ date: '2026-01-08' }))).toBe(5);
  });

  it('leaves noisy rows out (IX-F3)', () => {
    const history = [
      row({ date: '2026-01-01', value: 10 }),
      row({ date: '2026-01-02', value: 50, noisy: ['run 1: load 20'] }),
      row({ date: '2026-01-03', value: 12 }),
    ];
    expect(baselineOf(history, row({ date: '2026-01-04' }))).toBe(11);
    expect(baselineOf([row({ noisy: ['run 1: load 20'] })], row())).toBeUndefined();
  });

  it('is undefined when nothing matches', () => {
    expect(baselineOf([], row())).toBeUndefined();
    expect(baselineOf([row({ metric: 'render-60s' })], row())).toBeUndefined();
  });
});

describe('regressionOf', () => {
  it('does not regress at exactly 10% worse', () => {
    expect(regressionOf(100, 110, 'lower')).toEqual({ worseBy: 0.1, regresses: false });
    expect(regressionOf(100, 90, 'higher')).toEqual({ worseBy: 0.1, regresses: false });
  });

  it('regresses when worse by 10% plus a tiny epsilon', () => {
    const lower = regressionOf(100, 110 + 1e-6, 'lower');
    expect(lower.worseBy).toBeGreaterThan(0.1);
    expect(lower.regresses).toBe(true);
    const higher = regressionOf(100, 90 - 1e-6, 'higher');
    expect(higher.worseBy).toBeGreaterThan(0.1);
    expect(higher.regresses).toBe(true);
  });

  it('does not regress a lower-is-better metric that improved', () => {
    const verdict = regressionOf(100, 80, 'lower');
    expect(verdict.worseBy).toBeLessThan(0);
    expect(verdict.regresses).toBe(false);
  });

  it('regresses a higher-is-better metric that dropped by more than 10%', () => {
    const verdict = regressionOf(100, 89, 'higher');
    expect(verdict.worseBy).toBeCloseTo(0.11);
    expect(verdict.regresses).toBe(true);
  });

  it('treats a zero baseline as no ratio', () => {
    expect(regressionOf(0, 0, 'lower')).toEqual({ worseBy: 0, regresses: false });
    expect(regressionOf(0, 5, 'lower').regresses).toBe(true);
    expect(regressionOf(0, 5, 'lower').worseBy).toBe(Number.POSITIVE_INFINITY);
    expect(regressionOf(0, 5, 'higher')).toEqual({ worseBy: 0, regresses: false });
  });
});
