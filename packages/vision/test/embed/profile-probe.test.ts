// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder's devices from the probe (LNX1 seam 1): the platform's row, less what the machine can't run, the
 * CUDA session on the probe's device, and a forced CPU recorded as `disabled`.
 */
import type { ComputeFallbackEvent } from '@taalcut/core';
import type { MachineAccelerators } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { sessionProviders, type EmbeddingDevice, type EmbeddingModelOptions } from '../../src/embed/model';
import { embeddingProfile, type EmbeddingHardware } from '../../src/embed/profile';
import { fakeLoader } from '../helpers/fake-model';

const GIB = 1024 ** 3;
const linux = (accelerators?: MachineAccelerators): EmbeddingHardware => ({
  platform: 'linux',
  tier: 'high',
  memoryBytes: 64 * GIB,
  gpus: [{ vendor: 'nvidia', vramBytes: 24 * GIB }],
  ...(accelerators ? { accelerators } : {}),
});
const machine = (apis: MachineAccelerators['apis'], extra: Partial<MachineAccelerators> = {}) => ({
  platform: 'linux',
  apis,
  forcedCpu: false,
  ...extra,
});

describe('embeddingProfile from the probe', () => {
  it("runs CUDA first on the probe's device, then WebGPU", () => {
    expect(embeddingProfile(linux(machine(['cuda', 'vulkan'], { cudaDeviceId: 1 })))).toMatchObject({
      devices: ['cuda', 'webgpu', 'cpu'],
      cudaDeviceId: 1,
    });
  });

  it('drops CUDA when the driver is below CUDA 13 (Vulkan only) and keeps no device id', () => {
    const old = embeddingProfile(linux(machine(['vulkan'], { cudaDeviceId: 0 })));
    expect(old.devices).toEqual(['webgpu', 'cpu']);
    expect(old.cudaDeviceId).toBeUndefined();
  });

  it('keeps the CPU alone when TAALCUT_FORCE_CPU is set, and says so', () => {
    expect(embeddingProfile(linux(machine([], { forcedCpu: true })))).toMatchObject({
      devices: ['cpu'],
      forcedCpu: true,
    });
  });

  it('keeps the platform row when there is no probe', () => {
    expect(embeddingProfile(linux()).devices).toEqual(['cuda', 'webgpu', 'cpu']);
  });
});

describe('the CUDA session', () => {
  it("names the probe's device to transformers.js, and every other device by name", () => {
    expect(sessionProviders('cuda', { cudaDeviceId: 2 })).toEqual([{ name: 'cuda', deviceId: 2 }]);
    expect(sessionProviders('cuda')).toEqual(['cuda']);
    expect(sessionProviders('directml', { cudaDeviceId: 2 })).toEqual(['dml']);
  });

  it("loads on CUDA with the profile's device, and on the CPU with `disabled` when forced", async () => {
    const seen: [EmbeddingDevice, EmbeddingModelOptions][] = [];
    const base = fakeLoader();
    const loader = async (dir: string, device: EmbeddingDevice, options: EmbeddingModelOptions = {}) => {
      seen.push([device, options]);
      return base(dir, device, options);
    };
    const cuda = createEmbedder({
      modelDir: '/m',
      loader,
      profile: embeddingProfile(linux(machine(['cuda', 'vulkan'], { cudaDeviceId: 1 }))),
    });
    await cuda.warm();
    expect(cuda.device()).toBe('cuda');
    expect(seen).toEqual([['cuda', { cudaDeviceId: 1 }]]);

    const events: ComputeFallbackEvent[] = [];
    const forced = createEmbedder({
      modelDir: '/m',
      loader,
      onFallback: (event) => events.push(event),
      profile: embeddingProfile(linux(machine([], { forcedCpu: true }))),
    });
    await forced.warm();
    expect(forced.device()).toBe('cpu');
    expect(events.map((event) => event.reason)).toEqual(['disabled']);
  });
});
