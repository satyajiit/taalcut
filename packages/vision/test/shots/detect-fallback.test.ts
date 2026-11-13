// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4: when TransNetV2 can't decide, scdet does, logged as a `compute.fallback` for vision.shotBoundaries:
 * no model in the process, a model that isn't installed, and a model that fails on a window (then the pass the
 * model run left is read again, not decoded again). On a synthetic reel with hard cuts (FFmpeg lavfi, the
 * software encoder), without the embedder: scdet alone keeps its sharp peaks.
 *
 * "Not decoded again" is counted from the fallback on. The model's own pass may decode twice: under load
 * VideoToolbox can refuse a decode session, and media then runs the pass once more on the software route
 * (IX2-F6, logged as `compute.fallback media.decode: accelerator_failed`). That is media's retry, not the
 * fallback's, so a total of one full decode was the machine's answer, not the code's (IX3-F1).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, unwrap, type ComputeFallbackEvent } from '@taalcut/core';
import type { DecodeCount } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShotBoundaryModel } from '../../src/cuts/transnet';
import { ShotModelFailed } from '../../src/errors';
import { openFrameSource } from '../../src/media/media-frame-source';
import { detectShots, type DetectShotsDeps } from '../../src/shots/detect-shots';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('shots fallback');
const CUTS = [45, 90];

function failingModel(): ShotBoundaryModel & { readonly calls: number } {
  let calls = 0;
  return {
    id: 'transnetv2',
    backend: 'cpu',
    get calls() {
      return calls;
    },
    predict: async () => {
      calls += 1;
      return err(ShotModelFailed(undefined, { detail: 'onnx.run_failed: test' }));
    },
    release: async () => undefined,
  };
}

describe.skipIf(!ctx)('shots without TransNetV2', () => {
  let dir: string;
  let path: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-shots-fallback-'));
    path = join(dir, 'reel.mp4');
    const segments = [
      { source: 'testsrc2', frames: 45 },
      { source: 'smptebars', frames: 45 },
      { source: 'mandelbrot', frames: 45 },
    ];
    await makeReel(ctx!, path, segments, { width: 320, height: 180, rate: '30' });
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  async function run(deps: Partial<DetectShotsDeps>) {
    const fallbacks: ComputeFallbackEvent[] = [];
    const frames = unwrap(await openFrameSource({ media: ctx!, tempDir: dir }, { path }));
    // What had been decoded when scdet took over (detect-shots.ts reports the fallback, then runs scdet).
    let atFallback: DecodeCount | undefined;
    const onFallback = (event: ComputeFallbackEvent) => {
      fallbacks.push(event);
      atFallback ??= frames.decodes();
    };
    try {
      const found = unwrap(await detectShots(path, { media: ctx!, frames, onFallback, ...deps }));
      return { found, fallbacks, decodes: frames.decodes(), atFallback };
    } finally {
      await frames.close();
    }
  }

  it('decides by scdet when the process has no model, and says so', async () => {
    const { found, fallbacks } = await run({});
    expect(found.cuts.map((cut) => [cut.frame, cut.method])).toEqual(CUTS.map((frame) => [frame, 'scdet']));
    expect(fallbacks).toEqual([
      {
        operation: 'vision.shotBoundaries',
        wanted: ['coreml', 'webgpu'],
        reason: 'no_accelerator',
        detail: 'no shot-boundary model in this process; scdet and the embedding check decide',
      },
    ]);
  });

  it('decides by scdet when the component is not installed', async () => {
    const missing = ShotModelFailed(undefined, { detail: 'transnetv2 is not installed' });
    const { found, fallbacks } = await run({ boundaryModel: async () => err(missing) });
    expect(found.cuts.map((cut) => cut.frame)).toEqual(CUTS);
    expect(fallbacks).toMatchObject([
      { reason: 'no_accelerator', detail: expect.stringContaining('transnetv2 is not installed') },
    ]);
  });

  it('decides by scdet when the model fails, reading the pass it left instead of decoding again', async () => {
    const model = failingModel();
    const { found, fallbacks, decodes, atFallback } = await run({ boundaryModel: async () => ok(model) });
    expect(model.calls).toBeGreaterThan(0);
    expect(found.detector).toBe('scdet');
    expect(found.cuts.map((cut) => [cut.frame, cut.method])).toEqual(CUTS.map((frame) => [frame, 'scdet']));
    expect(fallbacks).toMatchObject([
      { reason: 'accelerator_failed', detail: expect.stringContaining('onnx.run_failed: test') },
    ]);
    // The model's run decoded the whole file (once, or twice with media's software retry)…
    expect(atFallback?.fullDecodes).toBeGreaterThanOrEqual(1);
    // …and scdet read the pass it left: no FFmpeg run of any kind after the fallback.
    expect(decodes).toEqual(atFallback);
  });
});
