// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core ML through the mac helper as the embedder's first device on macOS 15 and later (IX2-E5): the profile, the
 * device choice with a native backend (available, not yet, failing), ONNX Runtime's own Core ML provider never
 * chosen, and the move to Core ML in the background once its first compile finishes.
 */
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { loadOnBestDevice, type NativeEmbeddingBackend } from '../../src/embed/backend';
import { createEmbedder } from '../../src/embed/embedder';
import type { EmbeddingDevice } from '../../src/embed/model';
import { DEFAULT_EMBEDDING_PROFILE, embeddingProfile, type EmbeddingHardware } from '../../src/embed/profile';
import { embeddingFrameSize } from '../../src/embed/space';
import { fakeLoader } from '../helpers/fake-model';
import { fakeNative } from '../helpers/fake-native';

const GIB = 1024 ** 3;
const mac = (osVersion?: string): EmbeddingHardware => ({
  platform: 'darwin',
  tier: 'recommended',
  memoryBytes: 16 * GIB,
  gpus: [{ vendor: 'apple' }],
  ...(osVersion ? { osVersion } : {}),
});

describe('the embedding profile on macOS', () => {
  it('puts Core ML first from macOS 15, and keeps WebGPU first on 14 or an unknown version', () => {
    expect(embeddingProfile(mac('15.4.1')).devices).toEqual(['coreml', 'webgpu', 'cpu']);
    expect(embeddingProfile(mac('26.0')).devices).toEqual(['coreml', 'webgpu', 'cpu']);
    expect(embeddingProfile(mac('14.7.2')).devices).toEqual(['webgpu', 'cpu']);
    expect(embeddingProfile(mac()).devices).toEqual(['webgpu', 'cpu']);
  });
});

describe('loadOnBestDevice with a native backend', () => {
  const load = async (
    native: NativeEmbeddingBackend | undefined,
    listed: readonly EmbeddingDevice[] | null,
    disableGpu = false,
  ) => {
    const loader = fakeLoader();
    const failed: string[] = [];
    const events: ComputeFallbackEvent[] = [];
    const model = await loadOnBestDevice('/m', ['coreml', 'webgpu', 'cpu'], {
      loader,
      modelOptions: {},
      listDevices: async () => listed,
      onFallback: (event) => events.push(event),
      onDeviceFailed: (device, detail) => failed.push(`${device}: ${detail}`),
      ...(native ? { native: { coreml: native } } : {}),
      disableGpu,
    });
    return { device: 'code' in model ? model.code : model.device, ortLoads: loader.loads, failed, events };
  };

  it('loads Core ML from the helper when it is available, and nothing through ONNX Runtime', async () => {
    const native = fakeNative({ available: true });
    expect(await load(native.backend, ['cpu', 'webgpu', 'coreml'])).toEqual({
      device: 'coreml',
      ortLoads: [],
      failed: [],
      events: [],
    });
    expect(native.state.loads).toBe(1);
  });

  it("goes to WebGPU while Core ML isn't available, and never to ONNX Runtime's Core ML provider", async () => {
    const native = fakeNative({ available: false });
    expect(await load(native.backend, ['cpu', 'webgpu', 'coreml'])).toMatchObject({
      device: 'webgpu',
      ortLoads: ['webgpu:/m'],
    });
    expect(native.state.loads).toBe(0);
    // Without a native backend (macOS 14's helper, a test build), `coreml` is not a device at all.
    expect(await load(undefined, ['cpu', 'webgpu', 'coreml'])).toMatchObject({
      device: 'webgpu',
      ortLoads: ['webgpu:/m'],
    });
  });

  it('reports a Core ML model that fails to load and takes WebGPU, and asks nothing when acceleration is off', async () => {
    const failing = fakeNative({ available: true, fail: true });
    expect(await load(failing.backend, null)).toEqual({
      device: 'webgpu',
      ortLoads: ['webgpu:/m'],
      failed: ['coreml: embed.prepare: embed.model_load_failed'],
      events: [],
    });
    const off = fakeNative({ available: true });
    const result = await load(off.backend, null, true);
    expect(result.device).toBe('cpu');
    expect(result.events.map((e) => [e.reason, e.wanted])).toEqual([['disabled', ['coreml', 'webgpu']]]);
    expect(off.state.asked).toBe(0);
  });
});

