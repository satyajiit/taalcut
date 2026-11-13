// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: the hardware report's NVIDIA GPU setup in the agent process, from the probe's GPUs, the CUDA runtime's
 * row and its folder: installed since the processes started (restart), damaged (libraries missing from its
 * folder), and the download's repair of a damaged one. Only where the loader is told about component libraries.
 */
import { describe, expect, it } from 'vitest';
import { err, ok, type Component } from '@taalcut/core';
import { CUDA_PROVIDER_LIBRARIES } from '@taalcut/media';
import type { GpuInfo } from '@taalcut/models';
import {
  CUDA_RUNTIME_LIBRARIES,
  cudaRuntimeIntact,
  gpuSetupOf,
  repairCudaRuntime,
  type CudaRuntimeDisk,
} from '../src/utility/roots/gpu-setup';
import { hardwareReport } from '../src/utility/roots/system-info';

const RTX_4090: GpuInfo = {
  name: 'NVIDIA GeForce RTX 4090',
  vendor: 'nvidia',
  vramBytes: 24 * 1024 ** 3,
  unifiedMemory: false,
  apis: ['cuda', 'vulkan'],
  driverVersion: '615.71.09',
  computeCapability: '8.9',
  cudaDeviceId: 0,
  kernelDriver: 'nvidia',
};
const FOLDER = '/c/installed/cuda-runtime-13/13.4.3-cudnn9.27.0-a03bc73d5dfa';
const LINUX = { variable: 'LD_LIBRARY_PATH', separator: ':' };

function disk(files: readonly string[], env: NodeJS.ProcessEnv = {}, installed = true): CudaRuntimeDisk {
  return {
    root: '/c',
    installedDir: () => (installed ? FOLDER : undefined),
    exists: (path) => files.some((name) => path === `${FOLDER}/lib/${name}`),
    env,
    searchPath: LINUX,
  };
}
const row = (status: Component['status'], accepted = true): Component => ({
  id: 'cuda-runtime-13',
  name: 'CUDA runtime 13',
  version: '13.4.3-cudnn9.27.0',
  licence: 'LicenseRef-NVIDIA-CUDA-Toolkit-EULA',
  sizeBytes: 968_041_808,
  status,
  usedBy: [],
  terms: { owner: 'NVIDIA Corporation', termsVersion: '2026-10-27', documents: [], accepted } as never,
});
const ALL = [...CUDA_RUNTIME_LIBRARIES];
const STARTED_WITH = { LD_LIBRARY_PATH: `${FOLDER}/lib:/usr/lib` };

describe("the hardware report's NVIDIA GPU setup", () => {
  it('names the libraries media says the CUDA builds load, but the driver’s', () => {
    expect([...CUDA_RUNTIME_LIBRARIES, 'libcuda.so.1'].sort()).toEqual([...CUDA_PROVIDER_LIBRARIES].sort());
  });

  it('asks for the runtime, with whether its terms are accepted, until it is installed', () => {
    const none = disk([], {}, false);
    expect(gpuSetupOf([RTX_4090], undefined, none)).toMatchObject({
      state: 'runtime_missing',
      termsAccepted: false,
    });
    expect(gpuSetupOf([RTX_4090], row('not-installed'), none)).toMatchObject({
      state: 'runtime_missing',
      termsAccepted: true,
    });
  });

  it('asks for a restart when it was installed after this process started, and is ready after', () => {
    expect(gpuSetupOf([RTX_4090], row('installed'), disk(ALL, { LD_LIBRARY_PATH: '/usr/lib' }))?.state).toBe(
      'restart_needed',
    );
    expect(gpuSetupOf([RTX_4090], row('installed'), disk(ALL, STARTED_WITH))?.state).toBe('ready');
  });

  it('says a damaged install is damaged: libraries missing from its folder', () => {
    const damaged = disk(['libcudart.so.13'], STARTED_WITH);
    expect(cudaRuntimeIntact(damaged)).toBe(false);
    expect(gpuSetupOf([RTX_4090], row('installed'), damaged)?.state).toBe('runtime_damaged');
    expect(cudaRuntimeIntact(disk([], {}, false))).toBe(true);
  });

  it('is absent where the loader is told about no component libraries (macOS, Windows for now)', () => {
    expect(gpuSetupOf([RTX_4090], row('installed'), { ...disk(ALL), searchPath: undefined })).toBeUndefined();
  });

  it('rides on the hardware report only when there is one', () => {
    const probed = {
      info: {
        platform: 'linux',
        arch: 'x64',
        chip: 'AMD Ryzen 9 7950X',
        memoryBytes: 64 * 1024 ** 3,
        cpuCores: { total: 32 },
        freeDiskBytes: 500 * 1024 ** 3,
        osVersion: '24.04',
        gpus: [RTX_4090],
      },
      assessment: { tier: 'high', shortfalls: [], labelKey: 'models.tier.high.label', shortfallKeys: [] },
    } as never;
    const setup = gpuSetupOf([RTX_4090], row('installed'), disk(ALL, STARTED_WITH));
    expect(hardwareReport(probed, setup).gpuSetup?.state).toBe('ready');
    expect(hardwareReport(probed)).not.toHaveProperty('gpuSetup');
  });
});

describe('a download started with the runtime damaged', () => {
  it('removes it first, so the download fetches it again; an intact one stays', async () => {
    const removed: string[] = [];
    const logs: string[] = [];
    const manager = {
      remove: async (id: string) => {
        removed.push(id);
        return ok({ freedBytes: 1 });
      },
    };
    await repairCudaRuntime(manager, disk(ALL), (line) => logs.push(line));
    expect(removed).toEqual([]);
    await repairCudaRuntime(manager, disk(['libcudart.so.13']), (line) => logs.push(line));
    expect(removed).toEqual(['cuda-runtime-13']);
    expect(logs[0]).toBe(
      '[components] cuda-runtime-13: libcublas.so.13, libcublasLt.so.13, libcurand.so.10 missing from its folder; downloading it again',
    );
    const refusing = { remove: async () => err({ code: 'jobs.install_failed' } as never) };
    await repairCudaRuntime(refusing, disk([]), (line) => logs.push(line));
    expect(logs.at(-1)).toBe("[components] cuda-runtime-13: couldn't remove it (jobs.install_failed)");
  });
});
