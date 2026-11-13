// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync } from 'node:fs';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDerivedCache } from '../src/cache/cache';
import { derivedKey } from '../src/cache/layout';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

describe('derived cache', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes atomically, sweeps parts, throttles touch and evicts oldest first by tier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-cache-'));
    dirs.push(root);
    // The disk's mtimes count at each run (cache-scan.ts), so the clock runs from the real time.
    const start = Date.now();
    let now = start;
    const events: unknown[] = [];
    const cache = createDerivedCache({
      root,
      capBytes: 100,
      clock: { now: () => now },
      onEvicted: (payload) => events.push(payload),
    });
    const { utimes, writeFile } = await import('node:fs/promises');
    // A crash's leftover goes at the next start; a part another process is writing now stays.
    await writeFile(join(root, 'orphan.part'), 'x');
    const longAgo = new Date(start - 2 * 60 * 60 * 1000);
    await utimes(join(root, 'orphan.part'), longAgo, longAgo);
    await writeFile(join(root, 'live.part'), 'x');

    const proxy = derivedKey('proxy', HASH_A, 1, 'mp4');
    const wave = derivedKey('waveform', HASH_A, 1, 'bin');
    const thumb = derivedKey('thumbnail', HASH_A, 1, 'jpg');
    const conformed = derivedKey('conformed', HASH_B, 1, 'mp4', 'full');
    const offlineProxy = derivedKey('proxy', HASH_C, 1, 'mp4');

    const restarted = createDerivedCache({ root, capBytes: 100, clock: { now: () => now } });
    expect(restarted.usage().files).toBe(0);
    expect(existsSync(join(root, 'orphan.part'))).toBe(false);
    expect(existsSync(join(root, 'live.part'))).toBe(true);

    expect((await cache.put(proxy, Buffer.alloc(40))).ok).toBe(true);
    expect((await cache.put(wave, Buffer.alloc(30))).ok).toBe(true);
    now += 11 * 60 * 1000;
    await cache.touch(proxy);
    const proxyStat = await stat(cache.absPath(proxy) ?? '');
    expect(proxyStat.mtimeMs).toBeGreaterThan(start);
    now += 1_000;
    await cache.touch(proxy);
    const again = await stat(cache.absPath(proxy) ?? '');
    expect(again.mtimeMs).toBe(proxyStat.mtimeMs);

    expect((await cache.put(thumb, Buffer.alloc(20))).ok).toBe(true);
    expect((await cache.put(conformed, Buffer.alloc(25))).ok).toBe(true);
    expect((await cache.put(offlineProxy, Buffer.alloc(50))).ok).toBe(true);
    const eviction = await cache.enforceCap({ offlineHashes: [HASH_C], pinned: [thumb] });
    expect(eviction.ok).toBe(true);
    if (!eviction.ok) return;
    expect(eviction.value.keys[0]).toBe(conformed);
    expect(eviction.value.keys).not.toContain(thumb);
    expect(eviction.value.keys).not.toContain(offlineProxy);
    expect(eviction.value.usageBytes).toBeLessThanOrEqual(90);
    expect(events[0]).toMatchObject({ freedBytes: eviction.value.freedBytes, keys: eviction.value.keys });

    const pinned = await cache.enforceCap({ offlineHashes: [], pinned: [proxy, wave, thumb] });
    if (cache.usage().bytes > 100) expect(pinned.ok).toBe(false);
  });

  it('refuses when pins alone exceed the cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-cache-'));
    dirs.push(root);
    const cache = createDerivedCache({ root, capBytes: 10, clock: { now: () => 5 } });
    const key = derivedKey('proxy', HASH_A, 1, 'mp4');
    await cache.put(key, Buffer.alloc(40));
    const result = await cache.enforceCap({ offlineHashes: [], pinned: [key] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('media.cache_pinned_over_cap');
  });
});
