// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The per-asset frame cache (IX-D2): decoded frames and analysis results one
 * indexing stage leaves for the next, so an asset's video is decoded once.
 * It lives in one process (the jobs process) and keeps its index in memory;
 * the bytes are files under `root`.
 *
 * Bounded: an asset takes at most `assetBytes`, all assets `totalBytes`
 * (FRAME_CACHE_LIMITS: 1 GiB and 2 GiB); past them a file is not kept, and
 * least recently used assets nobody holds make room first. Deleted: when
 * every consumer the producer named has released the asset (or the asset is
 * dropped: its indexing ended), when it sat unused for `idleMs` (15 min), and
 * all of it at process start (`clear`): nothing a crashed process wrote is
 * anyone's any more. Each asset's files sit in a fresh folder, so a delete in
 * flight never races a new entry for the same asset.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { CacheUnavailable } from '../errors';
import { createAssetFrames, type AssetFrames } from './asset-frames';

const MIB = 1024 * 1024;

export interface FrameCacheLimits {
  /** All assets together. */
  readonly totalBytes: number;
  /** One asset. */
  readonly assetBytes: number;
  /** An asset nobody held for this long goes at the next `sweepIdle`. */
  readonly idleMs: number;
}

export const FRAME_CACHE_LIMITS: FrameCacheLimits = {
  totalBytes: 2048 * MIB,
  assetBytes: 1024 * MIB,
  idleMs: 15 * 60_000,
};

export interface FrameCacheOptions {
  readonly root: string;
  readonly limits?: Partial<FrameCacheLimits>;
  readonly clock?: { now(): number };
}

/** One holder's use of an asset's entry, from `open` to `close`. */
export interface FrameCacheHold {
  readonly frames: AssetFrames;
  /** The consumers that will read what this holder leaves (the producer names them). */
  expect(consumers: readonly string[]): void;
  /** Ends the hold. An entry nobody holds and nobody is expected to read goes at once. */
  close(): Promise<void>;
}

export interface FrameCache {
  readonly root: string;
  readonly limits: FrameCacheLimits;
  /** Deletes everything under the root (process start). */
  clear(): Promise<void>;
  open(asset: string): AsyncResult<FrameCacheHold>;
  /** `consumer` is done with the asset: the entry goes when no consumer is left and nobody holds it. */
  release(asset: string, consumer: string): Promise<void>;
  /** The asset's indexing ended: its entry goes now (or when its last holder closes). */
  drop(asset: string): Promise<void>;
  /** Deletes entries nobody held for `idleMs`; returns their assets. */
  sweepIdle(): Promise<string[]>;
  usage(): { readonly bytes: number; readonly assets: number };
}

interface Entry {
  readonly frames: AssetFrames;
  readonly consumers: Set<string>;
  holders: number;
  usedAt: number;
  dropped: boolean;
}

export function createFrameCache(options: FrameCacheOptions): FrameCache {
  const limits = { ...FRAME_CACHE_LIMITS, ...options.limits };
  const now = () => (options.clock ? options.clock.now() : Date.now());
  const entries = new Map<string, Entry>();
  let total = 0;

  async function remove(asset: string, entry: Entry): Promise<void> {
    if (entries.get(asset) !== entry) return;
    entries.delete(asset);
    total -= entry.frames.bytes;
    await rm(entry.frames.dir, { recursive: true, force: true });
  }

  async function settle(asset: string, entry: Entry): Promise<void> {
    if (entry.holders > 0) return;
    if (entry.dropped || entry.consumers.size === 0) await remove(asset, entry);
  }

  /** Room for `bytes` more in `entry`: its own bound, then the total, evicting idle assets oldest first. */
  async function reserve(entry: Entry, bytes: number): Promise<boolean> {
    if (entry.frames.bytes + bytes > limits.assetBytes || bytes > limits.totalBytes) return false;
    const victims = [...entries.entries()]
      .filter(([, other]) => other !== entry && other.holders === 0)
      .sort(([, a], [, b]) => a.usedAt - b.usedAt);
    // Evicting cannot make room: keep the others' frames and refuse this file.
    const freeable = victims.reduce((sum, [, victim]) => sum + victim.frames.bytes, 0);
    if (total - freeable + bytes > limits.totalBytes) return false;
    for (const [asset, victim] of victims) {
      if (total + bytes <= limits.totalBytes) break;
      await remove(asset, victim);
    }
    if (total + bytes > limits.totalBytes) return false;
    total += bytes;
    return true;
  }

  return {
    root: options.root,
    limits,
    async clear() {
      entries.clear();
      total = 0;
      // No folder yet: nothing to clear.
      const names = await readdir(options.root).catch((): string[] => []);
      await Promise.all(names.map((name) => rm(join(options.root, name), { recursive: true, force: true })));
    },
    async open(asset) {
      let entry = entries.get(asset);
      if (!entry) {
        const name = createHash('sha256').update(asset).digest('hex').slice(0, 16);
        const dir = join(options.root, `${name}-${randomUUID()}`);
        try {
          await mkdir(dir, { recursive: true });
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : 'frame cache folder';
          return err(CacheUnavailable(undefined, { detail }));
        }
        entry = entries.get(asset);
        if (!entry) {
          const created: Entry = {
            frames: createAssetFrames(asset, dir, {
              reserve: (_frames, bytes) => reserve(created, bytes),
              free: (bytes) => {
                total -= bytes;
              },
            }),
            consumers: new Set(),
            holders: 0,
            usedAt: now(),
            dropped: false,
          };
          entries.set(asset, created);
          entry = created;
        } else await rm(dir, { recursive: true, force: true });
      }
      const held = entry;
      held.holders++;
      held.usedAt = now();
      let open = true;
      return ok({
        frames: held.frames,
        expect: (consumers) => {
          for (const consumer of consumers) held.consumers.add(consumer);
        },
        close: async () => {
          if (!open) return;
          open = false;
          held.holders--;
          held.usedAt = now();
          await settle(asset, held);
        },
      });
    },
    async release(asset, consumer) {
      const entry = entries.get(asset);
      if (!entry) return;
      entry.consumers.delete(consumer);
      await settle(asset, entry);
    },
    async drop(asset) {
      const entry = entries.get(asset);
      if (!entry) return;
      entry.dropped = true;
      await settle(asset, entry);
    },
    async sweepIdle() {
      const cutoff = now() - limits.idleMs;
      const idle = [...entries.entries()].filter(([, e]) => e.holders === 0 && e.usedAt <= cutoff);
      for (const [asset, entry] of idle) await remove(asset, entry);
      return idle.map(([asset]) => asset);
    },
    usage: () => ({ bytes: total, assets: entries.size }),
  };
}
