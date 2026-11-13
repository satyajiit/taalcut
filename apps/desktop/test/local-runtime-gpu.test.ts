// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1: the agent's local LLM sizes itself for the probe's GPU (its CUDA device, its free VRAM, its name and whole
 * memory for the Vulkan build; nothing on unified memory), and llama-server gets the loader's path and CUDA's device list from this process, nothing else.
 */
import type { GpuInfo, HardwareAssessment } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { launchGpu, sidecarGpuEnv } from '../src/utility/roots/local-runtime';

const MIB = 1024 ** 2;
const compute = (gpu?: GpuInfo): HardwareAssessment['compute'] => ({
  backends: ['cuda', 'vulkan', 'webgpu', 'cpu'],
  ...(gpu ? { gpu } : {}),
  gpuMemoryBytes: gpu?.vramBytes ?? 0,
  neuralEngine: false,
});
const rtx: GpuInfo = {
  name: 'NVIDIA GeForce RTX 4090',
  vendor: 'nvidia',
  vramBytes: 24_564 * MIB,
  vramFreeBytes: 20_150 * MIB,
  unifiedMemory: false,
  apis: ['cuda', 'vulkan'],
  cudaDeviceId: 0,
};

describe('the local LLM on the probed GPU', () => {
  it("takes the CUDA device and the VRAM free when the probe ran, else the card's total", () => {
    const named = { name: rtx.name, totalVramBytes: 24_564 * MIB };
    expect(launchGpu(compute(rtx))).toEqual({ gpu: { cudaDeviceId: 0, vramBytes: 20_150 * MIB, ...named } });
    const { vramFreeBytes: _free, ...noFree } = rtx;
    expect(launchGpu(compute(noFree))).toEqual({
      gpu: { cudaDeviceId: 0, vramBytes: 24_564 * MIB, ...named },
    });
  });

  it("names an AMD card and its memory, for the Vulkan build's device list", () => {
    const amd: GpuInfo = {
      name: 'Navi 31 [Radeon RX 7900 XTX]',
      vendor: 'amd',
      vramBytes: 24_576 * MIB,
      unifiedMemory: false,
      apis: ['vulkan'],
    };
    expect(launchGpu(compute(amd))).toEqual({
      gpu: { vramBytes: 24_576 * MIB, name: amd.name, totalVramBytes: 24_576 * MIB },
    });
  });

  it('sizes nothing on unified memory or without a GPU', () => {
    const m3: GpuInfo = { name: 'Apple M3', vendor: 'apple', unifiedMemory: true, apis: ['metal'] };
    expect(launchGpu(compute(m3))).toEqual({});
    expect(launchGpu(compute())).toEqual({});
  });

  it("passes llama-server the loader's path and CUDA's device list only", () => {
    expect(
      sidecarGpuEnv({
        LD_LIBRARY_PATH: '/c/cuda-runtime-13/lib',
        CUDA_VISIBLE_DEVICES: '0',
        HOME: '/home/u',
      }),
    ).toEqual({ LD_LIBRARY_PATH: '/c/cuda-runtime-13/lib', CUDA_VISIBLE_DEVICES: '0' });
    expect(sidecarGpuEnv({ HOME: '/home/u' })).toEqual({});
  });
});
