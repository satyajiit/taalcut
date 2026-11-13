// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cache's runs as the jobs process makes them (UX2 round 3): the disk read again first (other processes' files,
 * main's reads), files their owner still uses kept, a put on a key being evicted safe, one run at a time, and the
 * put that crosses the cap saying so.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDerivedCache, type DerivedCacheOptions } from '../src/cache/cache';
import { derivedKey } from '../src/cache/layout';

const hash = (c: string) => c.repeat(64);
const MINUTE = 60_000;

describe('the cache’s runs', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function cacheWith(options: Omit<DerivedCacheOptions, 'root'>) {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-cache-runs-'));
    dirs.push(root);
    return { root, cache: createDerivedCache({ root, ...options }) };
  }

  /** Writes a file as another process (or main's touch) would: straight to disk, with this mtime. */
  async function onDisk(root: string, key: string, bytes: number, mtime: number) {
    const abs = join(root, key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.alloc(bytes));
    await utimes(abs, new Date(mtime), new Date(mtime));
  }

  it('reads the disk again first: another process’s files count, and a file main served lately goes last', async () => {
    const { root, cache } = await cacheWith({ capBytes: 100 });
    const now = Date.now();
    const read = derivedKey('proxy', hash('a'), 1, 'mp4');
    const unread = derivedKey('proxy', hash('b'), 1, 'mp4');
    await cache.put(read, Buffer.alloc(40));
    await cache.put(unread, Buffer.alloc(40));
    // The render process wrote a subject track; main's media protocol touched `read` after both were made.
    const theirs = derivedKey('subjectTrack', hash('c'), 1, 'json');
    await onDisk(root, theirs, 30, now - 30 * MINUTE);
    await utimes(join(root, read), new Date(now + MINUTE), new Date(now + MINUTE));
    expect(cache.usage().bytes).toBe(80);

    const run = await cache.enforceCap({ offlineHashes: [], pinned: [] });
    expect(run.ok && run.value.keys).toEqual([unread]);
    expect(cache.usage()).toEqual({ bytes: 70, files: 2 });
    expect(existsSync(join(root, read))).toBe(true);
  });

  it('keeps a file its owner still uses, asking just before each delete', async () => {
    const asked: string[] = [];
    const events: string[][] = [];
    const open = derivedKey('proxy', hash('a'), 1, 'mp4');
    const other = derivedKey('proxy', hash('b'), 1, 'mp4');
    const pinned = derivedKey('conformed', hash('c'), 1, 'mp4', 'full');
    const { root, cache } = await cacheWith({
      capBytes: 50,
      release: (key) => {
        asked.push(key);
        return key !== open;
      },
      onEvicted: ({ keys }) => events.push([...keys]),
    });
    await cache.put(open, Buffer.alloc(40));
    await cache.put(other, Buffer.alloc(40));
    const run = await cache.enforceCap({ offlineHashes: [], pinned: [] });
    expect(run.ok && run.value).toMatchObject({ keys: [other], usageBytes: 40 });
    expect(asked).toEqual([open, other]);
    expect(events).toEqual([[other]]);
    expect(existsSync(join(root, open))).toBe(true);

    // Over the cap with nothing it may take: nothing goes and nothing is announced.
    await cache.put(pinned, Buffer.alloc(30));
    const kept = await cache.enforceCap({ offlineHashes: [], pinned: [pinned] });
    expect(kept.ok && kept.value).toMatchObject({ keys: [], freedBytes: 0, usageBytes: 70 });
    expect(asked).toEqual([open, other, open]);
    expect(events).toHaveLength(1);
  });

  it('lets a put land on a key while a run evicts it: the put’s file is what stays', async () => {
    const key = derivedKey('thumbnail', hash('a'), 1, 'jpg');
    let landing: Promise<unknown> | undefined;
    const { root, cache } = await cacheWith({
      capBytes: 10,
      // The owner lets the old file go; the same moment something writes the key again.
      release: () => {
        landing = cache.put(key, Buffer.alloc(8, 1));
        return true;
      },
    });
    await cache.put(key, Buffer.alloc(30));
    const run = await cache.enforceCap({ offlineHashes: [], pinned: [] });
    await landing;
    expect(run.ok && run.value.freedBytes).toBe(30);
    expect(cache.usage()).toEqual({ bytes: 8, files: 1 });
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(root, key))).toEqual(Buffer.alloc(8, 1));
  });

  it('runs one at a time, and two puts of one key each write their own part', async () => {
    const { cache } = await cacheWith({ capBytes: 50 });
    const proxy = (ch: string) => derivedKey('proxy', hash(ch), 1, 'mp4');
    const puts = await Promise.all(
      [proxy('a'), proxy('b'), proxy('c'), proxy('a')].map((key) =>
        cache.put(key, Buffer.alloc(30)).then((put) => put.ok),
      ),
    );
    expect(puts).toEqual([true, true, true, true]);
    expect(cache.usage()).toEqual({ bytes: 90, files: 3 });
    const [first, second] = await Promise.all([
      cache.enforceCap({ offlineHashes: [], pinned: [] }),
      cache.enforceCap({ offlineHashes: [], pinned: [] }),
    ]);
    expect(first.ok && first.value.keys).toHaveLength(2);
    expect(second.ok && second.value).toMatchObject({ keys: [], usageBytes: 30 });
  });

  it('says when a put leaves it over its cap', async () => {
    let over = 0;
    const { cache } = await cacheWith({ capBytes: 50, onOverCap: () => over++ });
    const first = await cache.put(derivedKey('still', hash('a'), 1, 'jpg'), Buffer.alloc(40));
    const second = await cache.put(derivedKey('still', hash('b'), 1, 'jpg'), Buffer.alloc(40));
    expect([first.ok && first.value.overCap, second.ok && second.value.overCap]).toEqual([false, true]);
    expect(over).toBe(1);
  });
});
