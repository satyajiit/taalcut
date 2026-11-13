// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-B5: the bench's free-space floor and its removal of the Core ML compiles each run created, on a fake cache
 * folder (never the real ~/Library/Caches/taalcut-mac-helper) and in the runner with fakes.
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCleanupLine,
  compilesSummaryLine,
  helperProcesses,
  nodeCompileCache,
  ownHelpers,
  removeRunCompiles,
  snapshotCompiles,
  watchHelpers,
  type CompileCache,
} from '../../../src/perf/bench/compile-cleanup';
import { lowDisk, lowDiskMessage, nodeDiskSpace, type DiskSpace } from '../../../src/perf/bench/disk-floor';
import { parseBenchArgs } from '../../../src/perf/bench/options';
import { runBench } from '../../../src/perf/bench/runner';
import type { ProcessSample } from '../../../src/perf/bench/run-record';
import type { Shell } from '../../../src/perf/bench/shell';
import { ps as row } from './fixtures';
import { deps, fakeCompiles, fakeShell, options, tempDir } from './runner-fakes';

const GB = 1024 ** 3;
const NOW = new Date('2026-10-17T10:00:00Z').getTime();

describe('the free-space floor', () => {
  it('names the first volume under the floor, and reads free space on the nearest folder that exists', () => {
    const disk: DiskSpace = { freeBytes: (path) => (path === '/bench' ? 80 * GB : 12.34 * GB) };
    expect(lowDisk(disk, ['/bench', '/caches'], 50)).toEqual({ path: '/caches', freeGb: 12.3, floorGb: 50 });
    expect(lowDisk(disk, ['/bench'], 50)).toBeNull();
    expect(lowDiskMessage({ path: '/caches', freeGb: 12.3, floorGb: 50 })).toMatch(
      /^\/caches has 12.3 GB free, under the bench's floor of 50 GB \(--min-free-gb\)/,
    );
    expect(nodeDiskSpace().freeBytes(join(tempDir(), 'not', 'yet'))).toBeGreaterThan(0);
  });

  it('takes the floor and --keep-compiles from the command line', () => {
    const context = { env: {}, cwd: '/w', now: new Date('2026-10-17T10:00:00Z') };
    expect(parseBenchArgs([], context)).toMatchObject({ minFreeGb: 50, keepCompiles: false });
    expect(parseBenchArgs(['--min-free-gb', '20', '--keep-compiles'], context)).toMatchObject({
      minFreeGb: 20,
      keepCompiles: true,
    });
    expect(() => parseBenchArgs(['--min-free-gb', 'lots'], context)).toThrow(/--min-free-gb/);
  });
});

/** A fake cache folder: `<root>/<build>/<key>/<file>`. */
function entry(root: string, path: string, bytes = 10): void {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, 'model.milhash'), 'x'.repeat(bytes));
}

