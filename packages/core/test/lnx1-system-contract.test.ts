// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  computeReportSchema,
  CPU_FALLBACK_REASON_KEYS,
  HARDWARE_SHORTFALLS,
  hardwareReportSchema,
  MODEL_COMPUTE_BACKENDS,
  type HardwareReport,
} from '@taalcut/core';

const GIB = 1024 ** 3;

/** What the Linux probe reports on the RTX 4090 host the round was built on. */
const linux: HardwareReport = {
  info: {
    platform: 'linux',
    arch: 'x64',
    chip: '13th Gen Intel(R) Core(TM) i9-13900K',
    memoryBytes: 61 * GIB,
    cpuCores: { total: 32 },
    freeDiskBytes: 300 * GIB,
    osVersion: '24.04',
    osName: 'Ubuntu 24.04.5 LTS',
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        vramBytes: 24 * GIB,
        driverVersion: '615.71.09',
        apis: ['cuda', 'vulkan'],
      },
      { name: 'Intel UHD Graphics 770', vendor: 'intel', apis: ['vulkan'] },
    ],
  },
  tier: 'high',
  shortfalls: [],
  labelKey: 'models.tier.high',
  shortfallKeys: [],
};

describe('system contract (LNX1)', () => {
  it('carries the OS name and each GPU with its memory, driver and APIs', () => {
    expect(hardwareReportSchema.parse(linux)).toEqual(linux);
  });

  it('still reads a report from before LNX1: no OS name, no GPUs', () => {
    const { osName: _osName, gpus: _gpus, ...info } = linux.info;
    const mac = { ...linux, info: { ...info, platform: 'darwin', arch: 'arm64', chip: 'Apple M2 Pro' } };
    expect(hardwareReportSchema.parse(mac)).toEqual(mac);
  });

  it('rejects a GPU API it does not know', () => {
    const gpu = { ...linux.info.gpus![0]!, apis: ['opencl'] };
    const bad = { ...linux, info: { ...linux.info, gpus: [gpu] } };
    expect(hardwareReportSchema.safeParse(bad).success).toBe(false);
  });

  it('names the shortfalls of a Linux or Windows machine', () => {
    expect(HARDWARE_SHORTFALLS).toEqual(expect.arrayContaining(['os_too_old', 'gpu_driver_old']));
    const old = { ...linux, tier: 'minimum', shortfalls: ['gpu_driver_old'] };
    expect(hardwareReportSchema.safeParse(old).success).toBe(true);
  });

  it('names a CPU forced by TAALCUT_FORCE_CPU', () => {
    expect(CPU_FALLBACK_REASON_KEYS).toContain('compute.fallback.disabled');
  });

  it('reports a model on WebGPU, and the GPU with its memory and driver', () => {
    expect(MODEL_COMPUTE_BACKENDS).toContain('webgpu');
    const report = {
      gpu: { name: 'NVIDIA GeForce RTX 4090', api: 'CUDA', vramBytes: 24 * GIB, driverVersion: '615.71.09' },
      modules: [{ module: 'embeddings', runtime: 'ONNX Runtime', backend: 'webgpu' }],
    };
    expect(computeReportSchema.parse(report)).toEqual(report);
  });
});
