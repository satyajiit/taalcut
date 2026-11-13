// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D2: the per-asset frame cache keeps decoded frames between an asset's
 * stages and deletes them when its indexing ends (every expected consumer
 * released it, the asset was dropped, or it sat idle), at process start
 * (a crashed process's leftovers) and when a bound would be passed; held
 * entries are never evicted.
 */
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { createFrameCache, indexFrameFile, type AssetFrames, type FrameCacheLimits } from '@taalcut/media';

let root: string;
let clock: { at: number; now(): number };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'taalcut-frame-cache-'));
  clock = {
    at: 1_000,
    now() {
      return this.at;
    },
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

const cache = (limits: Partial<FrameCacheLimits> = {}) => createFrameCache({ root, limits, clock });

/** A gray8 file of 4×4 frames: frame k is filled with the byte `k`. */
async function frameFile(frames: AssetFrames, set: string, indexes: readonly number[]) {
  const path = join(frames.dir, `${set}-${indexes.join('-')}.raw`);
  await writeFile(path, Buffer.concat(indexes.map((k) => Buffer.alloc(16, k))));
  const file = await indexFrameFile({ set, path, format: 'gray8', width: 4, height: 4, frames: indexes });
  if (!file.ok) throw new Error(file.error.code);
  return file.value;
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const hold = async (c: ReturnType<typeof cache>, asset: string) => unwrap(await c.open(asset));

describe('the frame cache', () => {
  it('keeps frames for the consumers the producer named and deletes them when the last one releases', async () => {
    const c = cache();
    const producer = await hold(c, 'asset-1');
    const file = await frameFile(producer.frames, 'ocr', [0, 30, 60]);
    expect(await producer.frames.adopt(file)).toBe(true);
    producer.expect(['vision.analyse', 'vision.embed']);
    await producer.close();
    expect(c.usage()).toEqual({ bytes: 48, assets: 1 });

    const consumer = await hold(c, 'asset-1');
    const read = await consumer.frames.read('ocr', [30, 60, 90]);
    expect(read.ok && [...read.value.entries()].map(([k, data]) => [k, data[0]])).toEqual([
      [30, 30],
      [60, 60],
    ]);
    await consumer.close();
    await c.release('asset-1', 'vision.analyse');
    expect(await exists(producer.frames.dir)).toBe(true);
    await c.release('asset-1', 'vision.embed');
    expect(await exists(producer.frames.dir)).toBe(false);
    expect(c.usage()).toEqual({ bytes: 0, assets: 0 });
  });

  it('deletes an entry nobody is expected to read as soon as its holder closes', async () => {
    const c = cache();
    const h = await hold(c, 'a');
    await h.frames.adopt(await frameFile(h.frames, 'x', [1]));
    await h.close();
    await h.close();
    expect(await exists(h.frames.dir)).toBe(false);
    expect(c.usage().assets).toBe(0);
  });

  it('drops an asset whose indexing ended, once its last holder closes', async () => {
    const c = cache();
    const first = await hold(c, 'a');
    const second = await hold(c, 'a');
    expect(second.frames).toBe(first.frames);
    first.expect(['later']);
    await c.drop('a');
    await first.close();
    expect(await exists(first.frames.dir)).toBe(true);
    await second.close();
    expect(await exists(first.frames.dir)).toBe(false);
    // A new entry for the same asset gets a fresh folder.
    const again = await hold(c, 'a');
    expect(again.frames.dir).not.toBe(first.frames.dir);
    await again.close();
  });

  it('refuses a file past the asset bound and deletes it', async () => {
    const c = cache({ assetBytes: 40 });
    const h = await hold(c, 'a');
    expect(await h.frames.adopt(await frameFile(h.frames, 'x', [0, 1]))).toBe(true);
    const big = await frameFile(h.frames, 'y', [2, 3]);
    expect(await h.frames.adopt(big)).toBe(false);
    expect(await exists(big.path)).toBe(false);
    expect(h.frames.find('y', [2, 3]).size).toBe(0);
    expect(c.usage().bytes).toBe(32);
    await h.close();
  });

  it('makes room past the total bound by evicting the least recently used assets nobody holds', async () => {
    const c = cache({ totalBytes: 48 });
    const old = await hold(c, 'old');
    await old.frames.adopt(await frameFile(old.frames, 'x', [0]));
    old.expect(['reader']);
    await old.close();
    clock.at += 10;
    const held = await hold(c, 'held');
    await held.frames.adopt(await frameFile(held.frames, 'x', [0]));
    clock.at += 10;
    const recent = await hold(c, 'recent');
    await recent.frames.adopt(await frameFile(recent.frames, 'x', [0]));
    recent.expect(['reader']);
    await recent.close();

    const next = await hold(c, 'next');
    expect(await next.frames.adopt(await frameFile(next.frames, 'x', [0]))).toBe(true);
    expect(await exists(old.frames.dir)).toBe(false);
    expect(await exists(recent.frames.dir)).toBe(true);
    // Only held entries are left to make room with: a further file is refused.
    expect(await next.frames.adopt(await frameFile(next.frames, 'y', [1, 2]))).toBe(false);
    expect(await exists(held.frames.dir)).toBe(true);
    expect(c.usage()).toEqual({ bytes: 48, assets: 3 });
    await held.close();
    await next.close();
  });

  it('sweeps entries nobody held for the idle time', async () => {
    const c = cache({ idleMs: 1_000 });
    const idle = await hold(c, 'idle');
    idle.expect(['never']);
    await idle.close();
    const busy = await hold(c, 'busy');
    clock.at += 1_000;
    expect(await c.sweepIdle()).toEqual(['idle']);
    expect(await exists(idle.frames.dir)).toBe(false);
    expect(await exists(busy.frames.dir)).toBe(true);
    await busy.close();
  });

  it('clears what a crashed process left at start', async () => {
    await mkdir(join(root, 'leftover-entry'), { recursive: true });
    await writeFile(join(root, 'leftover-entry', 'frames.raw'), Buffer.alloc(64));
    const c = cache();
    await c.clear();
    expect(await readdir(root)).toEqual([]);
    await createFrameCache({ root: join(root, 'missing') }).clear();
  });

  it('keeps small documents within the bound and frees what a smaller rewrite gives back', async () => {
    const c = cache({ assetBytes: 64 });
    const h = await hold(c, 'a');
    expect(await h.frames.putDoc('analysis', { cuts: [1, 2, 3] })).toEqual({ ok: true, value: true });
    expect(await h.frames.getDoc('analysis')).toEqual({ ok: true, value: { cuts: [1, 2, 3] } });
    const before = c.usage().bytes;
    expect(await h.frames.putDoc('analysis', {})).toEqual({ ok: true, value: true });
    expect(c.usage().bytes).toBe(before - (JSON.stringify({ cuts: [1, 2, 3] }).length - 2));
    expect(await h.frames.putDoc('big', { text: 'x'.repeat(80) })).toEqual({ ok: true, value: false });
    expect(await h.frames.getDoc('big')).toEqual({ ok: true, value: undefined });
    const bad = await h.frames.putDoc('../escape', {});
    expect(bad.ok).toBe(false);
    await h.close();
  });
});
