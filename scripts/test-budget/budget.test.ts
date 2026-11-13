// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { LONG_POLE, testBudget, turboRuns } from './budget.ts';

describe('testBudget', () => {
  it('keeps the long pole plus the others within the cores', () => {
    for (const cores of [1, 2, 3, 4, 8, 10, 12, 18, 24, 64]) {
      const { tasks, workers } = testBudget(cores);
      expect(tasks, `${cores} cores`).toBeGreaterThanOrEqual(1);
      expect(workers, `${cores} cores`).toBeGreaterThanOrEqual(1);
      if (cores > 1) expect(1 + tasks * workers, `${cores} cores`).toBeLessThanOrEqual(cores);
    }
  });

  it('runs two packages at a time with eight files each on this 18-core Mac, one with two on a 3-core runner', () => {
    expect(testBudget(18)).toEqual({ tasks: 2, workers: 8 });
    expect(testBudget(3)).toEqual({ tasks: 1, workers: 2 });
  });
});

describe('turboRuns', () => {
  const budget = { tasks: 2, workers: 8 };

  it('starts the long pole on its own and every other package within the budget', () => {
    expect(LONG_POLE).toEqual(['@taalcut/render']);
    expect(turboRuns('test', budget, [])).toEqual([
      ['run', 'test', '--continue', '--filter=@taalcut/render'],
      ['run', 'test', '--continue', '--filter=!@taalcut/render', '--concurrency=2', '--', '--maxWorkers=8'],
    ]);
  });

  it("passes turbo's arguments to both runs and the test runner's after its own", () => {
    expect(turboRuns('test:coverage', budget, ['--force', '--', '-t', 'probe'])).toEqual([
      ['run', 'test:coverage', '--continue', '--force', '--filter=@taalcut/render', '--', '-t', 'probe'],
      [
        'run',
        'test:coverage',
        '--continue',
        '--force',
        '--filter=!@taalcut/render',
        '--concurrency=2',
        '--',
        '--maxWorkers=8',
        '-t',
        'probe',
      ],
    ]);
  });

  it('runs the packages a caller picks in one run, within the budget', () => {
    for (const filter of [
      ['--filter=@taalcut/media'],
      ['--filter', '@taalcut/media'],
      ['-F', '@taalcut/media'],
    ])
      expect(turboRuns('test', budget, filter)).toEqual([
        ['run', 'test', '--continue', ...filter, '--concurrency=2', '--', '--maxWorkers=8'],
      ]);
  });
});