describe('removing a run’s compiles', () => {
  it('removes only the entries absent before the run, from a cache folder, and counts their bytes', async () => {
    const root = join(tempDir(), 'e5rt');
    entry(root, '25G241/OLD');
    const cache = nodeCompileCache(root, () => '');
    const before = snapshotCompiles(cache, Date.now() - 1_000);
    entry(root, '25G241/NEW1', 64);
    entry(root, '25G241/NEW2/ABC.bundle', 100);
    const cleanup = await removeRunCompiles(cache, before, { end: Date.now(), own: [], seen: [] });
    expect([...cleanup.removed].sort()).toEqual(['25G241/NEW1', '25G241/NEW2']);
    expect(cleanup.removedBytes).toBe(164);
    expect(existsSync(join(root, '25G241', 'OLD'))).toBe(true);
    expect(existsSync(join(root, '25G241', 'NEW1'))).toBe(false);
    expect(compileCleanupLine(1, cleanup)).toContain(
      'removed the 2 Core ML compile entries it created (0 GB)',
    );
    // No cache at all: nothing to do.
    expect(nodeCompileCache(join(root, 'none'), () => '').entries().size).toBe(0);
  });

  it('keeps new entries born outside the run, and records an entry it could not remove', async () => {
    const cache: CompileCache = {
      ...fakeCompiles({ 'b/early': NOW - 60_000, 'b/late': NOW + 3_600_000, 'b/mine': NOW + 5_000 }),
      remove: () => {
        throw new Error('EACCES');
      },
    };
    const cleanup = await removeRunCompiles(
      cache,
      { at: NOW, entries: new Map() },
      { end: NOW + 60_000, own: [], seen: [] },
    );
    expect(cleanup).toMatchObject({ removed: [], kept: ['b/early', 'b/late'], failed: ['b/mine: EACCES'] });
    expect(compileCleanupLine(2, cleanup)).toMatch(
      /kept 2 new entries born outside the run; could not remove/,
    );
  });

  it('removes nothing while a mac helper the run started still runs, and never ends it', async () => {
    const cache = fakeCompiles({ 'b/mine': NOW + 1 }, [4242]);
    const cleanup = await removeRunCompiles(
      cache,
      { at: NOW, entries: new Map() },
      { end: NOW + 9, own: [4242], seen: [4242] },
    );
    expect(cleanup.skipped).toBe("the run's mac helper (pid 4242) is still running; compiles left in place");
    expect(cache.removed).toEqual([]);
    expect(compileCleanupLine(1, cleanup)).toBe(
      "[bench] run 1: Core ML compiles not removed: the run's mac helper (pid 4242) is still running; compiles left in place",
    );
  });

  it('waits for the run’s own helpers to leave, whatever their command line', async () => {
    const ps = [
      '    1     0 /sbin/launchd',
      '   50     1 /usr/bin/node /bench/run.js',
      '  101    50 /repo/native/mac-helper/dist/taalcut-mac-helper',
      '  102   103 /repo/native/mac-helper/dist/taalcut-mac-helper serve --services ocr --allow-root /elsewhere',
      '  103   103 /usr/bin/node /bench/work/x/run.js',
    ].join('\n');
    // Each with its parent chain, as far as ps knows it, never round a loop.
    expect(helperProcesses(ps)).toEqual([
      { pid: 101, ancestors: [50, 1, 0] },
      { pid: 102, ancestors: [103] },
    ]);
    let calls = 0;
    const cache = nodeCompileCache(join(tempDir(), 'e5rt'), () => (calls++ === 0 ? ps : ''));
    await expect(cache.helpersAfter([101], 5_000)).resolves.toEqual([]);
    expect(calls).toBe(2);
    await expect(nodeCompileCache('/none', () => ps).helpersAfter([101], 0)).resolves.toEqual([101]);
    await expect(nodeCompileCache('/none', () => ps).helpersAfter([], 5_000)).resolves.toEqual([]);
  });
});

describe('other mac helpers and links in the cache (IX3-F5: H1, M6)', () => {
  it('removes nothing when another mac helper ran during the run, and says why', async () => {
    const seenDuring = await removeRunCompiles(
      fakeCompiles({ 'b/mine': NOW + 1 }),
      { at: NOW, entries: new Map() },
      { end: NOW + 9, own: [], seen: [512] },
    );
    expect(seenDuring).toMatchObject({
      removed: [],
      skipped: expect.stringContaining('another mac helper (pid 512)'),
    });
    const stillThere = fakeCompiles({ 'b/mine': NOW + 1 });
    stillThere.running.push({ pid: 77, ancestors: [1] });
    const atTheEnd = await removeRunCompiles(
      stillThere,
      { at: NOW, entries: new Map() },
      { end: NOW + 9, own: [], seen: [] },
    );
    expect(atTheEnd.skipped).toContain('pid 77');
    expect(stillThere.removed).toEqual([]);
  });

  it('tells a mac helper from a command that only names it', () => {
    const ps = [
      '  101     1 /repo/native/mac-helper/dist/taalcut-mac-helper serve --models /bench/work/x/userData/c',
      '  102     1 /Applications/Taalcut.app/Contents/Resources/taalcut-mac-helper serve --services embed',
      '  103     1 taalcut-mac-helper',
      '  104     1 vim /repo/native/mac-helper/Sources/taalcut-mac-helper/main.swift',
      '  105     1 grep taalcut-mac-helper-bench',
    ].join('\n');
    expect(helperProcesses(ps).map(({ pid }) => pid)).toEqual([101, 102, 103]);
  });

  it('never lists or removes through a link, and a link to nothing is no entry', async () => {
    const root = join(tempDir(), 'e5rt');
    entry(root, '25G241/OLD');
    const outside = join(tempDir(), 'elsewhere');
    entry(outside, 'theirs/KEEP', 10);
    symlinkSync(join(outside, 'theirs'), join(root, 'LINKED'));
    symlinkSync(join(tempDir(), 'gone'), join(root, '25G241', 'DANGLING'));
    const cache = nodeCompileCache(root, () => '');
    const before = snapshotCompiles(cache, Date.now() - 1_000);
    expect([...before.entries.keys()]).toEqual(['25G241/OLD']);
    entry(outside, 'theirs/NEW', 10);
    const cleanup = await removeRunCompiles(cache, before, { end: Date.now(), own: [], seen: [] });
    expect(cleanup.removed).toEqual([]);
    expect(existsSync(join(outside, 'theirs', 'NEW'))).toBe(true);
    expect(() => cache.remove('LINKED/NEW')).toThrow(/is not inside/);
    expect(existsSync(join(outside, 'theirs', 'NEW'))).toBe(true);
    // A cache root that is itself a link: nothing in it is the bench's.
    const linkedRoot = join(tempDir(), 'linked-e5rt');
    symlinkSync(root, linkedRoot);
    expect(nodeCompileCache(linkedRoot, () => '').entries().size).toBe(0);
  });

  it('puts where it removed and where it kept the compiles in summary.md', () => {
    const line = compilesSummaryLine([
      { run: 1, cleanup: { removed: ['b/a'], removedBytes: GB, skipped: null } },
      { run: 2, cleanup: { removed: [], removedBytes: 0, skipped: 'another mac helper (pid 512) ran' } },
    ]);
    expect(line).toBe(
      '\nCore ML compiles the runs created: removed after run 1 (1.0 GB); kept after run 2: another mac helper (pid 512) ran.\n',
    );
    expect(compilesSummaryLine([])).toBe('');
  });
});

