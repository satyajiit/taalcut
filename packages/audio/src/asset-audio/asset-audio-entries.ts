// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The asset audio store's entries and what removes them: one entry per asset (its folder and its pass), the
 * idle sweep (older than `idleMs`, then the oldest until the rest fit in `maxIdleBytes`), and the folders a
 * process that is gone left beside the store's own.
 */
import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Result } from '@taalcut/core';
import type { AudioPassResult } from './audio-pass';

export interface Entry {
  readonly dir: string;
  readonly ready: Promise<Result<AudioPassResult>>;
  pass?: AudioPassResult;
  refs: number;
  discard: boolean;
  lastUsed: number;
}

export interface EntryLimits {
  readonly idleMs: number;
  readonly maxIdleBytes: number;
}

export interface EntryTable {
  readonly entries: Map<string, Entry>;
  /** Forgets the entry (if it is still the one under `key`) and removes its folder. */
  remove(key: string, entry: Entry): Promise<void>;
  /** Removes the idle entries over the limits. */
  sweep(): Promise<void>;
}

type Keyed = readonly [string, Entry];

const OWNER = /^(\d+)-/;

/** BLAKE3 from library.hash when there is one, so two paths to one file share a pass; else the path. */
export function keyOf(asset: { readonly path: string; readonly contentHash?: string | undefined }): string {
  return asset.contentHash ?? `path:${resolve(asset.path)}`;
}

/** Removes the folders beside ours whose owning process is gone (a crash mid-index). */
export async function removeOrphans(
  parent: string,
  pid: number,
  isAlive: (pid: number) => boolean,
): Promise<void> {
  for (const name of await readdir(parent).catch(() => [] as string[])) {
    const owner = OWNER.exec(name)?.[1];
    if (!owner || Number(owner) === pid || isAlive(Number(owner))) continue;
    await rm(join(parent, name), { recursive: true, force: true });
  }
}

/** The idle entries to drop: older than `idleMs`, then the oldest until the rest fit in `maxIdleBytes`. */
function overBudget(idle: readonly Keyed[], age: (entry: Entry) => number, limits: EntryLimits): Keyed[] {
  const bytesOf = (entry: Entry) => (entry.pass?.pcm.frames ?? 0) * 2;
  const stale = idle.filter(([, entry]) => age(entry) > limits.idleMs);
  const fresh = idle.filter(([, entry]) => age(entry) <= limits.idleMs).sort((a, b) => age(b[1]) - age(a[1]));
  let bytes = fresh.reduce((sum, [, entry]) => sum + bytesOf(entry), 0);
  const evicted: Keyed[] = [];
  for (const item of fresh) {
    if (bytes <= limits.maxIdleBytes) break;
    bytes -= bytesOf(item[1]);
    evicted.push(item);
  }
  return [...stale, ...evicted];
}

export function createEntryTable(now: () => number, limits: EntryLimits): EntryTable {
  const entries = new Map<string, Entry>();
  const remove = async (key: string, entry: Entry) => {
    if (entries.get(key) === entry) entries.delete(key);
    await rm(entry.dir, { recursive: true, force: true });
  };
  return {
    entries,
    remove,
    async sweep() {
      const idle = [...entries].filter(([, entry]) => entry.refs === 0 && entry.pass !== undefined);
      const age = (entry: Entry) => now() - entry.lastUsed;
      for (const [key, entry] of overBudget(idle, age, limits)) await remove(key, entry);
    },
  };
}
