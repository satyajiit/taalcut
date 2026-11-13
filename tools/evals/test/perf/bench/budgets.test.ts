// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetMarkdown,
  budgetWarnings,
  checkBudgets,
  measuresOf,
  readBudgetFile,
  tightenBudgets,
  type Budgetable,
  type BudgetFile,
} from '../../../src/perf/bench/budgets';
import { parseBenchArgs } from '../../../src/perf/bench/options';
import { indexRows, unusableBench, type NightlyBench } from '../../../src/perf/index-rows';
import type { PerfRunMeta } from '../../../src/perf/measure';
import type { BenchOcr } from '../../../src/perf/bench/ocr';
import type { Spread } from '../../../src/perf/bench/stats';

const spread = (median: number): Spread => ({ median, min: median * 0.9, max: median * 1.1, n: 3 });

/** Read on-screen text with the mac helper in every run. */
const OCR: BenchOcr = {
  setup: {
    mode: 'helper',
    helper: { path: '/repo/native/mac-helper/dist/taalcut-mac-helper', version: '1.0.0' },
    reason: null,
  },
  helperRuns: 3,
  sampledRuns: 3,
  shots: spread(68),
  textShots: spread(21),
  requests: null,
  frames: null,
  engineMsPerFrame: null,
};

/** 600 s of footage: one busy minute is 6 busy minutes per hour. */
function summary(overrides: Partial<Budgetable> = {}): Budgetable {
  return {
    label: 'after',
    footage: 'ix-v1',
    tier: 'recommended',
    videoSeconds: 600,
    headline: { searchableMinPerHour: spread(30), completeMinPerHour: spread(40) },
    stages: [
      { stage: 'vision.embed', busyMs: spread(120_000) },
      { stage: 'audio.transcribe', busyMs: spread(60_000) },
      { stage: 'media.normalise', busyMs: null },
    ],
    ocr: OCR,
    ...overrides,
  };
}

const file: BudgetFile = {
  v: 1,
  tolerance: 0.15,
  floorMinPerHour: 0.5,
  budgets: [
    {
      footage: 'ix-v1',
      tier: 'recommended',
      from: 'baseline',
      setAt: '2026-10-17T00:00:00.000Z',
      searchableMinPerHour: 28,
      completeMinPerHour: 40,
      stageBusyMinPerHour: { 'vision.embed': 10, 'audio.transcribe': 6.5, 'library.hash': 0.1 },
    },
  ],
};

describe('measuresOf', () => {
  it('reads the medians as minutes per hour of footage, stage busy time included', () => {
    expect(measuresOf(summary())).toEqual({
      searchableMinPerHour: 30,
      completeMinPerHour: 40,
      stageBusyMinPerHour: { 'vision.embed': 12, 'audio.transcribe': 6 },
    });
    expect(measuresOf(summary({ videoSeconds: null }))).toBeNull();
  });
});

describe('checkBudgets', () => {
  it('says within, over inside the tolerance, or warn beyond it, per number', () => {
    const report = checkBudgets(summary(), file);
    expect(report?.checks).toEqual([
      { measure: 'searchable', value: 30, budget: 28, worseBy: 0.071, verdict: 'over' },
      { measure: 'complete', value: 40, budget: 40, worseBy: 0, verdict: 'within' },
      { measure: 'busy vision.embed', value: 12, budget: 10, worseBy: 0.2, verdict: 'warn' },
      { measure: 'busy audio.transcribe', value: 6, budget: 6.5, worseBy: -0.077, verdict: 'within' },
    ]);
    expect(budgetWarnings(report)).toEqual([
      'busy vision.embed: 12 min/h is +20% over its budget of 10 (ix-v1, recommended)',
    ]);
    expect(budgetMarkdown(report).join('\n')).toMatch(/\| busy vision.embed \| 12 \| 10 \| \+20% \| warn \|/);
  });

  it('does not warn when a small number is over by a large fraction but under the floor in minutes', () => {
    const small = summary({ stages: [{ stage: 'library.hash', busyMs: spread(3_000) }] });
    expect(checkBudgets(small, file)?.checks).toEqual([
      { measure: 'searchable', value: 30, budget: 28, worseBy: 0.071, verdict: 'over' },
      { measure: 'complete', value: 40, budget: 40, worseBy: 0, verdict: 'within' },
      { measure: 'busy library.hash', value: 0.3, budget: 0.1, worseBy: 2, verdict: 'over' },
    ]);
  });

  it('has nothing to say without a budget for the set and tier', () => {
    expect(checkBudgets(summary({ tier: 'high' }), file)).toBeNull();
    expect(checkBudgets(summary(), null)).toBeNull();
    expect(budgetMarkdown(null).join('\n')).toContain('No budget');
    expect(budgetWarnings(null)).toEqual([]);
  });
});

