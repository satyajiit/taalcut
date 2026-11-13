// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A library indexed before the split (IX-E1) keeps working: its vectors were
 * written by one `vision.embedAsset` job that owned every kind. The re-run
 * `vision.embed` replaces only frames and on-screen text, `vision.embedText`
 * only the transcript, descriptions survive both, and a search finds the
 * asset at every step. A job queued before the split (no `replaces`) runs
 * after the new stages and writes frames only: their vectors stay (IX-F3).
 * Real FFmpeg, the fake model.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDirectJobRunner, EMBEDDING_ITEM_KINDS } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { EMBEDDING_SPACE } from '../../src/embed/space';
import { visionEmbedAssetJob, visionEmbedTextsJob } from '../../src/jobs/index-kinds';
import { createVisionJobs } from '../../src/jobs/vision-jobs';
import { fakeLoader } from '../helpers/fake-model';
import { makeReel, testMedia } from '../helpers/reel';
import { memoryVectorIndex, topHit } from '../helpers/vector-index';

const { ctx, skip } = await testMedia('split library');

describe.skipIf(!ctx)(`vectors from before the split ${skip}`, () => {
  let dir = '';
  let path = '';
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
  const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
  const runner = () =>
    createDirectJobRunner(
      createVisionJobs({ media: ctx!, tier: 'recommended', tempDir: dir, embedder, index }),
    );
  const ids = () => [...index.rows.keys()].filter((id) => !id.startsWith('frame:other')).sort();

  const hit = (query: string) => topHit(embedder, index, query, 'a1');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-split-'));
    path = join(dir, 'clip.mp4');
    await makeReel(
      ctx!,
      path,
      [
        { source: 'color=c=red', frames: 20 },
        { source: 'color=c=blue', frames: 20 },
      ],
      { width: 320, height: 180, rate: '25' },
    );
  }, 120_000);
  afterAll(async () => {
    await embedder.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('replaces each kind only from its own stage, and search keeps finding the asset', async () => {
    const jobs = runner();
    // Another asset's vectors are never touched.
    index.upsert([
      {
        id: 'frame:other:0',
        vector: new Float32Array(768).fill(0.1),
        metadata: { assetId: 'a2', kind: 'frame' },
      },
    ]);
    // The library before the split: one job wrote every kind.
    const before = await jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      frames: [
        { shotId: 'shotA', frames: [2, 10] },
        { shotId: 'shotB', frames: [30] },
      ],
      texts: [
        { itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there friends' },
        { itemId: 'transcript:a1:1', kind: 'transcript', text: 'goodbye now' },
        { itemId: 'ocr:shotA:0', kind: 'ocr', text: 'SALE' },
        { itemId: 'description:shotA', kind: 'description', text: 'a red wall' },
      ],
      replaces: [...EMBEDDING_ITEM_KINDS],
    });
    expect(before.ok && before.value).toMatchObject({ frames: 3, texts: 4, removed: 0 });
    expect(await hit('hello there friends')).toBe('transcript:a1:0');

    // vision.embed after the bump: fewer frames, no on-screen text any more; the rest stays.
    const frames = await jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      frames: [{ shotId: 'shotA', frames: [4] }],
      texts: [],
      replaces: ['frame', 'ocr'],
    });
    expect(frames.ok && frames.value).toMatchObject({ frames: 1, texts: 0, removed: 3 });
    expect(ids()).toEqual(['description:shotA', 'frame:shotA:0', 'transcript:a1:0', 'transcript:a1:1']);
    expect(await hit('hello there friends')).toBe('transcript:a1:0');
    expect(await hit('a red wall')).toBe('description:shotA');

    // vision.embedText: the new transcript has one segment; frames and the description stay.
    const texts = await jobs.run(visionEmbedTextsJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      texts: [{ itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there friends' }],
      replaces: ['transcript'],
    });
    expect(texts.ok && texts.value).toEqual({ space: EMBEDDING_SPACE, texts: 1, removed: 1 });
    expect(ids()).toEqual(['description:shotA', 'frame:shotA:0', 'transcript:a1:0']);
    expect(await hit('hello there friends')).toBe('transcript:a1:0');

    // An empty transcript clears only transcript vectors.
    const cleared = await jobs.run(visionEmbedTextsJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      texts: [],
      replaces: ['transcript'],
    });
    expect(cleared.ok && cleared.value.removed).toBe(1);
    expect(ids()).toEqual(['description:shotA', 'frame:shotA:0']);
    expect(index.rows.has('frame:other:0')).toBe(true);
  }, 120_000);

  it('a job queued before the split, run after the new stages, writes frames only (IX-F3)', async () => {
    const jobs = runner();
    // The new stages ran first: the transcript, on-screen text and description vectors are theirs.
    const texts = await jobs.run(visionEmbedTextsJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      texts: [
        { itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there friends' },
        { itemId: 'ocr:shotA:0', kind: 'ocr', text: 'SALE' },
        { itemId: 'description:shotA', kind: 'description', text: 'a red wall' },
      ],
      replaces: ['transcript', 'ocr', 'description'],
    });
    expect(texts.ok).toBe(true);
    const stored = index.rows.get('transcript:a1:0')?.vector;
    // Then the old job, with its snapshot from before (another transcript, no on-screen text).
    const old = await jobs.run(visionEmbedAssetJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      frames: [{ shotId: 'shotB', frames: [30] }],
      texts: [{ itemId: 'transcript:a1:0', kind: 'transcript', text: 'something said long ago' }],
    });
    expect(old.ok && old.value).toMatchObject({ frames: 1, texts: 0 });
    expect(ids()).toEqual(['description:shotA', 'frame:shotB:0', 'ocr:shotA:0', 'transcript:a1:0']);
    expect(index.rows.get('transcript:a1:0')?.vector).toEqual(stored);
    expect(await hit('hello there friends')).toBe('transcript:a1:0');
  });

  it('says why text embedding cannot run without an embedder', async () => {
    const jobs = createDirectJobRunner(createVisionJobs({ media: ctx!, tier: 'minimum', tempDir: dir }));
    const result = await jobs.run(visionEmbedTextsJob, {
      assetId: 'a1',
      sourceId: 's1',
      path,
      texts: [],
      replaces: ['transcript'],
    });
    expect(!result.ok && result.error.code).toBe('vision.embedder_unavailable');
  });
});
