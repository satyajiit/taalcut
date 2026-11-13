// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The runner with a fake shell: it builds once, runs the e2e N times with the bench's environment, reads
 * each run, writes the summary and copies it; a run that measured nothing is named, not hidden.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareMarkdown, readSummary, verdictOf } from '../../../src/perf/bench/compare';
import { analyseLabel, runBench } from '../../../src/perf/bench/runner';
import type { Shell } from '../../../src/perf/bench/shell';
import { processSamples, runRecord, writeRun } from './fixtures';
import { deps, fakeShell, HELPER, helperProbe, options, tempDir } from './runner-fakes';

describe('runBench', () => {
  it('builds once, then runs the indexing e2e N times at the forced tier', async () => {
    const root = tempDir();
    const shell = fakeShell();
    const outcome = await runBench(options(root), deps(shell));
    const [renderer, app, ...runs] = shell.steps;
    expect(renderer?.args).toEqual(['--filter', '@taalcut/renderer', 'build']);
    expect(app?.env).toMatchObject({ TAALCUT_BUILD_FLAVOUR: 'test', NO_COLOR: undefined });
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({
      command: 'pnpm',
      args: ['exec', 'playwright', 'test', '--project=indexing', 'e2e/indexing.e2e.ts'],
      cwd: '/repo/apps/desktop',
      env: {
        TAALCUT_INDEX_BENCH: '1',
        TAALCUT_TEST_HARDWARE_TIER: 'recommended',
        TAALCUT_PERF_DIR: join(root, 'runs', 'base', 'run-1'),
        TAALCUT_BENCH_WORK: join(root, 'work'),
        TAALCUT_E2E_LIBRARY_CACHE: '/bench/footage/smoke',
        TAALCUT_MAC_HELPER: HELPER,
      },
    });
    expect(outcome.summary.ocr).toMatchObject({
      setup: { mode: 'helper', helper: { path: HELPER, version: '1.0.0' } },
      helperRuns: 3,
      sampledRuns: 3,
    });
    expect(existsSync(join(root, 'orch', 'base', 'ocr-setup.json'))).toBe(true);
    expect(outcome.summary.headline.elapsedMinPerHour).toEqual({ median: 40, min: 36.7, max: 43.3, n: 3 });
    expect(outcome.summary.headline.searchableMinPerHour?.median).toBe(10);
    expect(existsSync(join(root, 'runs', 'base', 'run-2', 'run-summary.json'))).toBe(true);
    expect(readFileSync(join(root, 'orch', 'base', 'summary.md'), 'utf8')).toContain(
      '# Indexing bench: base',
    );
    expect(existsSync(join(root, 'orch', 'base', 'run-3', 'index-bench.json'))).toBe(true);
    expect(outcome.failedRuns).toEqual([]);
  });

  it('names a run that measured nothing and keeps the others', async () => {
    const root = tempDir();
    const outcome = await runBench(options(root, { build: false }), deps(fakeShell([2])));
    expect(outcome.failedRuns).toEqual([2]);
    expect(outcome.e2eFailedRuns).toEqual([2]);
    expect(outcome.summary.runsFinished).toBe(2);
  });

  it('checks the medians against the set and tier budget and says what is over it', async () => {
    const root = tempDir();
    const lines: string[] = [];
    const budgets = () => ({
      v: 1 as const,
      tolerance: 0.1,
      floorMinPerHour: 0.5,
      budgets: [
        {
          footage: 'smoke',
          tier: 'recommended' as const,
          from: 'baseline',
          setAt: '2026-10-17T00:00:00.000Z',
          searchableMinPerHour: 8,
          completeMinPerHour: 40,
          stageBusyMinPerHour: { 'vision.embed': 20 },
        },
      ],
    });
    const outcome = await runBench(options(root, { runs: 1, label: 'budgeted' }), {
      ...deps(fakeShell()),
      budgets,
      log: (line) => lines.push(line),
    });
    expect(outcome.summary.budgets?.checks.map((check) => [check.measure, check.verdict])).toEqual([
      ['searchable', 'warn'],
      ['complete', 'within'],
      ['busy vision.embed', 'within'],
    ]);
    expect(lines.join('\n')).toContain(
      '[bench] over budget: searchable: 10 min/h is +25% over its budget of 8',
    );
    expect(readFileSync(join(root, 'runs', 'budgeted', 'summary.md'), 'utf8')).toContain('## Budgets');
  });

  it('stops after a run in which FFmpeg stalled, and passes the stall folder to the e2e', async () => {
    const root = tempDir();
    const lines: string[] = [];
    const inner = fakeShell();
    const shell: Shell = {
      run(step) {
        if (step.env.TAALCUT_PERF_DIR?.endsWith('run-1') === true) {
          const stalls = step.env.TAALCUT_VT_STALL_DIR ?? '';
          mkdirSync(stalls, { recursive: true });
          writeFileSync(join(stalls, 'vt-stall-2026-10-17T024014Z.md'), '# FFmpeg stalled (pid 1)\n');
        }
        return inner.run(step);
      },
    };
    const outcome = await runBench(options(root, { label: 'stalled', build: false }), {
      ...deps(shell),
      log: (line) => lines.push(line),
    });
    expect(inner.steps.map((step) => step.env.TAALCUT_VT_STALL_DIR)).toEqual([join(root, 'stalls')]);
    expect(outcome.summary.runsFinished).toBe(1);
    expect(lines.join('\n')).toMatch(/FFmpeg stalled in run 1 \(left running, not killed\)/);
  });

  it('refuses a label that already holds a bench, and stops on a failed build', async () => {
    const root = tempDir();
    await runBench(options(root, { runs: 1 }), deps(fakeShell()));
    await expect(runBench(options(root, { runs: 1 }), deps(fakeShell()))).rejects.toThrow('already holds');
    const broken: Shell = { run: () => Promise.resolve(2) };
    await expect(runBench(options(root, { label: 'broken' }), deps(broken))).rejects.toThrow(
      'building the renderer failed',
    );
  });
});

