// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One run's numbers, the noise rules, and the runs together as median and spread. */
import { describe, expect, it } from 'vitest';
import { aggregateRuns } from '../../../src/perf/bench/aggregate';
import { NOISE_LIMITS, noiseOf, type NoiseInputs } from '../../../src/perf/bench/noise';
import { parseRunRecord } from '../../../src/perf/bench/run-record';
import { summariseRun } from '../../../src/perf/bench/run-summary';
import { minutesPerHour, relativeSpread, spreadOf } from '../../../src/perf/bench/stats';
import { summaryMarkdown } from '../../../src/perf/bench/summary-markdown';
import { ADDED_AT, processSamples, runRecord } from './fixtures';

const NO_OCR = { textShots: null, helperExpected: false } as const;

describe('spreadOf', () => {
  it('is the median with min and max over the runs that have the number', () => {
    expect(spreadOf([44.1, 35.4, 51.5])).toEqual({ median: 44.1, min: 35.4, max: 51.5, n: 3 });
    expect(spreadOf([10, null, 20, undefined])).toEqual({ median: 15, min: 10, max: 20, n: 2 });
    expect(spreadOf([null, Number.NaN])).toBeNull();
  });

  it('gives the relative spread and minutes per hour', () => {
    expect(relativeSpread({ median: 40, min: 30, max: 50, n: 3 })).toBeCloseTo(0.5);
    expect(relativeSpread({ median: 0, min: 0, max: 0, n: 1 })).toBe(0);
    expect(minutesPerHour(132_323, 180)).toBeCloseTo(44.1, 1);
    expect(() => minutesPerHour(1, 0)).toThrow();
  });
});

describe('noiseOf', () => {
  const quiet: NoiseInputs = {
    security: { meanPercent: 150, maxPercent: 400, byVendor: {} },
    loadAtStart: 5,
    loadMean: 8,
    cores: 18,
    performanceCores: 6,
    windowMs: 120_000,
    processSamples: 118,
    foreignCommands: [],
    helperMissing: false,
    background: null,
  };

  it('passes a quiet run', () => {
    expect(noiseOf(quiet)).toEqual({ noisy: false, reasons: [] });
  });

  it('names each limit a run went over', () => {
    const noise = noiseOf({
      ...quiet,
      security: { meanPercent: NOISE_LIMITS.securityMeanCpuPercent + 1, maxPercent: 900, byVendor: {} },
      loadAtStart: 6.5,
      loadMean: 19,
      processSamples: 30,
      foreignCommands: ['settings.setTheme'],
      helperMissing: true,
    });
    expect(noise.noisy).toBe(true);
    expect(noise.reasons).toHaveLength(6);
    expect(noise.reasons.join('\n')).toMatch(/the mac helper never ran/);
    expect(noise.reasons.join('\n')).toMatch(/security agents averaged 201%/);
    expect(noise.reasons.join('\n')).toMatch(/settings\.setTheme/);
  });

  it('names the media daemons when they take more than a core', () => {
    const background = {
      meanPercent: 112,
      maxPercent: 180,
      byGroup: {
        mediaanalysisd: { meanPercent: 108, maxPercent: 170 },
        spotlight: { meanPercent: 4, maxPercent: 10 },
      },
    };
    expect(noiseOf({ ...quiet, background }).reasons).toEqual([
      'media daemons averaged 112% CPU (mediaanalysisd 108%) (limit 100%)',
    ]);
    expect(noiseOf({ ...quiet, background: { ...background, meanPercent: 90 } }).noisy).toBe(false);
  });

  it('uses every core when the probe gave no performance cores', () => {
    expect(noiseOf({ ...quiet, performanceCores: null, loadAtStart: 17 }).noisy).toBe(false);
  });
});

