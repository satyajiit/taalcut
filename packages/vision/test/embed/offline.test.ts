// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L9 "Done when": a network-disabled test indexes and searches with no
 * outbound traffic. A synthetic library (FFmpeg lavfi clips: a sunset-orange
 * gradient, a deep-blue one, a test pattern) and transcript lines are indexed
 * with every network path made to throw, then searched in text. Live with the
 * real EmbeddingGemma 2 weights when the component folder is present; the
 * plumbing runs with a fake model either way.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmbedder, type VisionEmbedder } from '../../src/embed/embedder';
import { embedAsset } from '../../src/embed/embed-asset';
import { EMBEDDING_SPACE } from '../../src/embed/space';
import { fakeLoader } from '../helpers/fake-model';
import { blockNetwork, componentDir, type NetworkGuard } from '../helpers/offline';
import { makeReel, testMedia } from '../helpers/reel';
import { memoryVectorIndex } from '../helpers/vector-index';

const { ctx } = await testMedia('embed offline');
const liveDir = componentDir('embeddinggemma-2', 'onnx/model_q4.onnx_data');

const CLIPS = [
  { assetId: 'sunset', source: 'gradients=c0=0xff8c1a:c1=0xc2185b:x0=0:y0=0:x1=0:y1=360:speed=0' },
  { assetId: 'ocean', source: 'gradients=c0=0x0d47a1:c1=0x002060:x0=0:y0=0:x1=0:y1=360:speed=0' },
  { assetId: 'pattern', source: 'testsrc2' },
] as const;

const TEXTS = [
  { assetId: 'sunset', text: 'we walked along the beach while the sun went down' },
  { assetId: 'ocean', text: 'quarterly budget review meeting starts at nine' },
];

async function indexLibrary(media: MediaContext, embedder: VisionEmbedder, dir: string) {
  const index = memoryVectorIndex(EMBEDDING_SPACE.indexName, EMBEDDING_SPACE.dimensions);
  for (const clip of CLIPS) {
    const path = join(dir, `${clip.assetId}.mp4`);
    const text = TEXTS.find((item) => item.assetId === clip.assetId);
    const result = await embedAsset(
      {
        assetId: clip.assetId,
        sourceId: 'source-1',
        path,
        frames: [{ shotId: `${clip.assetId}-shot`, frames: [5, 20] }],
        texts: text ? [{ itemId: `transcript:${clip.assetId}:0`, kind: 'transcript', text: text.text }] : [],
      },
      { media, embedder, index },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }
  return index;
}

describe.skipIf(!ctx)('embedding and search with the network disabled', () => {
  let dir: string;
  let guard: NetworkGuard | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-embed-'));
    for (const clip of CLIPS) {
      await makeReel(ctx!, join(dir, `${clip.assetId}.mp4`), [{ source: clip.source, frames: 30 }], {
        width: 640,
        height: 360,
        rate: '30',
      });
    }
  });

  afterAll(async () => {
    guard?.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it('indexes frames and text and searches them (fake model), with no outbound attempt', async () => {
    guard = blockNetwork();
    try {
      const embedder = createEmbedder({ modelDir: '/models/eg2', loader: fakeLoader() });
      const index = await indexLibrary(ctx!, embedder, dir);
      expect(index.count()).toBe(CLIPS.length * 2 + TEXTS.length);
      const query = await embedder.embedTexts(['budget meeting'], { purpose: 'query' });
      expect(query.ok).toBe(true);
      const hits = index.search(query.ok ? query.value[0]! : [], { k: 1, filter: { kind: 'transcript' } });
      expect(hits.ok && hits.value[0]?.id).toBe('transcript:ocean:0');
      expect(guard.attempts).toEqual([]);
    } finally {
      guard.restore();
      guard = undefined;
    }
  });

  it.skipIf(!liveDir)(
    'runs EmbeddingGemma 2 on this Mac: sunset text finds the orange frames, nothing leaves',
    async () => {
      guard = blockNetwork();
      const fallbacks: unknown[] = [];
      const embedder = createEmbedder({ modelDir: liveDir!, onFallback: (event) => fallbacks.push(event) });
      try {
        const index = await indexLibrary(ctx!, embedder, dir);
        expect(embedder.device()).toBe('webgpu');
        expect(fallbacks).toEqual([]);
        const query = await embedder.embedTexts(['a beach at sunset'], { purpose: 'query' });
        expect(query.ok).toBe(true);
        const frames = index.search(query.ok ? query.value[0]! : [], { k: 6, filter: { kind: 'frame' } });
        expect(frames.ok).toBe(true);
        const order = frames.ok ? frames.value.map((match) => match.metadata.assetId) : [];
        // Both sunset frames rank above every ocean frame.
        expect(order.slice(0, 2)).toEqual(['sunset', 'sunset']);
        expect(order.indexOf('ocean')).toBeGreaterThan(1);
        const texts = index.search(query.ok ? query.value[0]! : [], { k: 2, filter: { kind: 'transcript' } });
        expect(texts.ok && texts.value[0]?.id).toBe('transcript:sunset:0');
        expect(guard.attempts).toEqual([]);
        console.warn(
          `[vision] live search "a beach at sunset": ${frames.ok ? frames.value.map((m) => `${m.id} ${m.distance.toFixed(4)}`).join(', ') : ''}`,
        );
      } finally {
        guard.restore();
        guard = undefined;
        await embedder.close();
      }
    },
    180_000,
  );
});
