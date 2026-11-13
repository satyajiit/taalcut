// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** embedAsset: item ids and metadata, upsert-then-remove re-embedding, space checks (fake model, real FFmpeg). */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { checkSpace, embedAsset, frameItemId } from '../../src/embed/embed-asset';
import { EMBEDDING_SPACE } from '../../src/embed/space';
import { fakeLoader } from '../helpers/fake-model';
import { makeReel, testMedia } from '../helpers/reel';
import { memoryVectorIndex } from '../helpers/vector-index';

const { ctx } = await testMedia('embed asset');

describe('checkSpace', () => {
  it('refuses an index of another space', () => {
    expect(checkSpace(memoryVectorIndex(EMBEDDING_SPACE.indexName, 768)).ok).toBe(true);
    const other = checkSpace(memoryVectorIndex('eg2_q8_old', 768));
    expect(!other.ok && other.error).toMatchObject({
      code: 'vision.space_mismatch',
      params: { expected: 'eg2_q4_daa72c5/768', actual: 'eg2_q8_old/768' },
    });
    expect(checkSpace(memoryVectorIndex(EMBEDDING_SPACE.indexName, 512)).ok).toBe(false);
  });
});

describe.skipIf(!ctx)('embedAsset', () => {
  let dir: string;
  let clip: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-embed-asset-'));
    clip = join(dir, 'clip.mp4');
    await makeReel(
      ctx!,
      clip,
      [
        { source: 'color=c=red', frames: 20 },
        { source: 'color=c=blue', frames: 20 },
      ],
      { width: 320, height: 180, rate: '25' },
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes frames and texts with ids and metadata, then replaces the set on re-embedding', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader });
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const progress: number[] = [];
    const first = await embedAsset(
      {
        assetId: 'a1',
        sourceId: 's1',
        path: clip,
        frames: [
          { shotId: 'shotA', frames: [2, 10] },
          { shotId: 'shotB', frames: [30] },
        ],
        texts: [
          { itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there' },
          { itemId: 'ocr:shotA:0', kind: 'ocr', text: 'SALE' },
          { itemId: 'ocr:shotA:1', kind: 'ocr', text: '   ' },
        ],
      },
      { media: ctx!, embedder, index },
      { progress: (f) => progress.push(f) },
    );
    expect(first.ok && first.value).toEqual({ space: EMBEDDING_SPACE, frames: 3, texts: 2, removed: 0 });
    expect([...index.rows.keys()].sort()).toEqual(
      ['frame:shotA:0', 'frame:shotA:1', 'frame:shotB:0', 'ocr:shotA:0', 'transcript:a1:0'].sort(),
    );
    expect(index.rows.get(frameItemId('shotB', 0))).toMatchObject({
      assetId: 'a1',
      sourceId: 's1',
      kind: 'frame',
    });
    // The red frames and the blue frame really are different pixels.
    const red = index.rows.get('frame:shotA:0')!.vector;
    const blue = index.rows.get('frame:shotB:0')!.vector;
    expect(red[1]!).toBeGreaterThan(blue[1]!);
    expect(blue[3]!).toBeGreaterThan(red[3]!);
    // Frames go to the model at the processor's size for 320×180 and the profile's 140-token budget
    // (no resize inside transformers).
    expect(loader.calls.find((c) => c.kind === 'images')?.inputs[0]).toBe('768x384');
    expect(progress.at(-1)).toBe(1);

    // Another asset's vectors are never touched.
    index.upsert([
      { id: 'frame:other:0', vector: red, metadata: { assetId: 'a2', sourceId: 's1', kind: 'frame' } },
    ]);
    const second = await embedAsset(
      {
        assetId: 'a1',
        sourceId: 's1',
        path: clip,
        frames: [{ shotId: 'shotA', frames: [3] }],
        texts: [{ itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello again' }],
      },
      { media: ctx!, embedder, index },
    );
    expect(second.ok && second.value.removed).toBe(3);
    expect([...index.rows.keys()].sort()).toEqual(['frame:other:0', 'frame:shotA:0', 'transcript:a1:0']);

    const empty = await embedAsset(
      { assetId: 'a1', sourceId: 's1', path: clip, frames: [], texts: [] },
      { media: ctx!, embedder, index },
    );
    expect(empty.ok && empty.value.removed).toBe(2);
    expect([...index.rows.keys()]).toEqual(['frame:other:0']);
  });

  it('writes only the kinds it replaces', async () => {
    const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
    const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const texts = await embedAsset(
      {
        assetId: 'a1',
        sourceId: 's1',
        path: clip,
        frames: [{ shotId: 'shotA', frames: [2] }],
        texts: [
          { itemId: 'transcript:a1:0', kind: 'transcript', text: 'hello there' },
          { itemId: 'ocr:shotA:0', kind: 'ocr', text: 'SALE' },
        ],
        replaces: ['transcript'],
      },
      { media: ctx!, embedder, index },
    );
    expect(texts.ok && texts.value).toMatchObject({ frames: 0, texts: 1, removed: 0 });
    expect([...index.rows.keys()]).toEqual(['transcript:a1:0']);
  });

  it('stops on a space mismatch, a cancel, or a model error, without writing', async () => {
    const index = memoryVectorIndex('another_space', 768);
    const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
    const input = {
      assetId: 'a',
      sourceId: 's',
      path: clip,
      frames: [{ shotId: 'x', frames: [1] }],
      texts: [],
    };
    const mismatch = await embedAsset(input, { media: ctx!, embedder, index });
    expect(!mismatch.ok && mismatch.error.code).toBe('vision.space_mismatch');

    const good = memoryVectorIndex(EMBEDDING_SPACE.indexName, 768);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await embedAsset(
      input,
      { media: ctx!, embedder, index: good },
      { signal: controller.signal },
    );
    expect(cancelled.ok).toBe(false);
    const failing = createEmbedder({ modelDir: '/m', loader: fakeLoader({ failRun: true }) });
    const failed = await embedAsset(input, { media: ctx!, embedder: failing, index: good });
    expect(!failed.ok && failed.error.code).toBe('vision.embedding_failed');
    expect(good.count()).toBe(0);
  });
});
