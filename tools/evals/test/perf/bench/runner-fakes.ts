// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bench runner's fakes, shared by its tests: a shell that writes each run's files instead of running the e2e,
 * a mac helper probe, a disk with room and a compile cache that records what the runner does with it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import type { CompileCache, HelperProcess } from '../../../src/perf/bench/compile-cleanup';
import type { DiskSpace } from '../../../src/perf/bench/disk-floor';
import type { HelperProbe } from '../../../src/perf/bench/mac-helper';
import type { RunOptions } from '../../../src/perf/bench/options';
import type { BenchDeps } from '../../../src/perf/bench/runner';
import type { Shell, ShellStep } from '../../../src/perf/bench/shell';
import { processSamples, runRecord, writeRun } from './fixtures';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-bench-'));
  dirs.push(dir);
  return dir;
}

/** Runs the e2e by writing a run's files, except for the runs in `fail`. */
export function fakeShell(
  fail: readonly number[] = [],
  /** What else the app does in an indexing run (writes a file, compiles a model). */
  during: (run: number, step: ShellStep) => void = () => undefined,
): Shell & { steps: ShellStep[] } {
  const steps: ShellStep[] = [];
  return {
    steps,
    run(step) {
      steps.push(step);
      const perfDir = step.env.TAALCUT_PERF_DIR;
      if (perfDir === undefined) return Promise.resolve(0);
      const run = Number(/run-(\d+)$/.exec(perfDir)?.[1]);
      during(run, step);
      if (fail.includes(run)) return Promise.resolve(1);
      // The app runs the helper only when the bench pointed it at one that exists (mac-helper.ts).
      const helper = step.env.TAALCUT_MAC_HELPER === HELPER;
      writeRun(perfDir, runRecord({ elapsedMs: 100_000 + run * 10_000 }), processSamples(5, 1.5, helper));
      return Promise.resolve(0);
    },
  };
}

export const HELPER = '/repo/native/mac-helper/dist/taalcut-mac-helper';

/** A helper that answers `--version` as the real one does, or one that does not run. */
export function helperProbe(runs = true): HelperProbe & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    platform: 'darwin',
    env: {},
    version(path) {
      asked.push(path);
      return runs
        ? Promise.resolve('{"protocol":2,"swift":"6.3.3","version":"1.0.0"}\n')
        : Promise.reject(new Error(`spawn ${path} ENOENT`));
    },
    sha256: () => 'ab12',
  };
}

export function deps(shell: Shell): BenchDeps {
  return {
    shell,
    repoRoot: '/repo',
    footage: { prepare: () => Promise.resolve({ TAALCUT_E2E_LIBRARY_CACHE: '/bench/footage/smoke' }) },
    now: () => new Date('2026-10-17T10:00:00Z'),
    log: () => undefined,
    analyse: () => ({ searchableMs: 30_000, completeMs: 90_000 }),
    helper: helperProbe(),
    disk: roomyDisk,
    compiles: fakeCompiles(),
  };
}

export function options(root: string, overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    command: 'run',
    tier: 'recommended',
    runs: 3,
    footage: 'smoke',
    label: 'base',
    build: true,
    macHelper: true,
    benchRoot: root,
    copyTo: join(root, 'orch'),
    stallDir: join(root, 'stalls'),
    minFreeGb: 50,
    keepCompiles: false,
    ...overrides,
  };
}

/** 500 GB free everywhere. */
export const roomyDisk: DiskSpace = { freeBytes: () => 500 * 1024 ** 3 };

/**
 * A compile cache whose entries the test sets (`<build>/<key>` → birth ms) and adds to while a run's e2e runs
 * (`add`), as the app's compiles would appear; `alive` helper pids never leave; `running` are the mac helpers
 * running now with their parent chains (the run's, the user's app, another bench), which the test may change.
 */
export function fakeCompiles(
  entries: Record<string, number> = {},
  alive: readonly number[] = [],
): CompileCache & { removed: string[]; running: HelperProcess[]; add(entry: string, born: number): void } {
  const current = new Map(Object.entries(entries));
  const removed: string[] = [];
  const running: HelperProcess[] = [];
  return {
    root: '/caches/taalcut-mac-helper/com.apple.e5rt.e5bundlecache',
    removed,
    running,
    add: (entry, born) => void current.set(entry, born),
    entries: () => new Map(current),
    bytes: () => 1024 ** 3,
    remove(entry) {
      current.delete(entry);
      removed.push(entry);
    },
    helpersAfter: (pids) => Promise.resolve(alive.filter((pid) => pids.includes(pid))),
    helpers: () => [...running],
  };
}
