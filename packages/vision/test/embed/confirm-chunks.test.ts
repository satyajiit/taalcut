// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shot confirmation's frame vectors (IX-F3): with a frame source, frames are read and embedded a chunk at a time, so a
 * clip with hundreds of cut candidates never holds all their RGB at once. The vectors are the same as one read's.
 */
import type { MediaContext } from '@taalcut/media';
import { afterAll, describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { frameVectors } from '../../src/shots/confirm';
import { fakeFrameSource } from '../helpers/fake-frame-source';
import { fakeLoader } from '../helpers/fake-model';

const media = {} as MediaContext;

describe('frameVectors', () => {
  const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader() });
  afterAll(() => embedder.close());

  it('reads and embeds at most 48 frames at a time from a frame source', async () => {
    const source = fakeFrameSource({ frames: 300, pixel: (frame, i) => (frame * 7 + i) % 251 });
    const frames = Array.from({ length: 120 }, (_, i) => i * 2);
    const vectors = await frameVectors(frames, source.video, { media, embedder, frames: source }, undefined);
    expect(vectors.ok).toBe(true);
    if (!vectors.ok) return;
    expect(source.requests.map((request) => request.frames.length)).toEqual([48, 48, 24]);
    expect([...vectors.value.keys()]).toEqual(frames);

    const alone = await frameVectors(
      [frames[100]!],
      source.video,
      { media, embedder, frames: source },
      undefined,
    );
    expect(alone.ok && alone.value.get(frames[100]!)).toEqual(vectors.value.get(frames[100]!));
  });

  it('asks for nothing when there is nothing to embed', async () => {
    const source = fakeFrameSource();
    const vectors = await frameVectors([], source.video, { media, embedder, frames: source }, undefined);
    expect(vectors.ok && vectors.value.size).toBe(0);
    expect(source.requests).toEqual([]);
  });
});
