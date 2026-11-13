// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The embedder with a fake model: devices, fallbacks, prefixes, batches, order, priority, errors. */
import { describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import {
  cosineDistance,
  embeddingFrameSize,
  EMBEDDING_SPACE,
  imageTokens,
  meanDistance,
  prefixed,
  unitVector,
} from '../../src/embed/space';
import { fakeLoader } from '../helpers/fake-model';

const image = (r: number, g: number, b: number) => {
  const rgb = new Uint8Array(48 * 48 * 3);
  for (let i = 0; i < 48 * 48; i++) rgb.set([r, g, b], i * 3);
  return { width: 48, height: 48, rgb };
};

const norm = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('createEmbedder', () => {
  it('loads on WebGPU first and reports the space', async () => {
    const loader = fakeLoader();
    const fallbacks: unknown[] = [];
    const embedder = createEmbedder({ modelDir: '/m', loader, onFallback: (e) => fallbacks.push(e) });
    expect(embedder.space).toEqual(EMBEDDING_SPACE);
    expect(embedder.device()).toBeNull();
    const result = await embedder.embedTexts(['hello'], { purpose: 'query' });
    expect(result.ok).toBe(true);
    expect(loader.loads).toEqual(['webgpu:/m']);
    expect(embedder.device()).toBe('webgpu');
    expect(fallbacks).toEqual([]);
  });

  it('falls back to the CPU only when the WebGPU session fails, and logs why', async () => {
    const loader = fakeLoader({ failOn: ['webgpu'] });
    const fallbacks: { operation: string; reason: string; wanted: string[]; detail?: string }[] = [];
    const embedder = createEmbedder({ modelDir: '/m', loader, onFallback: (e) => fallbacks.push(e) });
    expect((await embedder.embedImages([image(1, 2, 3)])).ok).toBe(true);
    expect(loader.loads).toEqual(['webgpu:/m', 'cpu:/m']);
    expect(embedder.device()).toBe('cpu');
    expect(fallbacks).toEqual([
      {
        operation: 'vision.embed',
        wanted: ['webgpu'],
        reason: 'accelerator_failed',
        detail: 'webgpu: webgpu session failed',
      },
    ]);
  });

  it('logs a disabled GPU as the reason, and never tries Core ML', async () => {
    const loader = fakeLoader();
    const fallbacks: { reason: string }[] = [];
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      disableGpu: true,
      onFallback: (e) => fallbacks.push(e),
    });
    await embedder.embedTexts(['x'], { purpose: 'document' });
    expect(loader.loads).toEqual(['cpu:/m']);
    expect(fallbacks.map((e) => e.reason)).toEqual(['disabled']);
    expect(loader.loads.some((load) => load.startsWith('coreml'))).toBe(false);
  });

  it('is unavailable without the component, and loads once it is installed', async () => {
    let dir: string | null = null;
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: async () => dir, loader });
    const missing = await embedder.embedTexts(['x'], { purpose: 'query' });
    expect(!missing.ok && missing.error.code).toBe('vision.embedder_unavailable');
    dir = '/installed';
    expect((await embedder.embedTexts(['x'], { purpose: 'query' })).ok).toBe(true);
    expect(loader.loads).toEqual(['webgpu:/installed']);
  });

  it('is unavailable when neither device loads', async () => {
    const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader({ failOn: ['webgpu', 'cpu'] }) });
    const result = await embedder.embedTexts(['x'], { purpose: 'query' });
    expect(!result.ok && result.error.code).toBe('vision.embedder_unavailable');
  });

  it('adds the model card prefixes: query and document text, none for frames', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader });
    await embedder.embedTexts(['red car'], { purpose: 'query' });
    await embedder.embedTexts(['red car'], { purpose: 'document' });
    expect(loader.calls.map((c) => c.inputs[0])).toEqual([
      'task: search result | query: red car',
      'title: none | text: red car',
    ]);
    expect(prefixed('a', 'query')).toBe('task: search result | query: a');
  });

  it('fills frame calls to the token budget, batches texts by 16, keeps order and returns unit vectors', async () => {
    const loader = fakeLoader();
    // 48×48 frames are one soft token each: a 4-token budget takes 4 per call.
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, batchTokens: 4 },
    });
    const frames = Array.from({ length: 9 }, (_, i) => image(i * 20, 0, 0));
    const vectors = await embedder.embedImages(frames);
    expect(vectors.ok && vectors.value.length).toBe(9);
    expect(loader.calls.map((c) => c.inputs.length)).toEqual([4, 4, 1]);
    if (vectors.ok) {
      for (const v of vectors.value) expect(norm(v)).toBeCloseTo(1, 5);
      // Brighter red frames come later: order is preserved.
      expect(vectors.value[8]![1]!).toBeGreaterThan(vectors.value[1]![1]!);
    }
    const texts = await embedder.embedTexts(
      Array.from({ length: 20 }, (_, i) => `t${i}`),
      { purpose: 'document' },
    );
    expect(texts.ok && texts.value.length).toBe(20);
    expect(loader.calls.slice(3).map((c) => c.inputs.length)).toEqual([16, 4]);
  });

  it('shares a call between callers instead of sending a half-empty one', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, batchTokens: 4 },
    });
    const [a, b] = await Promise.all([
      embedder.embedImages([image(10, 0, 0), image(20, 0, 0), image(30, 0, 0)]),
      embedder.embedImages([image(40, 0, 0), image(50, 0, 0), image(60, 0, 0)]),
    ]);
    expect(loader.calls.map((c) => c.inputs.length)).toEqual([4, 2]);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.value[0]![1]!).toBeGreaterThan(a.value[2]![1]!);
  });

  it('embeds a frame it embedded lately only once', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader });
    const first = await embedder.embedImages([image(1, 2, 3), image(4, 5, 6)]);
    const again = await embedder.embedImages([image(4, 5, 6), image(7, 8, 9), image(1, 2, 3)]);
    expect(loader.calls.map((c) => c.inputs.length)).toEqual([2, 1]);
    expect(first.ok && again.ok).toBe(true);
    if (first.ok && again.ok) {
      expect(Array.from(again.value[0]!)).toEqual(Array.from(first.value[1]!));
      expect(Array.from(again.value[2]!)).toEqual(Array.from(first.value[0]!));
    }
    await embedder.close();
    await embedder.embedImages([image(1, 2, 3)]);
    expect(loader.calls).toHaveLength(3);
  });

  it('sizes index frames at the profile’s token budget and calibrated frames at 280', async () => {
    const loader = fakeLoader();
    const small = createEmbedder({
      modelDir: '/m',
      loader,
      profile: async () => ({ ...DEFAULT_EMBEDDING_PROFILE, imageTokens: 140 }),
    });
    expect(await small.frameSize(1920, 1080, 'index')).toEqual({ width: 768, height: 384 });
    expect(await small.indexImageTokens()).toBe(140);
    // Distance thresholds were fitted at 280: frames compared against them stay there.
    expect(await small.frameSize(1920, 1080)).toEqual({ width: 1056, height: 576 });
    expect(await small.frameSize(1920, 1080, 'calibrated')).toEqual({ width: 1056, height: 576 });
    // The budget travels with each call's frames, not with the load.
    await small.embedTexts(['x'], { purpose: 'query' });
    expect(loader.options.at(-1)).toEqual({});
    // A profile that can't be read falls back to the default, never to nothing.
    const broken = createEmbedder({
      modelDir: '/m',
      loader,
      profile: async () => Promise.reject(new Error('no probe')),
    });
    expect(await broken.indexImageTokens()).toBe(DEFAULT_EMBEDDING_PROFILE.imageTokens);
  });

  it('warms up off the critical path: loads and runs one frame, and says when the profile wants it', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, warmOnImport: true },
    });
    expect(await embedder.warmsOnImport()).toBe(true);
    await Promise.all([embedder.warm(), embedder.warm()]);
    await embedder.warm();
    expect(embedder.device()).toBe('webgpu');
    // At the index budget (140 tokens: 768×384 for 16:9).
    expect(loader.calls).toEqual([{ device: 'webgpu', kind: 'images', inputs: ['768x384'] }]);
    expect(await createEmbedder({ modelDir: '/m', loader }).warmsOnImport()).toBe(false);
    // Without the component there is nothing to warm, and no error.
    await createEmbedder({ modelDir: async () => null, loader }).warm();
  });

  it('serves a query between indexing batches instead of after them', async () => {
    const loader = fakeLoader({ delayMs: 5 });
    const embedder = createEmbedder({ modelDir: '/m', loader });
    const indexing = embedder.embedImages(Array.from({ length: 16 }, () => image(9, 9, 9)));
    await new Promise((resolve) => setTimeout(resolve, 1));
    const query = embedder.embedTexts(['find me'], { purpose: 'query' });
    await Promise.all([indexing, query]);
    const position = loader.calls.findIndex((c) => c.kind === 'texts');
    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThan(4);
  });

  it('maps model failures and short answers to vision.embedding_failed (retryable)', async () => {
    const failing = createEmbedder({ modelDir: '/m', loader: fakeLoader({ failRun: true }) });
    const failed = await failing.embedTexts(['x'], { purpose: 'query' });
    expect(!failed.ok && [failed.error.code, failed.error.retryable]).toEqual([
      'vision.embedding_failed',
      true,
    ]);
    const short = createEmbedder({ modelDir: '/m', loader: fakeLoader({ short: true }) });
    const shorted = await short.embedTexts(['a', 'b'], { purpose: 'query' });
    expect(!shorted.ok && shorted.error.code).toBe('vision.embedding_failed');
  });

  it('cancels queued work', async () => {
    const embedder = createEmbedder({ modelDir: '/m', loader: fakeLoader({ delayMs: 5 }) });
    const controller = new AbortController();
    controller.abort();
    const result = await embedder.embedImages([image(1, 1, 1)], { signal: controller.signal });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });

  it('closes and reloads', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({ modelDir: '/m', loader });
    await embedder.embedTexts(['x'], { purpose: 'query' });
    await embedder.close();
    expect(embedder.device()).toBeNull();
    await embedder.embedTexts(['x'], { purpose: 'query' });
    expect(loader.loads).toHaveLength(2);
  });
});

