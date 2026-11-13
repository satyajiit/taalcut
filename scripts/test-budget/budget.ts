// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the whole repo's tests share the machine (UX2-FIXUP). Turbo runs each package's tests as one task, and
 * Vitest starts a worker per core for each; the heavy suites then start FFmpeg, VideoToolbox, Chrome, ONNX or
 * whisper inside those workers. At turbo's default of ten tasks at once that was about 120 workers and 50 FFmpeg
 * processes on an 18-core Mac (load 20 to 30, a process taking seconds to start), so tests that take a second
 * alone took a minute and ran out of time.
 *
 * The budget: the long pole (render, which runs one file at a time for about ten minutes) starts first, in a run
 * of its own; every other package runs `tasks` at a time with `workers` test files each, which together stay
 * within the cores. Those take about a third of the long pole's time, so the whole run is no slower. The cores
 * are the run's share of the machine (cores.ts: TAALCUT_TEST_CORES, else all of them).
 */
export interface TestBudget {
  /** Test tasks turbo runs at once, besides the long pole. */
  readonly tasks: number;
  /** Test files each of those runs at once (Vitest's `--maxWorkers`). */
  readonly workers: number;
}

/** Suites that outlast all the others together: they start first, in a run of their own. */
export const LONG_POLE: readonly string[] = ['@taalcut/render'];

/** The budget for a machine with `cores` cores: one core for the long pole, the rest shared by the others. */
export function testBudget(cores: number): TestBudget {
  const tasks = cores >= 8 ? 2 : 1;
  return { tasks, workers: Math.max(1, Math.floor((cores - 1) / tasks)) };
}

const isFilter = (arg: string) =>
  arg === '--filter' || arg === '-F' || arg.startsWith('--filter=') || arg.startsWith('-F');

/**
 * The turbo runs for `task` (`test` or `test:coverage`) with the caller's own arguments: turbo's before `--`, the
 * test runner's after it. A caller who picks packages with `--filter` gets one run of those, within the budget.
 */
export function turboRuns(task: string, budget: TestBudget, args: readonly string[]): string[][] {
  const split = args.indexOf('--');
  const turboArgs = split < 0 ? args : args.slice(0, split);
  const testArgs = split < 0 ? [] : args.slice(split + 1);
  const common = ['run', task, '--continue', ...turboArgs];
  const budgeted = [`--concurrency=${budget.tasks}`, '--', `--maxWorkers=${budget.workers}`, ...testArgs];
  if (turboArgs.some(isFilter)) return [[...common, ...budgeted]];
  return [
    [
      ...common,
      ...LONG_POLE.map((name) => `--filter=${name}`),
      ...(testArgs.length > 0 ? ['--', ...testArgs] : []),
    ],
    [...common, ...LONG_POLE.map((name) => `--filter=!${name}`), ...budgeted],
  ];
}
