// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX3-B4: the app's compute.fallback events in the bench: per run, per bench, in compare and against budgets. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  budgetMarkdown,
  budgetWarnings,
  checkBudgets,
  tightenBudgets,
} from '../../../src/perf/bench/budgets';
import type { Budgetable, BudgetFile } from '../../../src/perf/bench/budgets';
import { compareMarkdown, readSummary } from '../../../src/perf/bench/compare';
import {
  benchFallbacks,
  fallbacksCompareLine,
  fallbacksLine,
  newFallbacks,
  readRunFallbacks,
  type BenchFallbacks,
} from '../../../src/perf/bench/fallbacks';
import { runBench } from '../../../src/perf/bench/runner';
import type { Shell } from '../../../src/perf/bench/shell';
import { deps, fakeShell, options, tempDir } from './runner-fakes';

const line = (operation: string, reason: string, wanted: string[], detail?: string) =>
  JSON.stringify({ at: 1_800_000_000_000, operation, wanted, reason, ...(detail ? { detail } : {}) });

function fallbackFile(lines: readonly string[]): string {
  const path = join(tempDir(), 'compute-fallbacks.jsonl');
  writeFileSync(path, lines.map((text) => `${text}\n`).join(''));
  return path;
}

const EMBED = line('vision.embedFrames', 'accelerator_failed', ['coreml'], 'Core ML refused the model');

describe('a run’s fallbacks', () => {
  it('groups the events by operation and reason, and tells "none" from "not recorded"', () => {
    const run = readRunFallbacks(
      fallbackFile([
        EMBED,
        line('vision.embedFrames', 'accelerator_failed', ['webgpu']),
        line('a.b', 'disabled', []),
      ]),
    );
    expect(run).toEqual({
      events: 3,
      kinds: [
        { key: 'a.b (disabled)', operation: 'a.b', reason: 'disabled', wanted: [], events: 1 },
        {
          key: 'vision.embedFrames (accelerator_failed)',
          operation: 'vision.embedFrames',
          reason: 'accelerator_failed',
          wanted: ['coreml', 'webgpu'],
          events: 2,
          detail: 'Core ML refused the model',
        },
      ],
    });
    expect(readRunFallbacks(fallbackFile([]))).toEqual({ events: 0, kinds: [] });
    expect(readRunFallbacks(join(tempDir(), 'none.jsonl'))).toBeNull();
    expect(() => readRunFallbacks(fallbackFile(['{"operation":"x"}']))).toThrow(
      /compute-fallbacks.jsonl line 1/,
    );
  });

  it('counts each kind’s runs and events over a bench, and says it in summary.md', () => {
    const one = readRunFallbacks(fallbackFile([EMBED]));
    const none = readRunFallbacks(fallbackFile([]));
    const bench = benchFallbacks([one, none, one]);
    expect(bench).toMatchObject({ recordedRuns: 3, runs: 3, kinds: [{ runs: 2, events: 2 }] });
    expect(fallbacksLine(bench)).toBe(
      '**CPU fallbacks (compute.fallback)**: vision.embedFrames (accelerator_failed), wanted coreml: 2 events in ' +
        '2 of 3 runs (“Core ML refused the model”).',
    );
    expect(fallbacksLine(benchFallbacks([none, none]))).toBe(
      'CPU fallbacks (compute.fallback): none in 2 runs.',
    );
    expect(fallbacksLine(benchFallbacks([none, null]))).toBe(
      'CPU fallbacks (compute.fallback): none in 1 run (recorded in 1 of 2 runs).',
    );
    expect(fallbacksLine(benchFallbacks([null]))).toMatch(/not recorded/);
    expect(fallbacksLine(undefined)).toMatch(/not recorded/);
  });
});

const bench = (keys: readonly string[], recordedRuns = 3): BenchFallbacks => ({
  recordedRuns,
  runs: 3,
  kinds: keys.map((key) => ({ key, operation: key, reason: 'disabled', wanted: [], events: 1, runs: 1 })),
});

describe('compare', () => {
  it('names the kinds that are new and gone, and refuses to say when a bench did not record them', () => {
    expect(newFallbacks(bench(['a']), bench(['a', 'b']))).toEqual(['b']);
    expect(newFallbacks(bench(['a'], 2), bench(['a']))).toBeNull();
    expect(fallbacksCompareLine(bench(['a']), bench(['b']))).toBe(
      '**New CPU fallbacks: b** (worse). CPU fallbacks gone: a (better).',
    );
    expect(fallbacksCompareLine(bench([]), bench([]))).toBe('CPU fallbacks: none in either.');
    expect(fallbacksCompareLine(bench(['a']), bench(['a']))).toBe(
      'CPU fallbacks: the same kinds in both (a).',
    );
    expect(fallbacksCompareLine(undefined, bench([]))).toMatch(/not comparable/);
  });
});

