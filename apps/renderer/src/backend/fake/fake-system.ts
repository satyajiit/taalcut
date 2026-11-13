// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, ids, people's requests), never UI copy */

/**
 * Fake hardware probe results and the component list. The machines (`system` in `taalcut.fake`): the Mac the app
 * was built on (an M2 Pro with 16 GB), and Linux ones from LNX1: the RTX 4090 host as its probe reports it, and
 * the same host with the GPU hidden (CUDA_VISIBLE_DEVICES=-1), CPU only, and NVIDIA GPUs CUDA can't use; and UX3's
 * AMD and Intel machines. What each runs its models on is fake-compute.ts.
 */
import type { Component, GpuSetup, HardwareReport, HardwareTier } from '@taalcut/core';
import type { HostPlatform } from '@taalcut/ui';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const FAKE_SYSTEMS = [
  'mac',
  'linux-nvidia',
  'linux-cpu',
  // LNX1-TRM: NVIDIA machines whose GPU setup asks for something (the NVIDIA GPU setup card).
  'linux-nvidia-old-driver',
  'linux-nouveau',
  'linux-pascal',
  // UX3: the other makers' chips, for the hardware step's marks: an AMD desktop, and an Intel laptop.
  'linux-amd',
  'linux-intel',
] as const;
export type FakeSystem = (typeof FAKE_SYSTEMS)[number];

export const FAKE_HARDWARE: HardwareReport = {
  info: {
    platform: 'darwin',
    arch: 'arm64',
    chip: 'Apple M2 Pro',
    machineModel: 'Mac14,9',
    memoryBytes: 16 * GB,
    gpuCores: 16,
    cpuCores: { total: 10, performance: 6, efficiency: 4 },
    freeDiskBytes: 182.4 * GB,
    osVersion: '26.0.1',
  },
  // 16 GB but not 32: Recommended (models' assessHardware).
  tier: 'recommended',
  shortfalls: [],
  labelKey: 'models.tier.recommended.label',
  shortfallKeys: [],
};

/** The LNX1 host: Ubuntu 24.04, an RTX 4090 (driver 615.71.09) beside the Intel iGPU, 64 GB. Tier high. */
export const LINUX_NVIDIA_HARDWARE: HardwareReport = {
  info: {
    platform: 'linux',
    arch: 'x64',
    chip: '13th Gen Intel(R) Core(TM) i9-13900K',
    memoryBytes: 64 * GB,
    cpuCores: { total: 32 },
    freeDiskBytes: 1412.5 * GB,
    osVersion: '24.04',
    osName: 'Ubuntu 24.04.5 LTS',
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        vramBytes: 24 * GB,
        driverVersion: '615.71.09',
        apis: ['cuda', 'vulkan'],
      },
      { name: 'Intel UHD Graphics 770', vendor: 'intel', apis: ['vulkan'] },
    ],
  },
  tier: 'high',
  shortfalls: [],
  labelKey: 'models.tier.high.label',
  shortfallKeys: [],
};

/** The same host with CUDA_VISIBLE_DEVICES=-1: no GPU for models, tier minimum. */
export const LINUX_CPU_HARDWARE: HardwareReport = {
  info: { ...LINUX_NVIDIA_HARDWARE.info, gpus: [] },
  tier: 'minimum',
  shortfalls: ['no_gpu_for_local_models'],
  labelKey: 'models.tier.minimum.label',
  shortfallKeys: ['models.hardware.no_gpu_for_local_models'],
};

/** What a GPU setup on CUDA 13's floors says of an NVIDIA GPU (models' nvidiaGpuSetup). */
const setupOf = (setup: Pick<GpuSetup, 'state' | 'gpuName'> & Partial<GpuSetup>): GpuSetup => ({
  minDriver: '580',
  minComputeCapability: '7.5',
  termsAccepted: false,
  ...setup,
});
const IGPU = { name: 'Intel UHD Graphics 770', vendor: 'intel', apis: ['vulkan'] } as const;

