// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each frame embedded once (IX-E5): shot detection embeds the frames around
 * each cut it checks; `vision.embed` asking for the same grid frames gets
 * their vectors from the embedder's memo, because both decode them the same
 * way at the same size. Through the asset's frame source (IX-D1) the
 * cut-pair frames come from its cache, so only the other frames are decoded.
 * Both need the machine's index budget to be the one shot detection embeds at
 * (CALIBRATED_IMAGE_TOKENS, 280). At the shipped 140 (IX2-E1) index frames are
 * another size, so `vision.embed` embeds every frame itself (the last test).
 * Real FFmpeg, the fake model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFrameCache, planNormalisation, probeMedia } from '@taalcut/media';
import { VISION_CONFIG } from '../../src/config';
import { embedAsset } from '../../src/embed/embed-asset';
import { createEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { CALIBRATED_IMAGE_TOKENS, EMBEDDING_SPACE } from '../../src/embed/space';
import { openFrameSource } from '../../src/media/media-frame-source';
import { detectShots } from '../../src/shots/detect-shots';
import { fakeLoader } from '../helpers/fake-model';
import { makeReel, testMedia } from '../helpers/reel';
import { memoryVectorIndex } from '../helpers/vector-index';

const { ctx, skip } = await testMedia('frame reuse');

const imageSizes = (loader: ReturnType<typeof fakeLoader>) =>
  loader.calls.filter((c) => c.kind === 'images').flatMap((c) => c.inputs);
const imageInputs = (loader: ReturnType<typeof fakeLoader>) => imageSizes(loader).length;
/** A machine whose index frames are at the calibrated budget, so shot detection's vectors serve them. */
const CALIBRATED = { ...DEFAULT_EMBEDDING_PROFILE, imageTokens: CALIBRATED_IMAGE_TOKENS };

describe.skipIf(!ctx)(`cut-pair frames reused by frame vectors ${skip}`, () => {
  let dir = '';
  let path = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-reuse-'));
    path = join(dir, 'reel.mp4');
    await makeReel(
      ctx!,
      path,
      [
        { source: 'color=c=red', frames: 30 },
        // Moving content, so no two of its frames have the same pixels.
        { source: 'testsrc2', frames: 30 },
        { source: 'color=c=green', frames: 30 },
      ],
      { width: 320, height: 180, rate: '30' },
    );
  }, 120_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('runs the model only for frames shot detection did not embed', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader, profile: CALIBRATED });
    const shots = await detectShots(path, { media: ctx!, embedder });
    expect(shots.ok ? 'ok' : `${shots.error.code} ${shots.error.detail ?? ''}`).toBe('ok');
    if (!shots.ok) return;
    const measured = shots.value.cuts.filter((cut) => cut.distance !== undefined);
    expect(measured.map((cut) => cut.frame)).toEqual([30, 60]);
    const imagesBefore = imageInputs(loader);
    expect(imagesBefore).toBe(4);

    const { before, after } = VISION_CONFIG.cuts;
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const result = await embedAsset(
      {
        assetId: 'a',
        sourceId: 's',
        path,
        // Shot 2 (frames 30–59): the pair frame after its cut, and one new frame.
        frames: [{ shotId: 'b', frames: [30 + after, 45, 60 - before] }],
        texts: [],
      },
      { media: ctx!, embedder, index },
    );
    expect(result.ok && result.value.frames).toBe(3);
    const imagesAfter = imageInputs(loader);
    // Only frame 45 went to the model.
    expect(imagesAfter - imagesBefore).toBe(1);
    await embedder.close();
  }, 120_000);

  it('reads the cut-pair frames from the asset cache and decodes only the others', async () => {
    const probed = await probeMedia(path, ctx!);
    if (!probed.ok) throw new Error(probed.error.code);
    const plan = planNormalisation(probed.value);
    if (!plan.ok) throw new Error(plan.error.code);
    const cache = createFrameCache({ root: join(dir, 'cache') });
    const deps = { media: ctx!, tempDir: dir, cache };
    const open = { assetId: 'a', path, plan: plan.value };
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader, profile: CALIBRATED });

    // vision.shots: the pass and the cut pairs, kept for the stages that follow.
    const shotsSource = await openFrameSource(deps, open);
    if (!shotsSource.ok) throw new Error(shotsSource.error.code);
    shotsSource.value.expect(['vision.analyse', 'vision.embed']);
    const shots = await detectShots(path, { media: ctx!, frames: shotsSource.value, embedder });
    await shotsSource.value.close();
    expect(shots.ok && shots.value.cuts.filter((c) => c.distance !== undefined).map((c) => c.frame)).toEqual([
      30, 60,
    ]);
    const imagesBefore = imageInputs(loader);

    // vision.embed: two cut-pair frames and one new frame, read through its own source on the same cache.
    const { before, after } = VISION_CONFIG.cuts;
    const embedSource = await openFrameSource(deps, open);
    if (!embedSource.ok) throw new Error(embedSource.error.code);
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const result = await embedAsset(
      {
        assetId: 'a',
        sourceId: 's',
        path,
        frames: [{ shotId: 'b', frames: [30 + after, 45, 60 - before] }],
        texts: [],
      },
      { media: ctx!, embedder, index, frames: embedSource.value },
    );
    await embedSource.value.close();
    expect(result.ok ? result.value.frames : result.error.code).toBe(3);
    expect(imageInputs(loader) - imagesBefore).toBe(1);
    // No probe (the plan), no full decode: one seek for frame 45.
    expect(embedSource.value.decodes()).toMatchObject({
      ffprobe: 0,
      fullDecodes: 0,
      ffmpeg: 1,
      partialDecodes: 1,
    });

    // The cache entry stays until both expected stages release it.
    await embedSource.value.release('vision.embed');
    expect(cache.usage().assets).toBe(1);
    await embedSource.value.release('vision.analyse');
    expect(cache.usage().assets).toBe(0);
    await embedder.close();
  }, 120_000);

  it('embeds every frame itself at the shipped 140-token budget', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader });
    const shots = await detectShots(path, { media: ctx!, embedder });
    expect(shots.ok).toBe(true);
    const imagesBefore = imageInputs(loader);
    const { before, after } = VISION_CONFIG.cuts;
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const result = await embedAsset(
      {
        assetId: 'a',
        sourceId: 's',
        path,
        frames: [{ shotId: 'b', frames: [30 + after, 45, 60 - before] }],
        texts: [],
      },
      { media: ctx!, embedder, index },
    );
    expect(result.ok && result.value.frames).toBe(3);
    // Shot detection's frames were 280-token ones (1056×576); the index's are 140-token ones.
    expect(
      imageSizes(loader)
        .slice(0, imagesBefore)
        .every((size) => size === '1056x576'),
    ).toBe(true);
    expect(imageSizes(loader).slice(imagesBefore)).toEqual(['768x384', '768x384', '768x384']);
    await embedder.close();
  }, 120_000);
});