describe('the embedder once Core ML comes ready', () => {
  it('moves from WebGPU to Core ML in the background, disposing the WebGPU model', async () => {
    const native = fakeNative({ available: false });
    const loader = fakeLoader();
    let disposed = 0;
    const counting: typeof loader = Object.assign(
      async (...args: Parameters<typeof loader>) => {
        const model = await loader(...args);
        return {
          ...model,
          async dispose() {
            disposed++;
          },
        };
      },
      { calls: loader.calls, loads: loader.loads, options: loader.options },
    );
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: counting,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, devices: ['coreml', 'webgpu', 'cpu'] },
      native: { coreml: native.backend },
    });
    expect((await embedder.embedTexts(['before'], { purpose: 'query' })).ok).toBe(true);
    expect(embedder.device()).toBe('webgpu');
    native.becomeAvailable();
    // The move starts with the "ready", not at the next call (IX2-F10).
    await vi.waitFor(() => expect(embedder.device()).toBe('coreml'));
    expect(disposed).toBe(1);
    expect((await embedder.embedTexts(['after'], { purpose: 'query' })).ok).toBe(true);
    expect(native.model.calls.map((c) => c.inputs)).toEqual([['task: search result | query: after']]);
    // Ready again: nothing moves.
    native.becomeAvailable();
    await embedder.embedTexts(['again'], { purpose: 'query' });
    expect(native.state.loads).toBe(1);
  });
});

describe('warming a model that lives in the helper', () => {
  /** A native model whose rewarm records its budget and finishes only when `release` runs. */
  function rewarming() {
    const native = fakeNative({ available: true });
    const rewarms: number[] = [];
    const held: (() => void)[] = [];
    const backend: NativeEmbeddingBackend = {
      available: native.backend.available,
      async load() {
        const model = await native.backend.load();
        return {
          ...model,
          rewarm: (tokens: number) =>
            new Promise<void>((resolve) => {
              rewarms.push(tokens);
              held.push(resolve);
            }),
        };
      },
    };
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: fakeLoader(),
      profile: { ...DEFAULT_EMBEDDING_PROFILE, devices: ['coreml', 'webgpu', 'cpu'] },
      native: { coreml: backend },
    });
    return { embedder, rewarms, release: () => held.splice(0).forEach((resolve) => resolve()) };
  }

  it('asks a loaded model to come back (the helper may have exited idle) at each import start', async () => {
    const { embedder, rewarms, release } = rewarming();
    await embedder.warm();
    expect(embedder.device()).toBe('coreml');
    expect(rewarms).toEqual([]);
    const warms = [embedder.warm(), embedder.warm()];
    await vi.waitFor(() => expect(rewarms).toHaveLength(2));
    release();
    await Promise.all(warms);
    // The index budget's frames with the text model: what an import embeds first.
    expect(rewarms).toEqual([DEFAULT_EMBEDDING_PROFILE.imageTokens, DEFAULT_EMBEDDING_PROFILE.imageTokens]);
  });

  it('holds no call up while the model comes back (IX3-N4, after IX2-F10)', async () => {
    const { embedder, rewarms, release } = rewarming();
    await embedder.warm();
    const warm = embedder.warm();
    await vi.waitFor(() => expect(rewarms).toHaveLength(1));
    // The rewarm hasn't finished; a search and a frame batch go through meanwhile.
    expect((await embedder.embedTexts(['lighthouse'], { purpose: 'query' })).ok).toBe(true);
    const size = embeddingFrameSize(1920, 1080, DEFAULT_EMBEDDING_PROFILE.imageTokens);
    const frames = await embedder.embedImages([
      { ...size, rgb: new Uint8Array(size.width * size.height * 3) },
    ]);
    expect(frames.ok).toBe(true);
    release();
    await warm;
  });
});
