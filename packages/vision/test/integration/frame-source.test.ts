// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D2 end to end on a synthetic reel: the shots job's one decode leaves
 * the analysis and the OCR frames in the asset's frame cache; the analyse
 * job reads them and decodes no video in full; shots and analyses equal the
 * ones each stage gets decoding on its own (no cache). The cache entry goes
 * when its last expected consumer releases it, and when a job's source is
 * dropped mid-way (a cancelled job) nothing is left behind. With the shot
 * model (IX2-C4, a stand-in here) the same one decode feeds it and leaves the
 * same frames.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok } from '@taalcut/core';
import { createFrameCache, planNormalisation, probeMedia, type NormalisationPlan } from '@taalcut/media';
import { analyzeShots } from '../../src/analysis/analyze-shots';
import { openFrameSource } from '../../src/media/media-frame-source';
import { readShotText } from '../../src/ocr/shot-text';
import type { OcrEngine } from '../../src/ocr/types';
import { detectShots } from '../../src/shots/detect-shots';
import { pictureChangeModel } from '../../src/test-support';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('frame source');

/** An OCR engine that reads nothing and counts the frames it was shown. */
function quietOcr(seen: number[]): OcrEngine {
  return {
    capabilities: async () => ok({ scripts: ['latin'], languages: ['en'] }),
    recognize: async (frames) => {
      seen.push(...frames.map((f) => f.index));
      return ok(frames.map((f) => ({ frame: f.index, observations: [] })));
    },
  };
}

