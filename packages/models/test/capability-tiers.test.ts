// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-HW: tiers off a Mac follow the GPU (seam 5), the Linux and Windows shortfalls, and CUDA 13's floors.
 * The Apple rules are hardware.test.ts's and don't change.
 */
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  availableBackends,
  cudaRuntimeFits,
  driverMajor,
  nvidiaDriverTooOld,
  usableGpuApis,
  type GpuInfo,
  type HardwareInfo,
} from '@taalcut/models';

const GIB = 1024 ** 3;

const gpu = (change: Partial<GpuInfo> = {}): GpuInfo => ({
  name: 'NVIDIA GeForce RTX 4090',
  vendor: 'nvidia',
  vramBytes: 24 * GIB,
  unifiedMemory: false,
  apis: ['cuda', 'vulkan'],
  driverVersion: '615.71.09',
  computeCapability: '8.9',
  ...change,
});

const linux = (change: Partial<HardwareInfo> = {}): HardwareInfo => ({
  platform: 'linux',
  arch: 'x64',
  chip: 'Intel(R) Core(TM) i9-14900KS',
  memoryBytes: 64 * GIB,
  gpus: [gpu()],
  neuralEngine: false,
  cpuCores: { total: 32, performance: 16, efficiency: 16 },
  freeDiskBytes: 300 * GIB,
  osVersion: '24.04',
  osName: 'Ubuntu 24.04.5 LTS',
  ...change,
});

describe('tiers off a Mac: the GPU decides', () => {
  it.each([
    ['CUDA, 24 GiB, 64 GB', [gpu()], 64, 'high'],
    ['CUDA, 12 GiB (12,288 MiB), 32 GB', [gpu({ vramBytes: 12288 * 1024 ** 2 })], 32, 'high'],
    ['CUDA, 11 GiB, 32 GB', [gpu({ vramBytes: 11 * GIB })], 32, 'recommended'],
    ['CUDA, 24 GiB, but 16 GB of RAM', [gpu()], 16, 'recommended'],
    ['CUDA, 8 GiB (8,188 MiB), 16 GB', [gpu({ vramBytes: 8188 * 1024 ** 2 })], 16, 'recommended'],
    [
      'CUDA, 6 GiB, 32 GB: too little VRAM for the 4B beside the embedder',
      [gpu({ vramBytes: 6 * GIB })],
      32,
      'minimum',
    ],
    ['CUDA, 24 GiB, 12 GB of RAM', [gpu()], 12, 'minimum'],
    [
      'Vulkan only, 24 GiB, 64 GB: no ONNX Runtime GPU for High',
      [gpu({ vendor: 'amd', apis: ['vulkan'] })],
      64,
      'recommended',
    ],
    [
      'DirectML, 16 GiB, 32 GB',
      [gpu({ vendor: 'amd', vramBytes: 16 * GIB, apis: ['directml', 'vulkan'] })],
      32,
      'high',
    ],
    [
      'ROCm, 16 GiB, 32 GB',
      [gpu({ vendor: 'amd', vramBytes: 16 * GIB, apis: ['rocm', 'vulkan'] })],
      32,
      'high',
    ],
    [
      'an iGPU with no VRAM of its own',
      [gpu({ vendor: 'intel', vramBytes: undefined, apis: ['vulkan'] })],
      64,
      'minimum',
    ],
    ['no GPU', [], 64, 'minimum'],
  ] as const)('%s → %s', (_name, gpus, ramGiB, tier) => {
    const info = linux({ gpus: [...gpus], memoryBytes: ramGiB * GIB });
    expect(assessHardware(info).tier).toBe(tier);
    // Windows takes the same rule.
    expect(assessHardware({ ...info, platform: 'win32', osName: 'Microsoft Windows 11 Pro' }).tier).toBe(
      tier,
    );
  });

  it('takes the best GPU, whichever is listed first', () => {
    const igpu = gpu({
      name: 'Intel UHD Graphics 770',
      vendor: 'intel',
      vramBytes: undefined,
      apis: ['vulkan'],
    });
    expect(assessHardware(linux({ gpus: [igpu, gpu()] })).tier).toBe('high');
  });

  it('never raises the Mac shortfalls off a Mac, whatever the chip or version', () => {
    const assessment = assessHardware(linux({ osVersion: '13.0', osName: 'Ubuntu 13.0' }));
    expect(assessment.shortfalls).not.toContain('not_apple_silicon');
    expect(assessment.shortfalls).not.toContain('macos_too_old');
  });

  it('a CUDA GPU on a driver older than 580: gpu_driver_old, no CUDA backend, Vulkan for Recommended', () => {
    const old = linux({ gpus: [gpu({ driverVersion: '570.172.08' })] });
    const assessment = assessHardware(old);
    expect(assessment.shortfalls).toEqual(['gpu_driver_old']);
    expect(assessment.compute.backends).toEqual(['vulkan', 'webgpu', 'cpu']);
    expect(assessment.tier).toBe('recommended');
    // Without Vulkan nothing is left for local models.
    const cudaOnly = assessHardware(linux({ gpus: [gpu({ driverVersion: '570.172.08', apis: ['cuda'] })] }));
    expect(cudaOnly.shortfalls).toEqual(['no_gpu_for_local_models', 'gpu_driver_old']);
    expect(cudaOnly.tier).toBe('minimum');
  });

  it('a GPU older than Turing has no CUDA backend (CUDA 13 dropped sm < 7.5), and no driver shortfall', () => {
    const pascal = linux({
      gpus: [gpu({ name: 'NVIDIA GeForce GTX 1080 Ti', computeCapability: '6.1', vramBytes: 11 * GIB })],
    });
    expect(availableBackends(pascal)).toEqual(['vulkan', 'webgpu', 'cpu']);
    expect(assessHardware(pascal).shortfalls).toEqual([]);
    expect(assessHardware(pascal).tier).toBe('recommended');
  });

  it.each([
    ['Ubuntu 20.04.6 LTS', '20.04', true],
    ['Ubuntu 21.10', '21.10', true],
    ['Ubuntu 22.04.5 LTS', '22.04', false],
    ['Ubuntu 26.04 LTS', '26.04', false],
    // Derivatives number their own releases; other distributions aren't judged.
    ['Linux Mint 21.3', '21.3', false],
    ['Debian GNU/Linux 11 (bullseye)', '11', false],
    ['Fedora Linux 40 (Workstation Edition)', '40', false],
  ] as const)('%s: os_too_old %s', (osName, osVersion, tooOld) => {
    const shortfalls = assessHardware(linux({ osName, osVersion })).shortfalls;
    expect(shortfalls.includes('os_too_old')).toBe(tooOld);
  });

  it('judges no OS on Windows', () => {
    const windows = linux({ platform: 'win32', osName: 'Microsoft Windows 10 Pro', osVersion: '10.0.17763' });
    expect(assessHardware(windows).shortfalls).toEqual([]);
  });
});