/** An RTX 3060 on driver 550: CUDA 13 needs 580, so models run on Vulkan; Recommended with gpu_driver_old. */
export const LINUX_OLD_DRIVER_HARDWARE: HardwareReport = {
  info: {
    ...LINUX_NVIDIA_HARDWARE.info,
    memoryBytes: 32 * GB,
    gpus: [
      {
        name: 'NVIDIA GeForce RTX 3060',
        vendor: 'nvidia',
        vramBytes: 12 * GB,
        driverVersion: '550.120',
        apis: ['cuda', 'vulkan'],
      },
      { ...IGPU, apis: [...IGPU.apis] },
    ],
  },
  tier: 'recommended',
  shortfalls: ['gpu_driver_old'],
  labelKey: 'models.tier.recommended.label',
  shortfallKeys: ['models.hardware.gpu_driver_old'],
  gpuSetup: setupOf({
    state: 'driver_old',
    gpuName: 'NVIDIA GeForce RTX 3060',
    driverVersion: '550.120',
    computeCapability: '8.6',
    kernelDriver: 'nvidia',
  }),
};

/** An RTX 3080 on nouveau: the kernel lists it, nvidia-smi doesn't run, so no CUDA; Vulkan through Mesa. */
export const LINUX_NOUVEAU_HARDWARE: HardwareReport = {
  info: {
    ...LINUX_NVIDIA_HARDWARE.info,
    gpus: [
      { name: 'NVIDIA GA102 [GeForce RTX 3080]', vendor: 'nvidia', apis: ['vulkan'] },
      { ...IGPU, apis: [...IGPU.apis] },
    ],
  },
  tier: 'minimum',
  shortfalls: [],
  labelKey: 'models.tier.minimum.label',
  shortfallKeys: [],
  gpuSetup: setupOf({
    state: 'no_driver',
    gpuName: 'NVIDIA GA102 [GeForce RTX 3080]',
    kernelDriver: 'nouveau',
  }),
};

/** A GTX 1080 (Pascal, compute capability 6.1): CUDA 13 dropped it, so Vulkan. */
export const LINUX_PASCAL_HARDWARE: HardwareReport = {
  info: {
    ...LINUX_NVIDIA_HARDWARE.info,
    memoryBytes: 32 * GB,
    gpus: [
      {
        name: 'NVIDIA GeForce GTX 1080',
        vendor: 'nvidia',
        vramBytes: 8 * GB,
        driverVersion: '580.95.05',
        apis: ['cuda', 'vulkan'],
      },
    ],
  },
  tier: 'recommended',
  shortfalls: [],
  labelKey: 'models.tier.recommended.label',
  shortfallKeys: [],
  gpuSetup: setupOf({
    state: 'gpu_too_old',
    gpuName: 'NVIDIA GeForce GTX 1080',
    driverVersion: '580.95.05',
    computeCapability: '6.1',
    kernelDriver: 'nvidia',
  }),
};

/** An AMD desktop on Ubuntu (UX3): a Ryzen 9 7950X and a Radeon RX 7900 XTX, on Vulkan (no CUDA). */
export const LINUX_AMD_HARDWARE: HardwareReport = {
  info: {
    platform: 'linux',
    arch: 'x64',
    chip: 'AMD Ryzen 9 7950X 16-Core Processor',
    memoryBytes: 64 * GB,
    cpuCores: { total: 32 },
    freeDiskBytes: 912.3 * GB,
    osVersion: '24.04',
    osName: 'Ubuntu 24.04.3 LTS',
    gpus: [{ name: 'AMD Radeon RX 7900 XTX', vendor: 'amd', vramBytes: 24 * GB, apis: ['rocm', 'vulkan'] }],
  },
  tier: 'high',
  shortfalls: [],
  labelKey: 'models.tier.high.label',
  shortfallKeys: [],
};

/** An Intel laptop on Ubuntu (UX3): a Core Ultra 7 155H and its Arc graphics, 32 GB shared. */
export const LINUX_INTEL_HARDWARE: HardwareReport = {
  info: {
    platform: 'linux',
    arch: 'x64',
    chip: 'Intel(R) Core(TM) Ultra 7 155H',
    memoryBytes: 32 * GB,
    cpuCores: { total: 22 },
    freeDiskBytes: 341.8 * GB,
    osVersion: '24.04',
    osName: 'Ubuntu 24.04.3 LTS',
    gpus: [{ name: 'Intel Arc Graphics', vendor: 'intel', apis: ['vulkan'] }],
  },
  tier: 'recommended',
  shortfalls: [],
  labelKey: 'models.tier.recommended.label',
  shortfallKeys: [],
};