describe('tightenBudgets', () => {
  const now = new Date('2026-10-18T09:00:00Z');

  it('only ever lowers a budget, adds new stages and keeps ones the run lacks', () => {
    const next = tightenBudgets(file, summary(), now);
    expect(next.budgets).toHaveLength(1);
    expect(next.budgets[0]).toEqual({
      footage: 'ix-v1',
      tier: 'recommended',
      from: 'after',
      setAt: '2026-10-18T09:00:00.000Z',
      searchableMinPerHour: 28,
      completeMinPerHour: 40,
      stageBusyMinPerHour: { 'vision.embed': 10, 'audio.transcribe': 6, 'library.hash': 0.1 },
    });
    expect(next.tolerance).toBe(0.15);
  });

  it('starts a budget from the medians when the set and tier have none', () => {
    const next = tightenBudgets(file, summary({ footage: 'smoke' }), now);
    expect(next.budgets.map((budget) => budget.footage)).toEqual(['ix-v1', 'smoke']);
    expect(next.budgets[1]?.searchableMinPerHour).toBe(30);
    expect(() => tightenBudgets(file, summary({ videoSeconds: 0 }), now)).toThrow(/no footage length/);
  });

  it('replaces the budget with the medians on reset, higher ones too', () => {
    const slower = summary({
      headline: { searchableMinPerHour: spread(45), completeMinPerHour: spread(50) },
    });
    const next = tightenBudgets(file, slower, now, true);
    expect(next.budgets).toHaveLength(1);
    expect(next.budgets[0]).toMatchObject({
      from: 'after',
      searchableMinPerHour: 45,
      completeMinPerHour: 50,
    });
    expect(next.budgets[0]?.stageBusyMinPerHour).toEqual({ 'vision.embed': 12, 'audio.transcribe': 6 });
  });

  it('takes no budget from a bench that did not read on-screen text in every run', () => {
    const off: BenchOcr = {
      ...OCR,
      setup: { mode: 'off', helper: null, reason: 'run with --no-mac-helper' },
    };
    expect(() => tightenBudgets(file, summary({ ocr: off }), now)).toThrow(/did not read on-screen text/);
    expect(() => tightenBudgets(file, summary({ ocr: { ...OCR, helperRuns: 2 } }), now, true)).toThrow(
      /budgets come only from benches with OCR/,
    );
    expect(() => tightenBudgets(file, summary({ ocr: undefined }), now)).toThrow(/did not read/);
  });
});

describe('readBudgetFile', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reads a valid file, is null for none and names the file when it is wrong', () => {
    dir = mkdtempSync(join(tmpdir(), 'taalcut-budgets-'));
    const path = join(dir, 'index-budgets.json');
    expect(readBudgetFile(path)).toBeNull();
    writeFileSync(path, JSON.stringify(file));
    expect(readBudgetFile(path)).toEqual(file);
    writeFileSync(path, JSON.stringify({ ...file, tolerance: 2 }));
    expect(() => readBudgetFile(path)).toThrow(/index-budgets\.json/);
  });
});

