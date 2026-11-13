// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The move to Core ML once its first compile finishes (IX2-F2, F10, F11). No call waits for it: the move loads Core
 * ML in the background from the moment the backend says it is ready (or from the first call after the first load,
 * when the "ready" came during that load), calls meanwhile run on WebGPU, and the WebGPU model is disposed once no
 * call runs on it. A move that fails keeps WebGPU (model-slot.test.ts: tried again later, after a back-off).
 */
import { describe, expect, it, vi } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import type { EmbeddingModel, EmbeddingModelLoader } from '../../src/embed/model';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { fakeLoader } from '../helpers/fake-model';
import { fakeNative } from '../helpers/fake-native';

const PROFILE = { ...DEFAULT_EMBEDDING_PROFILE, devices: ['coreml', 'webgpu', 'cpu'] as const };
const query = (text: string) => ({ purpose: 'query' as const, text });

/**
 * The fake loader with its models watched: each load waits for `open()` when held, a disposed model throws on any
 * call (so a call on it fails the test), and `holdCalls` keeps the next calls running until `endCalls()`.
 */
function watchedLoader(options: { held?: boolean } = {}) {
  const loader = fakeLoader();
  let open: () => void = () => {};
  const gate = options.held ? new Promise<void>((resolve) => (open = resolve)) : Promise.resolve();
  let callGate: Promise<void> | undefined;
  let endCalls: () => void = () => {};
  const counts = { disposed: 0, callsOnDisposed: 0 };
  const watched: EmbeddingModelLoader = async (dir, device, modelOptions) => {
    await gate;
    const model = await loader(dir, device, modelOptions);
    let disposed = false;
    /** The call's vectors once the held calls may end, counting a call that ended on a disposed model. */
    const guarded = async (vectors: Promise<Float32Array[]>) => {
      const done = await vectors;
      await callGate;
      if (disposed) counts.callsOnDisposed++;
      return done;
    };
    const wrapped: EmbeddingModel = {
      ...model,
      embedTexts: (texts) => guarded(model.embedTexts(texts)),
      embedImages: (images) => guarded(model.embedImages(images)),
      async dispose() {
        disposed = true;
        counts.disposed++;
      },
    };
    return wrapped;
  };
  const holdCalls = () => {
    callGate = new Promise<void>((resolve) => (endCalls = resolve));
  };
  return { watched, loader, open: () => open(), counts, holdCalls, endCalls: () => endCalls() };
}

describe('the embedder when Core ML comes ready during the first load', () => {
  it('serves the waiting call on WebGPU, then moves in the background and disposes WebGPU', async () => {
    const native = fakeNative({ available: false });
    const { watched, loader, open, counts } = watchedLoader({ held: true });
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: watched,
      profile: PROFILE,
      native: { coreml: native.backend },
    });
    const first = embedder.embedTexts(['first'], query('first'));
    // The load has asked Core ML (still compiling) and is on its way to WebGPU when the compile finishes.
    await vi.waitFor(() => expect(native.state.asked).toBe(1));
    native.becomeAvailable();
    open();
    expect((await first).ok).toBe(true);
    expect(loader.calls.map((c) => c.inputs)).toEqual([['task: search result | query: first']]);
    await vi.waitFor(() => expect(embedder.device()).toBe('coreml'));
    expect(loader.loads).toEqual(['webgpu:/m']);
    expect(counts.disposed).toBe(1);
    await embedder.embedTexts(['again'], query('again'));
    expect(native.model.calls.map((c) => c.inputs)).toEqual([['task: search result | query: again']]);
    expect(native.state.loads).toBe(1);
    expect(counts.callsOnDisposed).toBe(0);
  });

  it('loads Core ML straight away when it came ready before the first load', async () => {
    const native = fakeNative({ available: false });
    const loader = fakeLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: PROFILE,
      native: { coreml: native.backend },
    });
    native.becomeAvailable();
    await embedder.embedTexts(['first'], query('first'));
    expect(embedder.device()).toBe('coreml');
    expect(loader.loads).toEqual([]);
    expect(native.state.loads).toBe(1);
  });
});

describe('the embedder while Core ML loads in the background (IX2-F10)', () => {
  it('answers a query on WebGPU without waiting for a slow Core ML load, then runs calls on Core ML', async () => {
    const native = fakeNative({ available: false, held: true });
    const { watched, loader, counts } = watchedLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: watched,
      profile: PROFILE,
      native: { coreml: native.backend },
    });
    await embedder.embedTexts(['indexing'], { purpose: 'document' });
    native.becomeAvailable();
    // The move starts with the "ready": Core ML is loading, and holds its load.
    await vi.waitFor(() => expect(native.state.loads).toBe(1));
    const searched = await embedder.embedTexts(['monsoon'], query('monsoon'));
    expect(searched.ok).toBe(true);
    expect(embedder.device()).toBe('webgpu');
    expect(loader.calls.at(-1)?.inputs).toEqual(['task: search result | query: monsoon']);
    native.finishLoad();
    await vi.waitFor(() => expect(embedder.device()).toBe('coreml'));
    await embedder.embedImages([{ width: 2, height: 2, rgb: new Uint8Array(12) }]);
    expect(native.model.calls.map((c) => c.kind)).toEqual(['images']);
    expect(counts.disposed).toBe(1);
    expect(counts.callsOnDisposed).toBe(0);
  });

  it('disposes the WebGPU model only after the call running on it ends', async () => {
    const native = fakeNative({ available: false });
    const { watched, counts, holdCalls, endCalls } = watchedLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: watched,
      profile: PROFILE,
      native: { coreml: native.backend },
    });
    await embedder.embedTexts(['warm'], { purpose: 'document' });
    holdCalls();
    const running = embedder.embedTexts(['long call'], { purpose: 'document' });
    native.becomeAvailable();
    await vi.waitFor(() => expect(embedder.device()).toBe('coreml'));
    // Core ML takes the next call, but WebGPU still has a call running on it.
    expect(counts.disposed).toBe(0);
    endCalls();
    expect((await running).ok).toBe(true);
    await vi.waitFor(() => expect(counts.disposed).toBe(1));
    expect(counts.callsOnDisposed).toBe(0);
  });

  it('keeps WebGPU when the move fails, and never runs a call on a model it disposed', async () => {
    const native = fakeNative({ available: false, fail: true });
    const failed: string[] = [];
    const { watched, counts } = watchedLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader: watched,
      profile: PROFILE,
      native: { coreml: native.backend },
      onDeviceFailed: (device, detail) => failed.push(`${device}: ${detail}`),
    });
    await embedder.embedTexts(['before'], { purpose: 'document' });
    native.becomeAvailable();
    await vi.waitFor(() => expect(failed).toEqual(['coreml: embed.prepare: embed.model_load_failed']));
    expect((await embedder.embedTexts(['after'], query('after'))).ok).toBe(true);
    expect(embedder.device()).toBe('webgpu');
    expect(counts.disposed).toBe(0);
    expect(counts.callsOnDisposed).toBe(0);
  });
});