describe('space helpers', () => {
  it('sizes frames like the Gemma 4 image processor (about 280 soft tokens, sides a multiple of 48)', () => {
    expect(embeddingFrameSize(1920, 1080)).toEqual({ width: 1056, height: 576 });
    expect(embeddingFrameSize(1080, 1920)).toEqual({ width: 576, height: 1056 });
    expect(embeddingFrameSize(1000, 1000)).toEqual({ width: 768, height: 768 });
    const tall = embeddingFrameSize(10, 4000);
    expect(tall.width).toBe(48);
    expect(tall.height % 48).toBe(0);
    const wide = embeddingFrameSize(4000, 10);
    expect(wide.height).toBe(48);
    // 2:1 takes two passes of the processor's rule; the frame must be a size the processor keeps.
    expect(embeddingFrameSize(64, 32)).toEqual({ width: 1152, height: 528 });
    for (const [w, h] of [
      [640, 360],
      [1080, 1350],
      [3840, 2160],
      [64, 32],
      [4032, 3024],
      [2560, 1080],
    ] as const) {
      const size = embeddingFrameSize(w, h);
      expect(embeddingFrameSize(size.width, size.height)).toEqual(size);
      expect((size.width / 48) * (size.height / 48)).toBeLessThanOrEqual(280);
      const small = embeddingFrameSize(w, h, 140);
      expect(embeddingFrameSize(small.width, small.height, 140)).toEqual(small);
      expect(imageTokens(small)).toBeLessThanOrEqual(140);
    }
    // 140 tokens: the budget the model card gives video frames.
    expect(embeddingFrameSize(1920, 1080, 140)).toEqual({ width: 768, height: 384 });
    expect(imageTokens({ width: 768, height: 384 })).toBe(128);
    expect(imageTokens({ width: 1056, height: 576 })).toBe(264);
  });

  it('normalises, measures cosine distance and the distance of means', () => {
    const a = unitVector(Float32Array.from([3, 4]));
    expect(Array.from(a)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(Array.from(unitVector(new Float32Array(2)))).toEqual([0, 0]);
    expect(cosineDistance(a, a)).toBeCloseTo(0, 6);
    const x = Float32Array.from([1, 0]);
    const y = Float32Array.from([0, 1]);
    expect(cosineDistance(x, y)).toBeCloseTo(1, 6);
    expect(meanDistance([x], [x, x])).toBeCloseTo(0, 6);
  });
});