describe('the budgets command and the nightly rows', () => {
  it('parses budgets <summary> [--write | --reset]', () => {
    const context = { env: { TAALCUT_BENCH_ROOT: '/bench' }, cwd: '/repo', now: new Date() };
    expect(parseBenchArgs(['budgets', 'after', '--write'], context)).toEqual({
      command: 'budgets',
      summary: 'after',
      write: true,
      reset: false,
      benchRoot: '/bench',
    });
    expect(parseBenchArgs(['budgets', 'after', '--reset'], context)).toMatchObject({
      write: false,
      reset: true,
    });
    expect(() => parseBenchArgs(['budgets', 'after', '--write', '--reset'], context)).toThrow(/not both/);
    expect(() => parseBenchArgs(['budgets'], context)).toThrow(/budgets takes one summary/);
  });

  it('turns a summary into one nightly row per number, in minutes per hour', () => {
    const meta: PerfRunMeta = {
      runner: { id: 'recommended', chip: 'Apple M5 Max', memoryGb: 64, macos: '26.7.1' },
      commit: 'abc',
      date: '2026-10-18T02:00:00.000Z',
      synthetic: true,
      footage: 'synthetic',
      build: { flavour: 'synthetic', version: '0.0.0' },
    };
    const runs = { runsAsked: 3, runsFinished: 3, failedRuns: [], e2eFailedRuns: [], noisyRuns: [] };
    const whole = (overrides: Partial<NightlyBench> = {}): NightlyBench => ({
      ...summary(),
      ...runs,
      ...overrides,
    });
    const rows = indexRows(whole(), meta);
    expect(rows.map((row) => [row.metric, row.value, row.unit, row.better])).toEqual([
      ['index-searchable-1h:ix-v1', 30, 'minutes', 'lower'],
      ['index-complete-1h:ix-v1', 40, 'minutes', 'lower'],
      ['index-busy-1h:ix-v1:audio.transcribe', 6, 'minutes', 'lower'],
      ['index-busy-1h:ix-v1:vision.embed', 12, 'minutes', 'lower'],
    ]);
    expect(rows.every((row) => row.noisy === undefined)).toBe(true);
    expect(() => indexRows(whole({ videoSeconds: null }), meta)).toThrow(/no footage length/);

    // A noisy run stays in the median, and every row says so (IX-F3).
    const noisy = indexRows(
      whole({ noisyRuns: [{ run: 2, reasons: ['security agents 240% of a core'] }] }),
      meta,
    );
    expect(noisy.map((row) => row.noisy)).toEqual(noisy.map(() => ['run 2: security agents 240% of a core']));
  });

  it('takes only a whole bench as a night: every run finished, measured and passed (IX-F3)', () => {
    const base: NightlyBench = {
      ...summary(),
      runsAsked: 3,
      runsFinished: 3,
      failedRuns: [],
      e2eFailedRuns: [],
    };
    expect(unusableBench(base)).toEqual([]);
    expect(unusableBench({ ...base, runsFinished: 1 })).toEqual(['1 of 3 runs finished']);
    expect(unusableBench({ ...base, runsFinished: 2, failedRuns: [3] })).toEqual([
      '2 of 3 runs finished',
      'run 3 measured nothing',
    ]);
    expect(unusableBench({ ...base, e2eFailedRuns: [1, 2] })).toEqual(['runs 1, 2 failed the e2e checks']);
    expect(unusableBench(summary())).toEqual(['it does not say how many runs finished']);
    const meta = {
      runner: { id: 'recommended', chip: 'Apple M5 Max', memoryGb: 64, macos: '26.7.1' },
      commit: 'abc',
      date: '2026-10-18T02:00:00.000Z',
      synthetic: true,
      footage: 'synthetic',
      build: { flavour: 'synthetic', version: '0.0.0' },
    } as const;
    expect(() => indexRows({ ...base, e2eFailedRuns: [2] }, meta)).toThrow(
      /can't be a nightly number: run 2 failed the e2e checks/,
    );
  });
});