const HELPER_BIN = '/repo/native/mac-helper/dist/taalcut-mac-helper';
const BENCH = 43_400;

/** One process sample of a run's app (main, agent, jobs) with the mac helpers given as `[pid, parent pid]`. */
function appSample(main: number, helpers: readonly (readonly [number, number])[]): ProcessSample {
  const [agent, jobs] = [main + 14, main + 15];
  return {
    at: NOW,
    load: 4,
    mainPid: main,
    utilities: { agent, jobs },
    rows: [
      row(main, 82_381, 200_000, '0:01.00', '/Electron.app/Contents/MacOS/Electron'),
      row(agent, main, 100_000, '0:01.00', '/Electron Helper'),
      row(jobs, main, 100_000, '0:01.00', '/Electron Helper'),
      ...helpers.map(([pid, parent]) => row(pid, parent, 80_000, '0:01.00', HELPER_BIN)),
    ],
  };
}

describe('the run’s own mac helpers, by their ancestry (IX3-F10)', () => {
  // Run 1's app is main 85550 with jobs 85565, whose helper is 86237 (its command line names no run folder).
  const run1 = [appSample(85_550, [[86_237, 85_565]]), appSample(85_550, [[86_237, 1]])];
  const removal = (seen: readonly number[], own: readonly number[]) =>
    removeRunCompiles(
      fakeCompiles({ 'b/mine': NOW + 1 }),
      { at: NOW, entries: new Map() },
      {
        end: NOW + 9,
        own,
        seen,
      },
    );

  it('finds a helper whose parent chain reaches the app, and not one reparented or from another app', () => {
    const unrelated = appSample(85_550, [
      [86_237, 85_565],
      [9_001, 1],
      [9_002, 7_000],
    ]);
    expect(ownHelpers([unrelated])).toEqual([86_237]);
    // Reparented to launchd once the app quit (its idle exit): still the run's, from the samples before.
    expect(ownHelpers(run1)).toEqual([86_237]);
    expect(ownHelpers([run1[1] as ProcessSample])).toEqual([]);
  });

  it('removes the new compiles when the only helper seen is the run’s own, a child of jobs', async () => {
    const cleanup = await removal([86_237], ownHelpers(run1));
    expect(cleanup).toMatchObject({ removed: ['b/mine'], skipped: null });
  });

  it('keeps every compile when an unrelated helper ran during the run', async () => {
    const cleanup = await removal([86_237, 9_002], ownHelpers(run1));
    expect(cleanup.removed).toEqual([]);
    expect(cleanup.skipped).toContain('another mac helper (pid 9002)');
  });

  it('counts a helper seen under the bench as the run’s own: the seed’s Core ML compile, before the app', () => {
    const cache = fakeCompiles();
    cache.running.push(
      // The seed's compile (smoke run, pid 43970): under the Playwright worker, under the bench's e2e command.
      { pid: 43_970, ancestors: [43_577, 43_560, 43_540, BENCH, 1] },
      // The previous run's helper in its idle exit (reparented), and the user's Taalcut.
      { pid: 86_237, ancestors: [1] },
      { pid: 9_002, ancestors: [7_000, 1] },
    );
    expect(watchHelpers(cache, BENCH).stop()).toEqual({ seen: [9_002, 43_970, 86_237], own: [43_970] });
  });

  it('counts the previous run’s helper, still in its idle exit, as another (the safe side)', async () => {
    // Run 2's app is main 95550; run 1's helper 86237 is alive, reparented, and not in run 2's samples.
    const run2 = [appSample(95_550, [[96_000, 95_565]])];
    const cleanup = await removal([86_237, 96_000], ownHelpers(run2));
    expect(cleanup.removed).toEqual([]);
    expect(cleanup.skipped).toContain('another mac helper (pid 86237)');
  });
});

