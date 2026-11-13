// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: what an NVIDIA GPU still needs before the CUDA builds can use it, derived once from the probe and the
 * CUDA runtime component's facts (the NVIDIA GPU setup card shows it). Each state from the GPUs the Linux probe
 * reports: DRM's NVIDIA device without nvidia-smi (nouveau), a 550 driver, a Pascal card, then the runtime.
 */
import { describe, expect, it } from 'vitest';
import { nvidiaGpuSetup, type CudaRuntimeFacts, type GpuInfo } from '@taalcut/models';

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
/** What linuxGpus makes of an NVIDIA card bound to nouveau: DRM's device, pci.ids' name, no nvidia-smi row. */
const NOUVEAU: GpuInfo = {
  name: 'NVIDIA GA102 [GeForce RTX 3080]',
  vendor: 'nvidia',
  unifiedMemory: false,
  apis: ['vulkan'],
  kernelDriver: 'nouveau',
};
const INTEL_IGPU: GpuInfo = {
  name: 'Intel UHD Graphics 770',
  vendor: 'intel',
  unifiedMemory: false,
  apis: ['vulkan'],
  kernelDriver: 'i915',
};
const NONE: CudaRuntimeFacts = { installed: false, termsAccepted: false };
const HERE: CudaRuntimeFacts = { installed: true, termsAccepted: true };

describe('the NVIDIA GPU setup', () => {
  it('is absent without an NVIDIA GPU', () => {
    expect(nvidiaGpuSetup([INTEL_IGPU], NONE)).toBeUndefined();
    expect(nvidiaGpuSetup([], NONE)).toBeUndefined();
  });

  it('asks for NVIDIA’s driver when the kernel sees the GPU but no NVIDIA driver is loaded', () => {
    expect(nvidiaGpuSetup([NOUVEAU, INTEL_IGPU], NONE)).toEqual({
      state: 'no_driver',
      gpuName: 'NVIDIA GA102 [GeForce RTX 3080]',
      minDriver: '580',
      minComputeCapability: '7.5',
      kernelDriver: 'nouveau',
      termsAccepted: false,
    });
    const unbound: GpuInfo = { ...NOUVEAU, apis: [], kernelDriver: undefined } as GpuInfo;
    expect(nvidiaGpuSetup([unbound], NONE)?.state).toBe('no_driver');
  });

  it('asks for a newer driver below 580, with the installed version', () => {
    const old = { ...RTX_4090, driverVersion: '550.120' };
    expect(nvidiaGpuSetup([old], NONE)).toMatchObject({
      state: 'driver_old',
      driverVersion: '550.120',
      minDriver: '580',
    });
  });

  it('says a GPU before Turing is too old for CUDA 13', () => {
    const pascal = { ...RTX_4090, name: 'NVIDIA GeForce GTX 1080', computeCapability: '6.1' };
    expect(nvidiaGpuSetup([pascal], HERE)).toMatchObject({
      state: 'gpu_too_old',
      computeCapability: '6.1',
      minComputeCapability: '7.5',
    });
    // A second GPU that fits is the one CUDA runs on.
    expect(nvidiaGpuSetup([pascal, RTX_4090], HERE)?.gpuName).toBe('NVIDIA GeForce RTX 4090');
  });

  it('follows the CUDA runtime once the GPU and driver fit', () => {
    expect(nvidiaGpuSetup([RTX_4090], NONE)).toMatchObject({
      state: 'runtime_missing',
      termsAccepted: false,
    });
    expect(nvidiaGpuSetup([RTX_4090], { installed: false, termsAccepted: true })).toMatchObject({
      state: 'runtime_missing',
      termsAccepted: true,
    });
    expect(nvidiaGpuSetup([RTX_4090], { ...HERE, intact: false })?.state).toBe('runtime_damaged');
    expect(nvidiaGpuSetup([RTX_4090], { ...HERE, loaded: false })?.state).toBe('restart_needed');
    expect(nvidiaGpuSetup([RTX_4090], { ...HERE, intact: false, loaded: false })?.state).toBe(
      'runtime_damaged',
    );
    expect(nvidiaGpuSetup([RTX_4090], HERE)).toMatchObject({ state: 'ready', driverVersion: '615.71.09' });
  });
});
