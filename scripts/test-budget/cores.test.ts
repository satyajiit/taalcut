// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { testBudget } from './budget.ts';
import { playwrightWorkers, TEST_CORES_ENV, testCores } from './cores.ts';

describe('testCores', () => {
  it('is the whole machine when TAALCUT_TEST_CORES is unset', () => {
    expect(testCores({}, 18)).toBe(18);
    expect(testCores({ OTHER: '4' }, 3)).toBe(3);
  });

  it('is the share it names, up to the whole machine', () => {
    expect(testCores({ [TEST_CORES_ENV]: '9' }, 18)).toBe(9);
    expect(testCores({ [TEST_CORES_ENV]: '1' }, 18)).toBe(1);
    expect(testCores({ [TEST_CORES_ENV]: '18' }, 18)).toBe(18);
  });

  it.for(['', ' ', '0', '-1', '1.5', '9x', ' 9', '9 ', '0x9', '1e1', '19', '090000000000000000000'])(
    'refuses %j, naming the variable and the range',
    (value) => {
      expect(() => testCores({ [TEST_CORES_ENV]: value }, 18)).toThrow(
        `${TEST_CORES_ENV} must be a whole number of cores from 1 to 18 (this machine's), not "${value}"`,
      );
    },
  );
});

describe('a share of the machine', () => {
  it("sizes heavy.sh's slot (9 of 18 cores) at render plus two packages of four files", () => {
    const { tasks, workers } = testBudget(testCores({ [TEST_CORES_ENV]: '9' }, 18));
    expect({ tasks, workers }).toEqual({ tasks: 2, workers: 4 });
    expect(1 + tasks * workers).toBeLessThanOrEqual(9);
  });

  it('gives Playwright half the cores, at least one worker', () => {
    expect(playwrightWorkers(18)).toBe(9);
    expect(playwrightWorkers(9)).toBe(4);
    expect(playwrightWorkers(3)).toBe(1);
    expect(playwrightWorkers(1)).toBe(1);
  });
});