/** A shell whose e2e runs add one compile entry to `cache`, born now. */
const compilingShell = (cache: ReturnType<typeof fakeCompiles>): Shell =>
  fakeShell([], (run) => cache.add(`25G241/RUN${run}`, NOW + 1_000));

describe('the runner, the floor and the compiles', () => {
  it('refuses to start under the floor, before footage or builds', async () => {
    const root = tempDir();
    const shell = fakeShell();
    const low: DiskSpace = { freeBytes: () => 49 * GB };
    await expect(runBench(options(root), { ...deps(shell), disk: low })).rejects.toThrow(/49 GB free, under/);
    expect(shell.steps).toEqual([]);
  });

  it('stops before a later run once the disk falls under the floor', async () => {
    const root = tempDir();
    const lines: string[] = [];
    let reads = 0;
    // The start and run 1 have room; before run 2 the disk is full.
    const filling: DiskSpace = { freeBytes: () => ((reads += 1) <= 2 ? 80 : 10) * GB };
    const outcome = await runBench(options(root, { build: false }), {
      ...deps(fakeShell()),
      disk: filling,
      log: (line) => lines.push(line),
    });
    expect(outcome.summary.runsFinished).toBe(1);
    expect(lines.join('\n')).toMatch(/stopping before run 2: .* has 10 GB free/);
  });

  it('removes each run’s own compiles after it, keeps the cache’s older ones, and records it per run', async () => {
    const root = tempDir();
    const cache = fakeCompiles({ '25G241/OLD': NOW - 86_400_000 });
    const lines: string[] = [];
    await runBench(options(root, { runs: 2, build: false }), {
      ...deps(compilingShell(cache)),
      compiles: cache,
      log: (line) => lines.push(line),
    });
    expect(cache.removed).toEqual(['25G241/RUN1', '25G241/RUN2']);
    expect([...cache.entries().keys()]).toEqual(['25G241/OLD']);
    const record = JSON.parse(
      readFileSync(join(root, 'runs', 'base', 'run-2', 'compile-cleanup.json'), 'utf8'),
    );
    expect(record).toMatchObject({ removed: ['25G241/RUN2'], removedBytes: GB, skipped: null });
    expect(existsSync(join(root, 'orch', 'base', 'run-1', 'compile-cleanup.json'))).toBe(true);
    expect(lines.filter((line) => line.includes('Core ML compile entries'))).toHaveLength(2);
  });

  it('removes each run’s compiles while the run’s own helpers run during it: the seed’s and the app’s (IX3-F10)', async () => {
    const root = tempDir();
    const cache = fakeCompiles();
    // While each run goes: the seed's compile (pid 30, under the bench), and the app's helper (pid 12 under jobs 10
    // in the fake process samples; seen by the bench only once its app had quit, reparented).
    const shell = fakeShell([], (run) => {
      cache.add(`25G241/RUN${run}`, NOW + 1_000);
      const seed = { pid: 30, ancestors: [29, process.pid, 1] };
      cache.running.splice(0, cache.running.length, seed, { pid: 12, ancestors: [1] });
    });
    await runBench(options(root, { runs: 2, build: false }), { ...deps(shell), compiles: cache });
    expect(cache.removed).toEqual(['25G241/RUN1', '25G241/RUN2']);
  });

  it('keeps a run’s compiles when another mac helper ran during it, and says so in summary.md', async () => {
    const root = tempDir();
    const cache = fakeCompiles();
    // The user's Taalcut starts a helper during run 2.
    const shell = fakeShell([], (run) => {
      cache.add(`25G241/RUN${run}`, NOW + 1_000);
      if (run === 2) cache.running.push({ pid: 777, ancestors: [700, 1] });
    });
    await runBench(options(root, { runs: 2, build: false }), { ...deps(shell), compiles: cache });
    expect(cache.removed).toEqual(['25G241/RUN1']);
    const summary = readFileSync(join(root, 'runs', 'base', 'summary.md'), 'utf8');
    expect(summary).toContain('Core ML compiles the runs created: removed after run 1');
    expect(summary).toContain('kept after run 2: another mac helper (pid 777)');
  });

  it('keeps every compile with --keep-compiles', async () => {
    const root = tempDir();
    const cache = fakeCompiles();
    await runBench(options(root, { runs: 1, build: false, keepCompiles: true }), {
      ...deps(compilingShell(cache)),
      compiles: cache,
    });
    expect(cache.removed).toEqual([]);
    expect(existsSync(join(root, 'runs', 'base', 'run-1', 'compile-cleanup.json'))).toBe(false);
  });
});