const HARDWARE: Readonly<Record<FakeSystem, HardwareReport>> = {
  mac: FAKE_HARDWARE,
  'linux-nvidia': LINUX_NVIDIA_HARDWARE,
  'linux-cpu': LINUX_CPU_HARDWARE,
  'linux-nvidia-old-driver': LINUX_OLD_DRIVER_HARDWARE,
  'linux-nouveau': LINUX_NOUVEAU_HARDWARE,
  'linux-pascal': LINUX_PASCAL_HARDWARE,
  'linux-amd': LINUX_AMD_HARDWARE,
  'linux-intel': LINUX_INTEL_HARDWARE,
};

/** The OS the preview shows for a fake machine. */
export const fakeSystemPlatform = (system: FakeSystem): HostPlatform => (system === 'mac' ? 'mac' : 'linux');

/** What a test or the preview changes about the probe: the machine, its tier (its words differ), the free space. */
export interface FakeHardwareOptions {
  readonly system?: FakeSystem;
  readonly tier?: HardwareTier;
  readonly freeDiskBytes?: number;
  /** The probe fails (models.hardware_probe_failed), as on a machine it can't read. */
  readonly failing?: boolean;
}

export function fakeHardware(options: FakeHardwareOptions = {}): HardwareReport {
  const base = HARDWARE[options.system ?? 'mac'];
  const tier = options.tier ?? base.tier;
  return {
    ...base,
    info: { ...base.info, freeDiskBytes: options.freeDiskBytes ?? base.info.freeDiskBytes },
    tier,
    labelKey: `models.tier.${tier}.label`,
  };
}

/** `system` from `taalcut.fake`, for the preview's backend and its services alike. */
export function fakeSystemFromStorage(storage: Pick<Storage, 'getItem'> = window.localStorage): FakeSystem {
  try {
    const raw: unknown = JSON.parse(storage.getItem('taalcut.fake') ?? '{}');
    const system = raw && typeof raw === 'object' ? (raw as { system?: unknown }).system : undefined;
    return FAKE_SYSTEMS.includes(system as FakeSystem) ? (system as FakeSystem) : 'mac';
  } catch {
    return 'mac';
  }
}

export const FAKE_COMPONENTS: readonly Component[] = [
  // The bundled local model (tools/components/manifest.local-llm.provisional.json).
  {
    id: 'local-llm-runtime',
    name: 'llama.cpp server',
    version: 'b11571',
    licence: 'MIT',
    sizeBytes: 11.6 * MB,
    status: 'installed',
    notice: true,
    usedBy: ['agent', 'vision'],
  },
  {
    id: 'local-llm-qwen3-5-4b',
    name: 'Qwen3.5 4B',
    version: 'q4_k_m-a9d0a3e1',
    licence: 'Apache-2.0',
    sizeBytes: 2.47 * GB,
    status: 'installed',
    notice: true,
    usedBy: ['agent', 'vision'],
  },
  {
    id: 'local-llm-qwen3-5-4b-mmproj',
    name: 'Qwen3.5 4B vision projector',
    version: 'bf16-e56a899b',
    licence: 'Apache-2.0',
    sizeBytes: 644 * MB,
    status: 'installed',
    notice: true,
    usedBy: ['vision'],
  },
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    version: '8.0',
    licence: 'LGPL-2.1-or-later',
    sizeBytes: 92 * MB,
    status: 'installed',
    notice: true,
    usedBy: [],
  },
  {
    id: 'embeddinggemma-2',
    name: 'EmbeddingGemma 2',
    version: '2.0.0',
    licence: 'Apache-2.0',
    sizeBytes: 1.42 * GB,
    status: 'installed',
    notice: true,
    usedBy: ['embeddings'],
  },
  {
    id: 'parakeet-tdt-0.6b-v3',
    name: 'Parakeet TDT 0.6B v3',
    version: '3.0',
    licence: 'CC-BY-4.0',
    sizeBytes: 640 * MB,
    status: 'downloading',
    progress: 0.42,
    usedBy: ['speech'],
  },
  {
    id: 'sqlite-vec',
    name: 'sqlite-vec',
    version: '0.2.1',
    licence: 'Apache-2.0',
    sizeBytes: 1.1 * MB,
    status: 'update-available',
    notice: true,
    usedBy: ['embeddings'],
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper large-v3 turbo',
    version: '1.7.6',
    licence: 'MIT',
    sizeBytes: 1.62 * GB,
    status: 'not-installed',
    usedBy: ['speech'],
  },
];
