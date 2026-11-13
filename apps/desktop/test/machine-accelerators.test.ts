// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1 seam 1: one description of the machine's accelerators from the probe, for vision's and audio's device tables.
 * CUDA only where CUDA 13 runs, on the probe's device, with that GPU's free memory; nothing but the CPU when forced;
 * undefined (logged once) when the probe failed, so each table keeps its platform's row.
 */
import type { GpuInfo, HardwareInfo } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { beatDevicePlan } from '@taalcut/audio';
import { hostPlatform } from '../src/platform';
import {
  componentsRoot,
  cudaRuntimeLibraries,
  machineAccelerators,
  machineBeatPlan,
  probedAccelerators,
} from '../src/utility/roots/machine-accelerators';
import type { ProbedHardware } from '../src/shared/tokens';

const MIB = 1024 ** 2;
const rtx: GpuInfo = {
  name: 'NVIDIA GeForce RTX 4090',
  vendor: 'nvidia',
  vramBytes: 24564 * MIB,
  vramFreeBytes: 20150 * MIB,
  unifiedMemory: false,
  apis: ['cuda', 'vulkan'],
  driverVersion: '615.71.09',
  computeCapability: '8.9',
  index: 0,
  cudaDeviceId: 0,
};
const uhd: GpuInfo = {
  name: 'Intel UHD Graphics 770',
  vendor: 'intel',
  unifiedMemory: false,
  apis: ['vulkan'],
};
const linux = (gpus: GpuInfo[], extra: Partial<HardwareInfo> = {}): HardwareInfo => ({
  platform: 'linux',
  arch: 'x64',
  chip: 'Intel(R) Core(TM) i9-14900KS',
  memoryBytes: 64 * 1024 * MIB,
  gpus,
  neuralEngine: false,
  cpuCores: { total: 32 },
  freeDiskBytes: 1e12,
  osVersion: '24.04',
  ...extra,
});

describe('machineAccelerators', () => {
  it("takes CUDA on the probe's device with that GPU's free memory", () => {
    expect(machineAccelerators(linux([rtx, uhd]))).toEqual({
      platform: 'linux',
      apis: ['cuda', 'vulkan'],
      vendor: 'nvidia',
      cudaDeviceId: 0,
      vramBytes: 20150 * MIB,
      forcedCpu: false,
    });
  });

  it('drops CUDA below CUDA 13’s floor (driver 580, sm_75) and keeps Vulkan', () => {
    const old = machineAccelerators(linux([{ ...rtx, driverVersion: '550.120' }, uhd]));
    expect(old).toEqual({
      platform: 'linux',
      apis: ['vulkan'],
      vendor: 'nvidia',
      vramBytes: 20150 * MIB,
      forcedCpu: false,
    });
    const pascal = machineAccelerators(linux([{ ...rtx, computeCapability: '6.1' }]));
    expect(pascal.apis).toEqual(['vulkan']);
    expect(pascal.cudaDeviceId).toBeUndefined();
  });

  it('has no APIs and says so under TAALCUT_FORCE_CPU', () => {
    const forced = machineAccelerators(
      linux(
        [
          { ...rtx, apis: [] },
          { ...uhd, apis: [] },
        ],
        { forcedCpu: true },
      ),
    );
    expect(forced).toMatchObject({ apis: [], forcedCpu: true });
    expect(forced.cudaDeviceId).toBeUndefined();
  });

  it('reads no VRAM for unified memory, and nothing for a machine without a GPU', () => {
    const mac = machineAccelerators({
      ...linux([{ name: 'Apple M3', vendor: 'apple', unifiedMemory: true, apis: ['metal'] }]),
      platform: 'darwin',
    });
    expect(mac).toEqual({ platform: 'darwin', apis: ['metal'], vendor: 'apple', forcedCpu: false });
    expect(machineAccelerators(linux([]))).toEqual({ platform: 'linux', apis: [], forcedCpu: false });
  });
});

describe('probedAccelerators', () => {
  it('gives undefined when the probe failed, said once', async () => {
    const lines: string[] = [];
    const failed = probedAccelerators(
      async () => Promise.reject(new Error('lspci missing')),
      (line) => lines.push(line),
    );
    expect([await failed(), await failed()]).toEqual([undefined, undefined]);
    expect(lines).toEqual([
      "[compute] hardware not probed (lspci missing): each device table keeps its platform's row",
    ]);
  });

  it('describes the probed machine', async () => {
    const probed = { info: linux([rtx]) } as unknown as ProbedHardware;
    expect((await probedAccelerators(async () => probed)())?.apis).toEqual(['cuda', 'vulkan']);
  });
});

describe('cudaRuntimeLibraries', () => {
  it("names the installed cuda-runtime-13's lib folder, read when a session fails", () => {
    const registry: { version?: string } = {};
    const libraries = cudaRuntimeLibraries(componentsRoot('/u'), (root, id) =>
      id === 'cuda-runtime-13' && registry.version
        ? `${root}/installed/${id}/${registry.version}`
        : undefined,
    );
    expect(libraries.installedRuntime?.()).toBeUndefined();
    registry.version = '13.4.3-cudnn9.27.0-837da78cbfae';
    expect(libraries.installedRuntime?.()).toBe(
      '/u/components/installed/cuda-runtime-13/13.4.3-cudnn9.27.0-837da78cbfae/lib',
    );
  });
});

describe('machineBeatPlan', () => {
  const probed = (info: HardwareInfo) => async () => ({ info }) as unknown as ProbedHardware;

  it("plans Beat This! on this host's row for the probed machine, with the CUDA runtime to name", async () => {
    const plan = await machineBeatPlan(probed(linux([rtx, uhd])), componentsRoot('/u'))();
    const { cudaLibraries, ...devices } = plan;
    expect(devices).toEqual(beatDevicePlan(hostPlatform().name, machineAccelerators(linux([rtx, uhd]))));
    expect(typeof cudaLibraries?.installedRuntime).toBe('function');
  });

  it.runIf(process.platform === 'linux')('puts CUDA first on an NVIDIA Linux machine', async () => {
    const plan = await machineBeatPlan(probed(linux([rtx, uhd])), componentsRoot('/u'))();
    expect(plan.devices).toEqual(['cuda', 'webgpu', 'cpu']);
    expect(plan.cudaDeviceId).toBe(0);
  });

  it('records a forced CPU as disabled', async () => {
    const plan = await machineBeatPlan(probed(linux([], { forcedCpu: true })), componentsRoot('/u'))();
    expect(plan.devices).toEqual(['cpu']);
    expect(plan.cpuReason?.reason).toBe('disabled');
  });
});
