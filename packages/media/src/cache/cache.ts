// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Derived-file cache. Writes are atomic (a `.part` of their own, fsync, rename). Eviction is oldest-first inside
 * tiers, down to 90% of the cap (cache-order.ts). Pins are never evicted, nor a file its owner still uses
 * (`release`). A put landing on a key while it is evicted is safe: the rename and the delete take turns per key,
 * and the put's file is what stays.
 */
import { randomBytes } from 'node:crypto';
import { copyFile, open, rename, rm, stat, utimes } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createKeyedQueue, createSerialQueue, err, ok, type EventPayload, type Result } from '@taalcut/core';
import { CachePinnedOverCap, CacheUnavailable } from '../errors';
import { EVICT_LIMIT, evictionOrder, type CacheEntry } from './cache-order';
import { scan, scanAtStart } from './cache-scan';
import { isDerivedKey } from './layout';

/** Payload of `media.derivedEvicted` (core's event catalogue). */
type DerivedEvicted = EventPayload<'media.derivedEvicted'>;
type EnforceInput = Parameters<DerivedCache['enforceCap']>[0];
type EnforceResult = Result<DerivedEvicted & { readonly usageBytes: number }>;

const TOUCH_GAP_MS = 10 * 60 * 1000;

export interface CacheClock {
  now(): number;
}

export interface DerivedCache {
  readonly root: string;
  put(key: string, body: Buffer | string): Promise<Result<{ readonly bytes: number; readonly overCap: boolean }>>;
  putFile?(
    key: string,
    sourcePath: string,
  ): Promise<Result<{ readonly bytes: number; readonly overCap: boolean }>>;
  touch(key: string): Promise<void>;
  usage(): { readonly bytes: number; readonly files: number };
  absPath(key: string): string | undefined;
  /** One run at a time: a second call waits for the first. Each run reads the disk again first. */
  enforceCap(input: {
    readonly offlineHashes: readonly string[];
    readonly pinned: readonly string[];
    /** Overrides the cap this cache was built with. The job passes the setting. */
    readonly capBytes?: number;
  }): Promise<Result<DerivedEvicted & { readonly usageBytes: number }>>;
}

export interface DerivedCacheOptions {
  readonly root: string;
  readonly capBytes: number;
  readonly clock?: CacheClock;
  /** After a run that deleted files: the keys that stayed gone (`media.derivedEvicted`). */
  readonly onEvicted?: (payload: DerivedEvicted) => void;
  /** A put left the cache over its cap (the jobs process enforces it soon after: cap-trigger.ts). */
  readonly onOverCap?: () => void;
  /**
   * Asked for each file just before a run deletes it: false keeps it (the library: its clip is open, or one of its
   * stages is being fed, queued or running), true means its owner has let it go. Without it every unpinned file can go.
   */
  readonly release?: (key: string) => boolean;
}