describe('CUDA 13 floors', () => {
  it('reads NVIDIA driver majors, and only judges NVIDIA drivers it can read', () => {
    expect(driverMajor('615.71.09')).toBe(615);
    expect(driverMajor('581.57')).toBe(581);
    expect(driverMajor('32.0.15.6094')).toBe(32);
    expect(driverMajor('n/a')).toBeNaN();
    expect(nvidiaDriverTooOld({ vendor: 'nvidia', driverVersion: '579.99' })).toBe(true);
    expect(nvidiaDriverTooOld({ vendor: 'nvidia', driverVersion: '580.65.06' })).toBe(false);
    expect(nvidiaDriverTooOld({ vendor: 'nvidia' })).toBe(false);
    // AMD and Intel versions on Windows are driver store versions: not NVIDIA's numbering.
    expect(nvidiaDriverTooOld({ vendor: 'amd', driverVersion: '31.0.24027.1012' })).toBe(false);
  });

  it('keeps CUDA among the usable APIs only where CUDA 13 runs', () => {
    expect(cudaRuntimeFits(gpu())).toBe(true);
    expect(cudaRuntimeFits(gpu({ computeCapability: '7.5' }))).toBe(true);
    expect(cudaRuntimeFits(gpu({ computeCapability: '12.0' }))).toBe(true);
    expect(cudaRuntimeFits(gpu({ computeCapability: '7.0' }))).toBe(false);
    expect(cudaRuntimeFits(gpu({ computeCapability: undefined }))).toBe(true);
    expect(cudaRuntimeFits(gpu({ apis: ['vulkan'] }))).toBe(false);
    expect(usableGpuApis(gpu({ driverVersion: '560.94', apis: ['cuda', 'directml', 'vulkan'] }))).toEqual([
      'directml',
      'vulkan',
    ]);
  });
});