describe.skipIf(!ctx)('one decode shared by the vision stages', () => {
  let dir: string;
  let path: string;
  let plan: NormalisationPlan;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-frame-source-'));
    path = join(dir, 'reel.mp4');
    await makeReel(
      ctx!,
      path,
      [
        { source: 'testsrc2', frames: 45 },
        { source: 'smptebars', frames: 40 },
        { source: 'mandelbrot', frames: 50 },
      ],
      { width: 640, height: 360, rate: '30' },
    );
    const probed = await probeMedia(path, ctx!);
    if (!probed.ok) throw new Error(probed.error.code);
    const planned = planNormalisation(probed.value);
    if (!planned.ok) throw new Error(planned.error.code);
    plan = planned.value;
  }, 120_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('analyses from the cache what the shots job decoded, with the same results as decoding alone', async () => {
    const root = join(dir, 'cache');
    const cache = createFrameCache({ root });
    const deps = { media: ctx!, tempDir: dir, cache };
    const open = { assetId: 'asset-1', path, plan };

    const shotsSource = await openFrameSource(deps, open);
    if (!shotsSource.ok) throw new Error(shotsSource.error.code);
    shotsSource.value.expect(['vision.analyse', 'vision.ocr']);
    const shots = await detectShots(path, { media: ctx!, frames: shotsSource.value, keepOcrFrames: true });
    await shotsSource.value.close();
    expect(shots.ok).toBe(true);
    if (!shots.ok) return;
    expect(shotsSource.value.decodes()).toMatchObject({ ffprobe: 0, fullDecodes: 1, originalFullDecodes: 1 });
    expect(shots.value.cuts.map((c) => c.frame)).toEqual([45, 85]);

    const input = {
      path,
      shots: shots.value.shots.map((range, i) => ({ shotId: `s${i}`, range })),
    };
    const analyseSource = await openFrameSource(deps, open);
    if (!analyseSource.ok) throw new Error(analyseSource.error.code);
    const analysed = await analyzeShots(input, { media: ctx!, frames: analyseSource.value });
    await analyseSource.value.close();
    expect(analysed.ok).toBe(true);
    // No probe, no decode of the whole file: the pass came from the cache.
    expect(analyseSource.value.decodes()).toMatchObject({
      ffprobe: 0,
      fullDecodes: 0,
      originalFullDecodes: 0,
    });

    // vision.ocr reads the 1 fps frames the pass kept: no probe, no decode.
    const seen: number[] = [];
    const ocrSource = await openFrameSource(deps, open);
    if (!ocrSource.ok) throw new Error(ocrSource.error.code);
    const read = await readShotText(input.shots, ocrSource.value, quietOcr(seen), ['en']);
    await ocrSource.value.close();
    expect(read.ok).toBe(true);
    expect(ocrSource.value.decodes()).toMatchObject({ ffprobe: 0, fullDecodes: 0, originalFullDecodes: 0 });
    expect(seen).toEqual([0, 30, 60, 90, 120]);

    // Each stage on its own (no cache, probing, decoding): the same shots and analyses.
    const alone = await detectShots(path, { media: ctx! });
    expect(alone.ok && alone.value.cuts).toEqual(shots.value.cuts);
    const aloneAnalysed = await analyzeShots(input, { media: ctx! });
    expect(aloneAnalysed.ok && aloneAnalysed.value).toEqual(analysed.ok && analysed.value);

    // The analyse and OCR stages release the asset: its frames go when both have.
    expect(cache.usage().assets).toBe(1);
    await analyseSource.value.release('vision.analyse');
    expect(cache.usage().assets).toBe(1);
    await ocrSource.value.release('vision.ocr');
    expect(cache.usage()).toEqual({ bytes: 0, assets: 0 });
    expect(await readdir(root)).toEqual([]);
  }, 240_000);

  it('leaves the same frames when the shot model decides, from the same one decode', async () => {
    const cache = createFrameCache({ root: join(dir, 'model-cache') });
    const deps = { media: ctx!, tempDir: dir, cache };
    const open = { assetId: 'asset-m', path, plan };
    const model = pictureChangeModel();
    const shotsSource = await openFrameSource(deps, open);
    if (!shotsSource.ok) throw new Error(shotsSource.error.code);
    shotsSource.value.expect(['vision.analyse', 'vision.ocr']);
    const shots = await detectShots(path, {
      media: ctx!,
      frames: shotsSource.value,
      keepOcrFrames: true,
      boundaryModel: async () => ok(model),
    });
    await shotsSource.value.close();
    expect(shots.ok && [shots.value.detector, shots.value.cuts.map((c) => [c.frame, c.method])]).toEqual([
      'model',
      [
        [45, 'model'],
        [85, 'model'],
      ],
    ]);
    expect(model.windows).toBeGreaterThan(0);
    expect(shotsSource.value.decodes()).toMatchObject({ ffprobe: 0, fullDecodes: 1, originalFullDecodes: 1 });

    const shotIds = shots.ok ? shots.value.shots.map((range, i) => ({ shotId: `s${i}`, range })) : [];
    const analyseSource = await openFrameSource(deps, open);
    if (!analyseSource.ok) throw new Error(analyseSource.error.code);
    expect(
      (await analyzeShots({ path, shots: shotIds }, { media: ctx!, frames: analyseSource.value })).ok,
    ).toBe(true);
    await analyseSource.value.close();
    expect(analyseSource.value.decodes()).toMatchObject({ fullDecodes: 0, originalFullDecodes: 0 });
    const seen: number[] = [];
    const ocrSource = await openFrameSource(deps, open);
    if (!ocrSource.ok) throw new Error(ocrSource.error.code);
    expect((await readShotText(shotIds, ocrSource.value, quietOcr(seen), ['en'])).ok).toBe(true);
    await ocrSource.value.close();
    expect(ocrSource.value.decodes()).toMatchObject({ fullDecodes: 0, originalFullDecodes: 0 });
    expect(seen).toEqual([0, 30, 60, 90, 120]);
    await cache.drop('asset-m');
  }, 120_000);

  it('leaves nothing behind when a job is cancelled mid-pass, and a dropped asset goes at once', async () => {
    const root = join(dir, 'cancel');
    const cache = createFrameCache({ root });
    const source = await openFrameSource({ media: ctx!, tempDir: dir, cache }, { assetId: 'a', path, plan });
    if (!source.ok) throw new Error(source.error.code);
    source.value.expect(['vision.analyse']);
    const stop = new AbortController();
    const pass = source.value.pass(
      { longSide: 256, onFrame: (frame) => (frame.index === 10 ? stop.abort() : undefined) },
      stop.signal,
    );
    expect((await pass).ok).toBe(false);
    await source.value.close();
    // The producer named a consumer, so the entry waits for it; the asset's indexing ending drops it.
    await cache.drop('a');
    expect(cache.usage()).toEqual({ bytes: 0, assets: 0 });
    expect(await readdir(root)).toEqual([]);
  }, 120_000);
});