export function createDerivedCache(options: DerivedCacheOptions): DerivedCache {
  const root = resolve(options.root);
  mkdirSync(root, { recursive: true });
  const clock = options.clock ?? { now: () => Date.now() };
  const entries = new Map<string, CacheEntry>(
    scanAtStart(root, clock.now()).map((found) => [found.key, { ...found, seq: 0 }]),
  );
  const touched = new Map<string, number>();
  /** Per key, so a put's rename and an eviction's delete of the same key never overlap. */
  const locks = createKeyedQueue();
  let total = 0;
  let commits = 0;
  /** One cap run at a time; each caller gets its own run's outcome. */
  const capRuns = createSerialQueue();
  recount();

  function recount(): void {
    total = 0;
    for (const entry of entries.values()) total += entry.bytes;
  }

  function set(entry: CacheEntry): void {
    total += entry.bytes - (entries.get(entry.key)?.bytes ?? 0);
    entries.set(entry.key, entry);
  }

  function drop(key: string): void {
    total -= entries.get(key)?.bytes ?? 0;
    entries.delete(key);
    touched.delete(key);
  }

  function absPath(key: string): string | undefined {
    if (!isDerivedKey(key)) return undefined;
    const abs = resolve(root, key);
    if (abs !== root && !abs.startsWith(root + sep)) return undefined;
    return abs;
  }

  /** The disk again: other processes' files and main's reads count; a put during the walk stays as it is. */
  async function refresh(): Promise<void> {
    const since = commits;
    const seen = new Set<string>();
    for (const found of await scan(root)) {
      seen.add(found.key);
      const entry = entries.get(found.key);
      if (!entry) entries.set(found.key, { ...found, seq: 0 });
      else if (entry.seq <= since) {
        entry.bytes = found.bytes;
        entry.mtime = Math.max(entry.mtime, found.mtime);
      }
    }
    for (const [key, entry] of entries) if (!seen.has(key) && entry.seq <= since) drop(key);
    recount();
  }

  /** Under the key's lock: false when a put replaced it since the run listed it, its owner keeps it, or it won't go. */
  async function evictOne(victim: CacheEntry): Promise<boolean> {
    const abs = absPath(victim.key);
    if (!abs || entries.get(victim.key) !== victim) return false;
    if (options.release && !options.release(victim.key)) return false;
    const removed = await rm(abs, { force: true }).then(
      () => true,
      () => false, // Still on disk and still counted: the next run tries again.
    );
    if (removed) drop(victim.key);
    return removed;
  }

  async function enforce({ offlineHashes, pinned, capBytes }: EnforceInput): Promise<EnforceResult> {
    const cap = capBytes ?? options.capBytes;
    await refresh();
    const pin = new Set(pinned);
    let pinnedBytes = 0;
    for (const key of pin) pinnedBytes += entries.get(key)?.bytes ?? 0;
    if (pinnedBytes > cap) return err(CachePinnedOverCap({ capBytes: cap }));
    if (total <= cap) return ok({ keys: [], freedBytes: 0, usageBytes: total });
    const target = Math.floor(cap * 0.9);
    const victims = evictionOrder(
      [...entries.values()].filter((entry) => !pin.has(entry.key)),
      offlineHashes,
    );
    const deleted: string[] = [];
    let freed = 0;
    for (const victim of victims) {
      if (total <= target || deleted.length >= EVICT_LIMIT) break;
      if (!(await locks.run(victim.key, () => evictOne(victim)))) continue;
      deleted.push(victim.key);
      freed += victim.bytes;
    }
    // A put that landed on a key after its delete is the file now: that key isn't gone.
    const keys = deleted.filter((key) => !entries.has(key));
    const payload: DerivedEvicted = { keys, freedBytes: freed };
    if (keys.length > 0) options.onEvicted?.(payload);
    return ok({ ...payload, usageBytes: total });
  }

  return {
    root,
    absPath,
    usage: () => ({ bytes: total, files: entries.size }),
    async put(key, body) {
      const abs = absPath(key);
      if (!abs) return err(CacheUnavailable({ detail: 'derived key rejected' }));
      const data = typeof body === 'string' ? Buffer.from(body) : body;
      const part = `${abs}.${randomBytes(6).toString('hex')}.part`;
      try {
        mkdirSync(dirname(abs), { recursive: true });
        const handle = await open(part, 'wx');
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await locks.run(key, async () => {
          await rename(part, abs);
          set({ key, bytes: data.length, mtime: clock.now(), seq: ++commits });
        });
      } catch (cause) {
        // A part that won't go either is swept at a later start, once it is an hour old.
        await rm(part, { force: true }).catch(() => undefined);
        return err(CacheUnavailable({ detail: cause instanceof Error ? cause.message : 'cache write failed' }));
      }
      touched.set(key, clock.now());
      const overCap = total > options.capBytes;
      if (overCap) options.onOverCap?.();
      return ok({ bytes: data.length, overCap });
    },
    async putFile(key, sourcePath) {
      const abs = absPath(key);
      if (!abs) return err(CacheUnavailable({ detail: 'derived key rejected' }));
      const part = `${abs}.${randomBytes(6).toString('hex')}.part`;
      let size = 0;
      try {
        const st = await stat(sourcePath);
        size = st.size;
        mkdirSync(dirname(abs), { recursive: true });
        await rename(sourcePath, part).catch(async () => {
          await copyFile(sourcePath, part);
          await rm(sourcePath, { force: true });
        });
        await locks.run(key, async () => {
          await rename(part, abs);
          set({ key, bytes: size, mtime: clock.now(), seq: ++commits });
        });
      } catch (cause) {
        await rm(part, { force: true }).catch(() => undefined);
        return err(CacheUnavailable({ detail: cause instanceof Error ? cause.message : 'cache write failed' }));
      }
      touched.set(key, clock.now());
      const overCap = total > options.capBytes;
      if (overCap) options.onOverCap?.();
      return ok({ bytes: size, overCap });
    },
    async touch(key) {
      const abs = absPath(key);
      const entry = entries.get(key);
      if (!abs || !entry) return;
      const now = clock.now();
      const last = touched.get(key) ?? 0;
      if (now - last < TOUCH_GAP_MS) return;
      const when = new Date(now);
      await utimes(abs, when, when).catch(() => undefined);
      entry.mtime = now;
      touched.set(key, now);
    },
    enforceCap: (input) => capRuns.run(() => enforce(input)),
  };
}