const spread = (median: number) => ({ median, min: median, max: median, n: 3 });
const summary = (fallbacks: BenchFallbacks | undefined): Budgetable => ({
  label: 'head',
  footage: 'ix-v1',
  tier: 'recommended',
  videoSeconds: 600,
  headline: { searchableMinPerHour: spread(7), completeMinPerHour: spread(14) },
  stages: [],
  ocr: {
    setup: { mode: 'helper', helper: { path: '/h', version: '1' }, reason: null },
    helperRuns: 3,
    sampledRuns: 3,
    shots: null,
    textShots: null,
    requests: null,
    frames: null,
    engineMsPerFrame: null,
  },
  ...(fallbacks ? { fallbacks } : {}),
});

const budgetFile = (cpuFallbacks?: string[]): BudgetFile => ({
  v: 1,
  tolerance: 0.15,
  floorMinPerHour: 0.5,
  budgets: [
    {
      footage: 'ix-v1',
      tier: 'recommended',
      from: 'base',
      setAt: '2026-10-20T00:00:00Z',
      searchableMinPerHour: 7,
      completeMinPerHour: 14,
      stageBusyMinPerHour: {},
      ...(cpuFallbacks ? { cpuFallbacks } : {}),
    },
  ],
});

describe('budgets', () => {
  it('warns on a fallback kind the budget’s bench did not have', () => {
    const report = checkBudgets(summary(bench(['a', 'b'])), budgetFile(['a']));
    expect(report?.newFallbacks).toEqual(['b']);
    expect(budgetWarnings(report)).toEqual([
      'new CPU fallback b (ix-v1, recommended; its budget has none such)',
    ]);
    expect(budgetMarkdown(report).at(-1)).toBe('**CPU fallbacks the budget’s bench did not have: b.**');
    const clean = checkBudgets(summary(bench(['a'])), budgetFile(['a']));
    expect(budgetMarkdown(clean).at(-1)).toBe('CPU fallbacks: none the budget’s bench did not have.');
    // A budget from before IX3-B4, or a bench that did not record them: not checked.
    expect(checkBudgets(summary(bench(['b'])), budgetFile())?.newFallbacks).toBeNull();
    expect(checkBudgets(summary(undefined), budgetFile(['a']))?.newFallbacks).toBeNull();
    expect(budgetMarkdown(checkBudgets(summary(undefined), budgetFile(['a']))).at(-1)).toMatch(/not checked/);
  });

  it('records the bench’s kinds in the budget: --write keeps only those both had, --reset takes the bench’s', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const first = tightenBudgets(budgetFile(), summary(bench(['a', 'b'])), now);
    expect(first.budgets[0]?.cpuFallbacks).toEqual(['a', 'b']);
    const tighter = tightenBudgets(budgetFile(['a']), summary(bench(['a', 'b'])), now);
    expect(tighter.budgets[0]?.cpuFallbacks).toEqual(['a']);
    const reset = tightenBudgets(budgetFile(['a']), summary(bench(['b'])), now, true);
    expect(reset.budgets[0]?.cpuFallbacks).toEqual(['b']);
    const unrecorded = tightenBudgets(budgetFile(['a']), summary(undefined), now);
    expect(unrecorded.budgets[0]?.cpuFallbacks).toEqual(['a']);
  });
});

/** The e2e writes one fallback in every run but the first. */
const fallingBackShell = (): Shell =>
  fakeShell([], (run, step) => {
    const path = step.env.TAALCUT_COMPUTE_FALLBACK_LOG;
    if (path !== undefined) writeFileSync(path, run === 1 ? '' : `${EMBED}\n`);
  });

describe('the runner', () => {
  it('names a fallback log in each run’s folder, and puts the fallbacks in the summary and compare', async () => {
    const root = tempDir();
    const shell = fakeShell();
    await runBench(options(root, { label: 'base', runs: 1, build: false }), deps(shell));
    expect(shell.steps[0]?.env.TAALCUT_COMPUTE_FALLBACK_LOG).toBe(
      join(root, 'runs', 'base', 'run-1', 'compute-fallbacks.jsonl'),
    );
    // The fake e2e wrote no file: not recorded.
    expect(readSummary('base', root).fallbacks).toMatchObject({ recordedRuns: 0, runs: 1 });
    const outcome = await runBench(
      options(root, { label: 'head', runs: 2, build: false }),
      deps(fallingBackShell()),
    );
    expect(outcome.summary.fallbacks).toMatchObject({ recordedRuns: 2, kinds: [{ runs: 1, events: 1 }] });
    expect(readFileSync(join(root, 'runs', 'head', 'summary.md'), 'utf8')).toContain(
      '**CPU fallbacks (compute.fallback)**: vision.embedFrames (accelerator_failed)',
    );
    expect(compareMarkdown(readSummary('base', root), readSummary('head', root))).toContain(
      'CPU fallbacks: not comparable',
    );
    expect(readFileSync(join(root, 'orch', 'head', 'run-2', 'compute-fallbacks.jsonl'), 'utf8')).toContain(
      'vision.embedFrames',
    );
  });
});
