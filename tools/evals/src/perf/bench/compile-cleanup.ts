// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bench removes the Core ML compiles each run created (IX3-B5). Core ML keeps a compile per model path in the
 * process's cache (`~/Library/Caches/taalcut-mac-helper/com.apple.e5rt.e5bundlecache/<OS build>/<key>`), and every
 * run installs the models under a fresh, throwaway userData, so each run left about 1 GB nobody would read again
 * (24 GB by the end of round IX2). Only what the run provably created goes: an entry absent from the snapshot taken
 * just before the run and born between that snapshot and the run's end. Older entries, and new ones born outside
 * the window, are never touched; nothing is read inside an entry (its layout is Apple's). A mac helper is the run's
 * own when, seen while the run goes, its parent chain reaches the bench (the run's e2e is the bench's only child
 * then: the seed's Core ML compile runs under the Playwright worker) or the run's app (its main process or a
 * utility process, in the app's process samples, index-processes.jsonl); the helper's command line names no run
 * folder (IX3-F10). Nothing is removed while one of the run's own helpers still runs (it may be writing there; it
 * can outlive the app until its idle exit); the bench waits a while, then leaves the compiles in place and says so.
 * Nothing is removed either when any other mac helper (the user's Taalcut, another bench, a dev helper, the previous
 * run's helper still in its idle exit) ran during the run: it shares the cache, and its compiles can't be told from
 * the run's (IX3-F5, H1). It never ends a process. Only real folders are listed and removed: a symbolic link in the cache is never followed
 * (M6). Each run thus starts from the cache the bench found.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { z } from 'zod';
import { MAC_HELPER_NAME } from './mac-helper';
import type { ProcessSample } from './run-record';

/** Core ML's cache for processes named `taalcut-mac-helper` (the folder is named after the process). */
export const HELPER_COMPILE_CACHE = join(
  homedir(),
  'Library',
  'Caches',
  MAC_HELPER_NAME,
  'com.apple.e5rt.e5bundlecache',
);

/** Clock and file-time granularity, either side of the run's window. */
const WINDOW_SLACK_MS = 1_000;
/** How long the bench waits for a run's helpers to leave before it gives up on removing (never kills). */
const HELPER_WAIT_MS = 30_000;

export interface CompileCache {
  readonly root: string;
  /** Every entry, `<OS build>/<key>`, with its birth time (epoch ms). Empty without the cache. */
  entries(): ReadonlyMap<string, number>;
  /** Bytes in an entry. */
  bytes(entry: string): number;
  remove(entry: string): void;
  /** Every mac helper running now, whoever started it, with its parent chain. */
  helpers(): readonly HelperProcess[];
  /** Waits up to `ms` for the mac helpers `pids` to exit; the ones still running. */
  helpersAfter(pids: readonly number[], ms: number): Promise<readonly number[]>;
}

/** A mac helper and its parent chain as `ps` saw it: its parent, that one's parent, … up to launchd. */
export interface HelperProcess {
  readonly pid: number;
  readonly ancestors: readonly number[];
}

/** The mac helpers seen while a run went, and those of them seen under the bench: the run's own. */
export interface HelperSightings {
  readonly seen: readonly number[];
  readonly own: readonly number[];
}

export interface CompileSnapshot {
  readonly at: number;
  readonly entries: ReadonlyMap<string, number>;
}

export interface CompileCleanup {
  readonly cache: string;
  /** Entries the run created and the bench removed. */
  readonly removed: readonly string[];
  readonly removedBytes: number;
  /** New entries born outside the run's window: not provably the run's, so kept. */
  readonly kept: readonly string[];
  /** `<entry>: <error>` for entries that could not be removed. */
  readonly failed: readonly string[];
  /** Why nothing was removed, else null. */
  readonly skipped: string | null;
}

export const snapshotCompiles = (cache: CompileCache, at: number): CompileSnapshot => ({
  at,
  entries: cache.entries(),
});

/**
 * Looks for mac helpers every `everyMs` while a run goes. One seen with `bench` (this process) in its parent chain
 * is the run's own: the run's e2e is the bench's only child while it goes, so that is the seed's Core ML compile
 * (under the Playwright worker) or the app's helper (under its jobs process). The previous run's helper, still in
 * its idle exit, was reparented to launchd when its app quit, so it counts as another: the safe side.
 */
export function watchHelpers(
  cache: CompileCache,
  bench = process.pid,
  everyMs = 2_000,
): { stop(): HelperSightings } {
  const seen = new Set<number>();
  const own = new Set<number>();
  const look = () => {
    for (const { pid, ancestors } of cache.helpers()) {
      seen.add(pid);
      if (ancestors.includes(bench)) own.add(pid);
    }
  };
  look();
  const timer = setInterval(look, everyMs);
  timer.unref?.();
  const sorted = (pids: Set<number>) => [...pids].sort((a, b) => a - b);
  return {
    stop() {
      clearInterval(timer);
      look();
      return { seen: sorted(seen), own: sorted(own) };
    },
  };
}

/**
 * The mac helpers of the run's app: in a process sample, a helper whose parent chain reaches the app's main process
 * or one of its utility processes (the jobs process starts it). Each sample is the app's tree at that moment, so a
 * helper that later outlives the app (reparented, in its idle exit) is still found in the samples taken before.
 */
export function ownHelpers(samples: readonly ProcessSample[]): number[] {
  const own = new Set<number>();
  for (const sample of samples) {
    // The app's own pids; never pid 1 (launchd), the parent of every orphan.
    const app = new Set([sample.mainPid, ...Object.values(sample.utilities)].filter((pid) => pid > 1));
    const parent = new Map(sample.rows.map((row) => [row.pid, row.ppid]));
    for (const row of sample.rows)
      if (HELPER_EXECUTABLE.test(row.command) && ancestorsOf(row.pid, parent).some((pid) => app.has(pid)))
        own.add(row.pid);
  }
  return [...own].sort((a, b) => a - b);
}

export async function removeRunCompiles(
  cache: CompileCache,
  before: CompileSnapshot,
  run: {
    readonly end: number;
    readonly waitMs?: number;
    /** The run's own mac helpers (watchHelpers, ownHelpers). */
    readonly own: readonly number[];
    /** Every mac helper seen during the run (watchHelpers). */
    readonly seen: readonly number[];
  },
): Promise<CompileCleanup> {
  const empty = { cache: cache.root, removed: [], removedBytes: 0, kept: [], failed: [] };
  const alive = await cache.helpersAfter(run.own, run.waitMs ?? HELPER_WAIT_MS);
  if (alive.length > 0)
    return {
      ...empty,
      skipped: `the run's mac helper (pid ${alive.join(', ')}) is still running; compiles left in place`,
    };
  const own = new Set(run.own);
  const others = [...new Set([...run.seen, ...cache.helpers().map(({ pid }) => pid)])]
    .filter((pid) => !own.has(pid))
    .sort((a, b) => a - b);
  if (others.length > 0)
    return {
      ...empty,
      skipped:
        `another mac helper (pid ${others.join(', ')}) ran during the run and shares the cache; ` +
        "its compiles and the run's can't be told apart, so all were left in place",
    };
  const created = [...cache.entries()].filter(([entry]) => !before.entries.has(entry));
  const inWindow = ([, born]: [string, number]) =>
    born >= before.at - WINDOW_SLACK_MS && born <= run.end + WINDOW_SLACK_MS;
  const removed: string[] = [];
  const failed: string[] = [];
  let removedBytes = 0;
  for (const [entry] of created.filter(inWindow)) {
    const bytes = cache.bytes(entry);
    try {
      cache.remove(entry);
      removed.push(entry);
      removedBytes += bytes;
    } catch (error) {
      failed.push(`${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const kept = created.filter((item) => !inWindow(item)).map(([entry]) => entry);
  return { cache: cache.root, removed, removedBytes, kept, failed, skipped: null };
}

const cleanupSchema = z.object({
  removed: z.array(z.string()),
  removedBytes: z.number(),
  skipped: z.string().nullable(),
});

/** What summary.md needs of a run's compile-cleanup.json; an unreadable one says so. */
export function compileCleanupOf(
  json: unknown,
): Pick<CompileCleanup, 'removed' | 'removedBytes' | 'skipped'> {
  const parsed = cleanupSchema.safeParse(json);
  return parsed.success
    ? parsed.data
    : { removed: [], removedBytes: 0, skipped: 'its compile-cleanup.json could not be read' };
}

/** summary.md's line: where the bench removed its compiles, and where it kept them and why (H1). */
export function compilesSummaryLine(
  runs: readonly {
    readonly run: number;
    readonly cleanup: Pick<CompileCleanup, 'removed' | 'removedBytes' | 'skipped'>;
  }[],
): string {
  if (runs.length === 0) return '';
  const removed = runs.filter(({ cleanup }) => cleanup.skipped === null);
  const kept = runs.filter(({ cleanup }) => cleanup.skipped !== null);
  const gb = removed.reduce((sum, { cleanup }) => sum + cleanup.removedBytes, 0) / 1024 ** 3;
  const parts = [
    ...(removed.length === 0
      ? []
      : [`removed after run ${removed.map(({ run }) => run).join(', ')} (${gb.toFixed(1)} GB)`]),
    ...kept.map(({ run, cleanup }) => `kept after run ${run}: ${cleanup.skipped}`),
  ];
  return `\nCore ML compiles the runs created: ${parts.join('; ')}.\n`;
}

/** The run's line in the bench log. */
export function compileCleanupLine(run: number, cleanup: CompileCleanup): string {
  if (cleanup.skipped !== null) return `[bench] run ${run}: Core ML compiles not removed: ${cleanup.skipped}`;
  const gb = Math.round((cleanup.removedBytes / 1024 ** 3) * 10) / 10;
  const kept =
    cleanup.kept.length === 0 ? '' : `; kept ${cleanup.kept.length} new entries born outside the run`;
  const failed = cleanup.failed.length === 0 ? '' : `; could not remove ${cleanup.failed.join(', ')}`;
  return `[bench] run ${run}: removed the ${cleanup.removed.length} Core ML compile entries it created (${gb} GB) from ${cleanup.cache}${kept}${failed}`;
}

function bytesUnder(path: string): number {
  const stats = lstatSync(path);
  if (!stats.isDirectory()) return stats.size;
  return readdirSync(path).reduce((sum, name) => sum + bytesUnder(join(path, name)), 0);
}

/** The helper's executable (a path ending in its name), not a command that merely mentions it. */
const HELPER_EXECUTABLE = new RegExp(`(^|/)${MAC_HELPER_NAME}(\\s|$)`);

/** `pid`'s parent, that one's parent, … as far as `parent` knows them (never round a loop). */
function ancestorsOf(pid: number, parent: ReadonlyMap<number, number>): number[] {
  const chain: number[] = [];
  for (let up = parent.get(pid); up !== undefined && up !== pid && !chain.includes(up); up = parent.get(up))
    chain.push(up);
  return chain;
}

/** The `ps -axo pid=,ppid=,command=` rows that run the mac helper (whoever started it), with their parent chains. */
export function helperProcesses(psOutput: string): HelperProcess[] {
  const rows = psOutput
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, command = '']) => ({ pid: Number(pid), ppid: Number(ppid), command }));
  const parent = new Map(rows.map(({ pid, ppid }) => [pid, ppid]));
  return rows
    .filter(({ command }) => HELPER_EXECUTABLE.test(command))
    .map(({ pid }) => ({ pid, ancestors: ancestorsOf(pid, parent) }));
}

/** A real folder: not a symbolic link, not missing (M6). */
const realFolder = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

/** Names of the real folders in `dir`; a Dirent never follows a link. */
const subfolders = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

/** `<build>/<key>` → birth time of every entry under the cache's real build folders; links are not entries. */
function cacheEntries(root: string): Map<string, number> {
  const found = new Map<string, number>();
  if (!realFolder(root)) return found;
  for (const build of subfolders(root)) {
    const buildDir = join(root, build);
    for (const key of readdirSync(buildDir, { withFileTypes: true })) {
      if (key.isSymbolicLink()) continue;
      // Gone since the listing (Core ML removed it): not an entry.
      const stats = lstatSync(join(buildDir, key.name), { throwIfNoEntry: false });
      // Birth time where the file system keeps one (APFS does); else the last change.
      if (stats) found.set(`${build}/${key.name}`, stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs);
    }
  }
  return found;
}

/** Removes an entry only inside the cache as it really is: never through a link to somewhere else (M6). */
function removeInside(root: string, entry: string): void {
  const inside = realpathSync(join(root, entry));
  if (!realFolder(root) || !inside.startsWith(realpathSync(root) + sep))
    throw new Error(`${entry} is not inside ${root}`);
  rmSync(inside, { recursive: true });
}

const listProcesses = (): string => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' });

export function nodeCompileCache(
  root = HELPER_COMPILE_CACHE,
  ps: () => string = listProcesses,
): CompileCache {
  return {
    root,
    entries: () => cacheEntries(root),
    bytes: (entry) => bytesUnder(join(root, entry)),
    remove: (entry) => removeInside(root, entry),
    helpers: () => helperProcesses(ps()),
    async helpersAfter(pids, ms) {
      const until = Date.now() + ms;
      for (;;) {
        const running = helperProcesses(ps())
          .map(({ pid }) => pid)
          .filter((pid) => pids.includes(pid));
        if (running.length === 0 || Date.now() >= until) return running;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    },
  };
}
