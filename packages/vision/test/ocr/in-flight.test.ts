// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import type { JsonLineSidecar, JsonValue } from '@taalcut/media';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { inFlight } from '../../src/ocr/in-flight';
import { frame } from './helpers/fakes';

/**
 * A helper that holds each reply until `target` requests are open at once (or every request has started, or a
 * second has passed), recording how many overlap: overlap is then the engine's doing, not the machine's speed.
 */
function slowSidecar(target: number, total: number): JsonLineSidecar & { most: number; requests: number } {
  let open = 0;
  let waiting: (() => void)[] = [];
  const release = () => {
    for (const go of waiting) go();
    waiting = [];
  };
  const state = {
    most: 0,
    requests: 0,
    async ready(): AsyncResult<JsonValue> {
      return ok({ type: 'ready', ocr: { languages: ['en-US'] } });
    },
    async request(_method: string, body: JsonValue): AsyncResult<JsonValue> {
      state.requests++;
      open++;
      state.most = Math.max(state.most, open);
      const held = new Promise<void>((resolve) => {
        waiting.push(resolve);
        setTimeout(resolve, 1000);
      });
      if (open >= target || state.requests === total) release();
      await held;
      open--;
      const paths = (body as { paths: string[] }).paths;
      return ok({ images: paths.map((path) => ({ path, observations: [] })) });
    },
    async close() {},
  };
  return state;
}

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'taalcut-ocr-flight-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('requests in flight', () => {
  it('sends a long call as requests of at most 16, at most `inFlight` at once, pages in frame order', async () => {
    // 40 frames: three requests (14, 13, 13) one or three at a time; four of 10 two at a time (requests.ts).
    for (const [limit, requests] of [
      [1, 3],
      [2, 4],
      [3, 3],
    ] as const) {
      const sidecar = slowSidecar(limit, requests);
      const engine = createAppleVisionOcr(sidecar, { tempDir: temp, inFlight: limit });
      const frames = Array.from({ length: 40 }, (_, i) => frame(i * 30));
      const pages = await engine.recognize(frames, { languages: ['en'] });
      expect(pages.ok && pages.value.map((p) => p.frame)).toEqual(frames.map((f) => f.index));
      expect(sidecar.requests).toBe(requests);
      expect(sidecar.most).toBe(limit);
    }
  });

  it('keeps two requests in flight by default', async () => {
    const sidecar = slowSidecar(3, 4);
    const engine = createAppleVisionOcr(sidecar, { tempDir: temp });
    const frames = Array.from({ length: 40 }, (_, i) => frame(i * 30));
    const pages = await engine.recognize(frames, { languages: ['en'] });
    expect(pages.ok && pages.value.map((p) => p.frame)).toEqual(frames.map((f) => f.index));
    expect(sidecar.most).toBe(2);
  });

  it('stops starting jobs after a failure and returns it', async () => {
    const started: number[] = [];
    const result = await inFlight(6, 2, async (n) => {
      started.push(n);
      return n === 1 ? err(OcrFailed()) : ok(n);
    });
    expect(!result.ok && result.error.code).toBe('vision.ocr_failed');
    expect(started.length).toBeLessThan(6);
    expect(await inFlight(0, 2, async () => ok(1))).toEqual(ok([]));
  });
});