describe('runBench and the mac helper', () => {
  it('fails before footage or builds when the helper does not run, and says how to go on', async () => {
    const root = tempDir();
    const shell = fakeShell();
    let footage = false;
    const run = runBench(options(root), {
      ...deps(shell),
      helper: helperProbe(false),
      footage: {
        prepare: () => {
          footage = true;
          return Promise.resolve({});
        },
      },
    });
    await expect(run).rejects.toThrow(/mac helper does not run .*--no-mac-helper/s);
    expect(footage).toBe(false);
    expect(shell.steps).toEqual([]);
  });

  it('with --no-mac-helper, points the app at no helper and says "without OCR"', async () => {
    const root = tempDir();
    const shell = fakeShell();
    const probe = helperProbe();
    const outcome = await runBench(
      options(root, { macHelper: false, label: 'plain', runs: 1, build: false }),
      {
        ...deps(shell),
        helper: probe,
      },
    );
    expect(probe.asked).toEqual([]);
    expect(shell.steps[0]?.env.TAALCUT_MAC_HELPER).toBe(
      join(root, 'runs', 'plain', 'no-mac-helper', 'taalcut-mac-helper'),
    );
    expect(outcome.summary.ocr.setup).toEqual({
      mode: 'off',
      helper: null,
      reason: 'run with --no-mac-helper',
    });
    expect(outcome.summary.noisyRuns.flatMap((run) => run.reasons).join()).not.toContain('mac helper');
    expect(readFileSync(join(root, 'runs', 'plain', 'summary.md'), 'utf8')).toContain(
      '# Indexing bench: plain (without OCR)',
    );
  });

  it('calls a run noisy when the helper was set up but never ran', async () => {
    const root = tempDir();
    const shell: Shell = {
      run(step) {
        if (step.env.TAALCUT_PERF_DIR !== undefined)
          writeRun(step.env.TAALCUT_PERF_DIR, runRecord(), processSamples(5));
        return Promise.resolve(0);
      },
    };
    const outcome = await runBench(options(root, { runs: 1, build: false }), deps(shell));
    expect(outcome.summary.ocr.helperRuns).toBe(0);
    expect(outcome.summary.noisyRuns[0]?.reasons).toContain(
      'the mac helper never ran: no on-screen text was read',
    );
  });
});

describe('analyseLabel and compare', () => {
  it('reads a label again and compares two summaries', async () => {
    const root = tempDir();
    await runBench(options(root, { label: 'before', runs: 2 }), deps(fakeShell()));
    const slower = { ...deps(fakeShell()), analyse: () => ({ searchableMs: 90_000, completeMs: 180_000 }) };
    await runBench(options(root, { label: 'after', runs: 2 }), slower);
    const again = analyseLabel(
      { command: 'analyse', label: 'before', benchRoot: root, copyTo: null },
      deps(fakeShell()),
    );
    expect(again.summary.runsFinished).toBe(2);
    const markdown = compareMarkdown(readSummary('before', root), readSummary('after', root));
    expect(markdown).toContain('# Indexing bench: before → after');
    expect(markdown).toMatch(
      /\| Searchable \(min\/h\) \| 10 \[10–10\] \| 30 \[30–30\] \| \+20 \| 200% \| worse \|/,
    );
    expect(markdown).toMatch(/Add folder to settled.*within noise/);
    expect(markdown).toContain('a change whose ranges overlap is within noise');
    expect(() => readSummary('missing', root)).toThrow('no bench summary');
  });

  it('calls a change within noise when the ranges overlap', () => {
    const spread = (median: number, min: number, max: number) => ({ median, min, max, n: 3 });
    expect(verdictOf(spread(40, 35, 50), spread(38, 30, 36), 'lower')).toBe('within noise');
    expect(verdictOf(spread(40, 35, 50), spread(20, 18, 22), 'lower')).toBe('better');
    expect(verdictOf(spread(40, 35, 50), spread(20, 18, 22), 'higher')).toBe('worse');
    expect(verdictOf(null, spread(1, 1, 1), 'lower')).toBe('–');
  });
});
