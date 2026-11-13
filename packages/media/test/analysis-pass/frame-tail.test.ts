// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C3: a raw frame file read while it is written. Frames come in order and whole, at the reader's pace
 * (a batch waits for the one before to settle), the file may appear late, a torn last frame is not handed
 * over, and stop() ends the reading early.
 */
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tailFrames, type FrameBatch } from '../../src/analysis-pass/frame-tail';

const FRAME = 6;
const frame = (n: number) => Buffer.alloc(FRAME, n % 256);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-tail-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function collector(delayMs = 0) {
  const batches: FrameBatch[] = [];
  let busy = 0;
  let overlapped = false;
  return {
    batches,
    overlapped: () => overlapped,
    onFrames: async (batch: FrameBatch) => {
      busy += 1;
      if (busy > 1) overlapped = true;
      batches.push(batch);
      if (delayMs > 0) await wait(delayMs);
      busy -= 1;
    },
  };
}

describe('tailFrames', () => {
  it('hands over every frame in order while the file grows, one batch at a time', async () => {
    const path = join(dir, 'stream.rgb');
    const seen = collector(3);
    const tail = tailFrames(path, {
      bytesPerFrame: FRAME,
      batchFrames: 4,
      pollMs: 2,
      onFrames: seen.onFrames,
    });
    await wait(10);
    for (let n = 0; n < 30; n++) {
      await appendFile(path, frame(n));
      if (n % 7 === 0) await wait(4);
    }
    const done = await tail.finish();
    expect(done).toEqual({ ok: true, value: 30 });
    expect(seen.overlapped()).toBe(false);
    expect(seen.batches.every((b) => b.count <= 4 && b.data.length === b.count * FRAME)).toBe(true);
    const bytes = Buffer.concat(seen.batches.map((b) => b.data));
    expect(bytes.equals(Buffer.concat(Array.from({ length: 30 }, (_, n) => frame(n))))).toBe(true);
    expect(seen.batches.map((b) => b.first)).toEqual(
      seen.batches.reduce<number[]>(
        (firsts, b, i) => [...firsts, i === 0 ? 0 : firsts[i - 1]! + seen.batches[i - 1]!.count],
        [],
      ),
    );
  });

  it('leaves a torn last frame and reads a file written before it started', async () => {
    const path = join(dir, 'stream.rgb');
    await writeFile(path, Buffer.concat([frame(1), frame(2), Buffer.alloc(3)]));
    const seen = collector();
    const tail = tailFrames(path, {
      bytesPerFrame: FRAME,
      batchFrames: 50,
      pollMs: 2,
      onFrames: seen.onFrames,
    });
    expect(await tail.finish()).toEqual({ ok: true, value: 2 });
    expect(seen.batches).toHaveLength(1);
  });

  it('finishes with nothing when the writer never made the file', async () => {
    const seen = collector();
    const tail = tailFrames(join(dir, 'never.rgb'), {
      bytesPerFrame: FRAME,
      batchFrames: 50,
      pollMs: 2,
      onFrames: seen.onFrames,
    });
    await wait(10);
    expect(await tail.finish()).toEqual({ ok: true, value: 0 });
    expect(seen.batches).toEqual([]);
  });

  it('stops early when asked or cancelled', async () => {
    const path = join(dir, 'stream.rgb');
    await writeFile(path, Buffer.concat(Array.from({ length: 20 }, (_, n) => frame(n))));
    const seen = collector(20);
    const tail = tailFrames(path, {
      bytesPerFrame: FRAME,
      batchFrames: 2,
      pollMs: 2,
      onFrames: seen.onFrames,
    });
    await wait(5);
    await tail.stop();
    expect(seen.batches.length).toBeLessThan(10);

    const controller = new AbortController();
    controller.abort();
    const cancelled = collector();
    const never = tailFrames(path, {
      bytesPerFrame: FRAME,
      batchFrames: 2,
      pollMs: 2,
      onFrames: cancelled.onFrames,
      signal: controller.signal,
    });
    expect(await never.finish()).toEqual({ ok: true, value: 0 });
  });

  it('ends with media.decode_failed when the caller’s reading throws', async () => {
    const path = join(dir, 'stream.rgb');
    await writeFile(path, frame(1));
    const tail = tailFrames(path, {
      bytesPerFrame: FRAME,
      batchFrames: 2,
      pollMs: 2,
      onFrames: () => Promise.reject(new Error('model gone')),
    });
    const done = await tail.finish();
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.error.code).toBe('media.decode_failed');
      expect(done.error.detail).toContain('model gone');
    }
  });
});
