// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder's profile per machine and its execution-provider choice
 * (IX-E3, E4, E6). Windows and NVIDIA rows run on recorded hardware facts
 * only: they have not run on a real Windows PC.
 */
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { loadOnBestDevice } from '../../src/embed/backend';
import type { EmbeddingDevice } from '../../src/embed/model';
import { embeddingProfile, type EmbeddingHardware } from '../../src/embed/profile';
import { createVectorMemo } from '../../src/embed/vector-memo';
import { fakeLoader } from '../helpers/fake-model';

const GIB = 1024 ** 3;
const mac = (tier: EmbeddingHardware['tier'], memoryGiB: number): EmbeddingHardware => ({
  platform: 'darwin',
  tier,
  memoryBytes: memoryGiB * GIB,
  gpus: [{ vendor: 'apple' }],
});
const pc = (vendor: string, vramGiB: number): EmbeddingHardware => ({
  platform: 'win32',
  tier: 'recommended',
  memoryBytes: 32 * GIB,
  gpus: [{ vendor, vramBytes: vramGiB * GIB }],
});

describe('embeddingProfile', () => {
  it('gives Macs of unknown macOS WebGPU then the CPU, one frame budget, and a warm start above Minimum', () => {
    expect(embeddingProfile(mac('minimum', 8))).toEqual({
      imageTokens: 140,
      devices: ['webgpu', 'cpu'],
      batchTokens: 512,
      maxBatchFrames: 16,
      textBatch: 16,
      warmOnImport: false,
    });
    expect(embeddingProfile(mac('recommended', 16))).toMatchObject({ imageTokens: 140, warmOnImport: true });
    expect(embeddingProfile(mac('recommended', 8))).toMatchObject({ warmOnImport: false });
    expect(embeddingProfile(mac('high', 64))).toMatchObject({ imageTokens: 140, warmOnImport: true });
    for (const tier of ['minimum', 'recommended', 'high'] as const)
      expect(embeddingProfile(mac(tier, 64)).devices).not.toContain('coreml');
  });

  it('gives Windows PCs CUDA (when a runtime lists it), DirectML, WebGPU, then the CPU', () => {
    expect(embeddingProfile(pc('nvidia', 12))).toMatchObject({
      devices: ['cuda', 'directml', 'webgpu', 'cpu'],
      batchTokens: 1024,
    });
    expect(embeddingProfile(pc('amd', 8)).devices).toEqual(['directml', 'webgpu', 'cpu']);
    expect(embeddingProfile({ ...pc('intel', 0), gpus: [{ vendor: 'intel' }] }).batchTokens).toBe(512);
  });

  it('gives Linux CUDA on NVIDIA, and an unknown platform WebGPU then the CPU', () => {
    expect(embeddingProfile({ ...pc('nvidia', 24), platform: 'linux' }).devices).toEqual([
      'cuda',
      'webgpu',
      'cpu',
    ]);
    expect(embeddingProfile({ ...pc('amd', 8), platform: 'linux' }).devices).toEqual(['webgpu', 'cpu']);
    expect(embeddingProfile({ ...mac('high', 32), platform: 'freebsd' }).devices).toEqual(['webgpu', 'cpu']);
  });
});

describe('loadOnBestDevice', () => {
  const load = async (
    devices: readonly EmbeddingDevice[],
    listed: readonly EmbeddingDevice[] | null,
    failOn: EmbeddingDevice[] = [],
    disableGpu = false,
  ) => {
    const loader = fakeLoader({ failOn });
    const events: ComputeFallbackEvent[] = [];
    const model = await loadOnBestDevice('/m', devices, {
      loader,
      modelOptions: {},
      listDevices: async () => listed,
      onFallback: (event) => events.push(event),
      disableGpu,
    });
    return { loads: loader.loads, events, device: 'code' in model ? model.code : model.device };
  };

  it('takes the first listed provider, skipping ones the runtime does not have', async () => {
    // The npm binding on Windows lists DirectML and WebGPU, not CUDA.
    const windows = await load(['cuda', 'directml', 'webgpu', 'cpu'], ['cpu', 'webgpu', 'directml']);
    expect(windows).toEqual({ loads: ['directml:/m'], events: [], device: 'directml' });
    expect((await load(['webgpu', 'cpu'], null)).device).toBe('webgpu');
  });

  it('tries the next provider when one fails to load, and logs the CPU only when all failed', async () => {
    const next = await load(
      ['cuda', 'directml', 'webgpu', 'cpu'],
      ['cuda', 'directml', 'webgpu', 'cpu'],
      ['cuda'],
    );
    expect(next).toMatchObject({ loads: ['cuda:/m', 'directml:/m'], events: [], device: 'directml' });
    const cpu = await load(['directml', 'webgpu', 'cpu'], null, ['directml', 'webgpu']);
    expect(cpu.loads).toEqual(['directml:/m', 'webgpu:/m', 'cpu:/m']);
    expect(cpu.events).toEqual([
      {
        operation: 'vision.embed',
        wanted: ['directml', 'webgpu'],
        reason: 'accelerator_failed',
        // Every device's failure, so a CUDA one that didn't load stays in the trace after WebGPU also failed.
        detail: 'directml: directml session failed; webgpu: webgpu session failed',
      },
    ]);
  });

  it('logs no_accelerator when the runtime lists none, and disabled when turned off', async () => {
    const none = await load(['webgpu', 'cpu'], ['cpu']);
    expect(none).toMatchObject({ loads: ['cpu:/m'], device: 'cpu' });
    expect(none.events.map((e) => e.reason)).toEqual(['no_accelerator']);
    const off = await load(['webgpu', 'cpu'], ['cpu', 'webgpu'], [], true);
    expect(off.events.map((e) => [e.reason, e.detail])).toEqual([['disabled', 'acceleration turned off']]);
    const nothing = await load(['webgpu'], null, ['webgpu', 'cpu']);
    expect(nothing.device).toBe('vision.embedder_unavailable');
  });
});

describe('createVectorMemo', () => {
  const frame = (value: number) => ({ width: 2, height: 1, rgb: new Uint8Array([value, 0, 0, value, 0, 0]) });

  it('keys frames by their pixels and size, and drops the least recently used first', () => {
    const memo = createVectorMemo(2);
    expect(memo.key(frame(1))).toBe(memo.key(frame(1)));
    expect(memo.key(frame(1))).not.toBe(memo.key(frame(2)));
    expect(memo.key(frame(1))).not.toBe(memo.key({ ...frame(1), width: 1, height: 2 }));
    memo.set('a', Float32Array.of(1));
    memo.set('b', Float32Array.of(2));
    expect(memo.get('a')).toEqual(Float32Array.of(1));
    memo.set('c', Float32Array.of(3));
    expect(memo.get('b')).toBeUndefined();
    expect([memo.size, memo.hits]).toEqual([2, 1]);
    memo.clear();
    expect(memo.get('a')).toBeUndefined();
  });
});
