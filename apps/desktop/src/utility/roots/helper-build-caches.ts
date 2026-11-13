// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The compile caches of other mac helper builds, let go (FIX-OCRCOLD). A development build of the helper (signed ad
 * hoc) keeps the models Apple's compiler builds for it in a cache of its own, `~/Library/Caches/taalcut-mac-helper-
 * <16 hex>/` (mac-helper SPEC, "OCR v2"): builds that share one undo each other's compiles. Each such folder is up to
 * about 1 GB (the Core ML embedder's), so the jobs process lets go of the other builds' once this build's OCR warm-up
 * has answered, never before it (the person's first text reads don't wait on the deletes) and never one that may be
 * in use: one with a live process's marker in its `.in-use` folder, or one started within `idleMs` (a worktree's
 * build between its runs). Each is renamed aside at once and deleted in the background, as main's sweep does for the
 * shared cache (src/main/compile-cache); a rename an interrupted delete left goes at the next prune. The shared
 * `taalcut-mac-helper` cache of Developer ID builds, the only kind on a person's Mac, is main's sweep's (IX3-B6) and
 * never touched here, nor is anything else in the folder. Only real folders are listed: links are never followed.
 */
import { lstatSync, readdirSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export const BUILD_CACHE = /^taalcut-mac-helper-[0-9a-f]{16}$/;
const DISCARDED = '.taalcut-discarded-taalcut-mac-helper-';
const IN_USE = '.in-use';
/** A build started within a day keeps its cache. */
export const BUILD_CACHE_IDLE_MS = 24 * 60 * 60 * 1000;

export interface BuildCacheDeps {
  /** `~/Library/Caches`. */
  readonly caches: string;
  /** This build's folder, from the warm-up's report; absent for a Developer ID build. */
  readonly keep?: string;
  readonly now: () => number;
  /** Whether a process with this pid runs. */
  readonly alive: (pid: number) => boolean;
  readonly idleMs?: number;
}

export interface BuildCachePrune {
  /** The folders let go, by name. */
  readonly discarded: readonly string[];
  /** Their deletion, and that of leftovers from an earlier prune. */
  readonly deleted: Promise<void>;
}

/** Whether a process exists (signal 0 checks, sends nothing). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause instanceof Error && 'code' in cause && cause.code === 'EPERM';
  }
}

const realFolder = (path: string) => lstatSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

function inUse(folder: string, alive: (pid: number) => boolean): boolean {
  const markers = join(folder, IN_USE);
  if (!realFolder(markers)) return false;
  return readdirSync(markers).some((name) => /^\d+$/.test(name) && alive(Number(name)));
}

export function pruneHelperBuildCaches(deps: BuildCacheDeps): BuildCachePrune {
  const { caches } = deps;
  if (!realFolder(caches)) return { discarded: [], deleted: Promise.resolve() };
  const idleMs = deps.idleMs ?? BUILD_CACHE_IDLE_MS;
  const entries = readdirSync(caches, { withFileTypes: true });
  const leftovers = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(DISCARDED))
    .map((entry) => rm(join(caches, entry.name), { recursive: true, force: true }));
  const discarded: string[] = [];
  const deletions: Promise<void>[] = [];
  // A Dirent never follows a link, so a linked folder is not a directory here.
  for (const entry of entries) {
    const name = entry.name;
    if (!entry.isDirectory() || !BUILD_CACHE.test(name) || name === deps.keep) continue;
    const folder = join(caches, name);
    const dated = lstatSync(folder, { throwIfNoEntry: false })?.mtimeMs;
    if (dated === undefined || deps.now() - dated < idleMs || inUse(folder, deps.alive)) continue;
    const moved = join(caches, `${DISCARDED}${name.slice('taalcut-mac-helper-'.length)}-${deps.now()}`);
    renameSync(folder, moved);
    discarded.push(name);
    deletions.push(rm(moved, { recursive: true, force: true }));
  }
  return {
    discarded: discarded.sort(),
    deleted: Promise.all([...leftovers, ...deletions]).then(() => undefined),
  };
}
