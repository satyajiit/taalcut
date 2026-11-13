// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one way the thumbnail and conform operations store their file
 * (`storeDerived`): no cache or a bad content hash is `media.cache_unavailable`
 * before anything runs; a failed `make` stores nothing; a made file lands in
 * the cache under its key and its stored size reaches `describe`; the temp
 * directory is gone afterwards. No FFmpeg runs here.
 */
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { createDerivedCache, type MediaContext } from '@taalcut/media';
import { derivedKey } from '../../src/cache/layout';
import { FfmpegFailed } from '../../src/errors';
import { storeDerived, type Phase2Host } from '../../src/jobs/operate';

const HASH = 'a'.repeat(64);
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function host(withCache = true): Promise<Phase2Host> {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-store-derived-'));
  dirs.push(root);
  const ctx = {
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', source: 'dev-build' },
  } as const satisfies MediaContext;
  return {
    withContext: <T>(fn: (context: MediaContext) => AsyncResult<T>) => fn(ctx),
    ...(withCache ? { cache: createDerivedCache({ root, capBytes: 1 << 30 }) } : {}),
  };
}

const key = derivedKey('thumbnail', HASH, 1, 'jpg');
const spec = { prefix: 'taalcut-store-test-', file: 'thumb.jpg', key };

describe('storeDerived', () => {
  it('stores the made file under its key and hands its size to describe', async () => {
    const target = await host();
    let madeAt = '';
    const stored = await storeDerived(
      target,
      HASH,
      spec,
      async (_ctx, out) => {
        madeAt = out;
        await writeFile(out, Buffer.alloc(1234, 7));
        return ok({ width: 400 });
      },
      (made, bytes) => ({ ...made, bytes }),
    );
    expect(stored).toEqual(ok({ width: 400, bytes: 1234 }));
    expect(madeAt.endsWith('thumb.jpg')).toBe(true);
    // The temp directory went with the call; the cache keeps the file.
    await expect(stat(madeAt)).rejects.toThrow();
    const path = target.cache?.absPath(key);
    expect(path && (await stat(path)).size).toBe(1234);
  });

  it('returns make’s error and stores nothing', async () => {
    const target = await host();
    const failed = FfmpegFailed({ exitCode: 1 }, { detail: 'no frames' });
    const stored = await storeDerived(
      target,
      HASH,
      spec,
      async () => err(failed),
      () => 'never',
    );
    expect(stored).toEqual(err(failed));
    const path = target.cache?.absPath(key);
    await expect(stat(path ?? '')).rejects.toThrow();
  });

  it('is cache_unavailable without a cache or with a bad hash, before anything runs', async () => {
    let ran = false;
    const make = async () => {
      ran = true;
      return ok(1);
    };
    const noCache = await storeDerived(await host(false), HASH, spec, make, (n) => n);
    const badHash = await storeDerived(await host(), 'not-a-hash', spec, make, (n) => n);
    for (const result of [noCache, badHash])
      expect(!result.ok && result.error.code).toBe('media.cache_unavailable');
    expect(ran).toBe(false);
  });
});