describe('summariseRun', () => {
  it('reads the tier, the finish lines per hour, memory, security CPU and load', () => {
    const summary = summariseRun({
      run: 2,
      record: runRecord(),
      processes: processSamples(121),
      finish: { searchableMs: 60_000, completeMs: 118_000 },
      textShots: { shots: 68, textShots: 21 },
      helperExpected: false,
    });
    expect(summary.tier).toEqual({ used: 'recommended', assessed: 'high', forced: 'recommended' });
    expect(summary.elapsedMinPerHour).toBe(40);
    expect(summary.searchableMinPerHour).toBe(20);
    expect(summary.completeMinPerHour).toBeCloseTo(39.3);
    expect(summary.memory.jobs?.treePeakBytes).toBe((620_000 + 300_000) * 1024);
    expect(summary.security?.meanPercent).toBeCloseTo(160, 0);
    expect(summary.load.start).toBe(4.2);
    expect(summary.ocr).toEqual({ helperSamples: 0, shots: 68, textShots: 21, counters: null });
    expect(summary.noise.noisy).toBe(true);
    expect(summary.noise.reasons.join()).toMatch(/mean load/);
  });

  it('calls a run with input from outside the test noisy, and reads older records as having none', () => {
    const foreign = runRecord({
      foreignCommands: [{ name: 'settings.setTheme', source: 'ui', at: ADDED_AT + 36_700 }],
    });
    const summary = summariseRun({ run: 1, record: foreign, processes: [], finish: null, ...NO_OCR });
    expect(summary.noise.reasons.join()).toContain('settings.setTheme (ui)');
    const older: Record<string, unknown> = { ...runRecord() };
    delete older.foreignCommands;
    expect(parseRunRecord(older).foreignCommands).toEqual([]);
  });

  it('has no finish lines without a timeline', () => {
    const summary = summariseRun({ run: 1, record: runRecord(), processes: [], finish: null, ...NO_OCR });
    expect(summary.searchableMinPerHour).toBeNull();
    expect(summary.completeMinPerHour).toBeNull();
    expect(summary.security).toBeNull();
  });
});

describe('aggregateRuns', () => {
  const runs = [30, 20, 40].map((searchableSeconds, index) =>
    summariseRun({
      run: index + 1,
      record: runRecord({
        stages: [{ stage: 'vision.embed', runs: 2, wallMs: 60_000, busyMs: 40_000 + index * 10_000 }],
      }),
      processes: processSamples(11),
      finish: { searchableMs: searchableSeconds * 1000, completeMs: 100_000 },
      textShots: { shots: 20, textShots: 5 + index },
      helperExpected: true,
    }),
  );

  it('says when fully analysed leaves out descriptions held for their model (LIB1-FIX)', () => {
    const held = [0, 18].map((completeHeldForModel, index) =>
      summariseRun({
        run: index + 1,
        record: runRecord(),
        processes: processSamples(11),
        finish: { searchableMs: 30_000, completeMs: 100_000, completeHeldForModel },
        ...NO_OCR,
      }),
    );
    expect(held.map((run) => run.completeHeldForModel)).toEqual([0, 18]);
    const bench = (picked: typeof held) =>
      summaryMarkdown(
        aggregateRuns({
          label: 'held',
          createdAt: '2026-10-29T10:00:00Z',
          tier: 'recommended',
          footage: 'ix-v1',
          runsAsked: picked.length,
          runs: picked,
          failedRuns: [],
          e2eFailedRuns: [],
          ocrSetup: null,
        }),
      );
    expect(bench(held)).toContain('leaves out the descriptions held for their model');
    expect(bench(held)).toContain('(up to 18 a run)');
    expect(bench(held.slice(0, 1))).not.toContain('held for their model');
  });

  it('keeps every run, takes the median and spread, and names noisy and failed runs', () => {
    const summary = aggregateRuns({
      label: 'base',
      createdAt: '2026-10-17T10:00:00Z',
      tier: 'recommended',
      footage: 'smoke',
      runsAsked: 4,
      runs,
      failedRuns: [4],
      e2eFailedRuns: [4],
      ocrSetup: null,
    });
    expect(summary.headline.searchableMinPerHour).toEqual({ median: 10, min: 6.7, max: 13.3, n: 3 });
    expect(summary.stages).toEqual([
      {
        stage: 'vision.embed',
        busyMs: { median: 50_000, min: 40_000, max: 60_000, n: 3 },
        wallMs: { median: 60_000, min: 60_000, max: 60_000, n: 3 },
      },
    ]);
    expect(summary.runsFinished).toBe(3);
    expect(summary.failedRuns).toEqual([4]);
    expect(summary.tierAssessed).toBe('high');
    const markdown = summaryMarkdown(summary);
    expect(markdown).toContain('| Searchable (min/h) | 10 | 6.7 | 13.3 | 3 |');
    expect(markdown).toContain('| vision.embed | 50 | 40 | 60 | 60 | 60 | 60 |');
    expect(markdown).toContain('Runs that measured nothing: 4.');
    // A bench from before the preflight whose runs never show the helper read no on-screen text.
    expect(summary.ocr).toMatchObject({ setup: null, helperRuns: 0, sampledRuns: 3 });
    expect(summary.ocr.textShots).toEqual({ median: 6, min: 5, max: 7, n: 3 });
    expect(markdown).toContain('# Indexing bench: base (without OCR)');
    expect(markdown).toContain(
      'the helper ran in 0 of 3 runs; shots with on-screen text: 6 of 20 (median). **Without OCR.**',
    );
  });
});
