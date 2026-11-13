// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CUDA as Taalcut ships it (LNX1, plan/linux-round-1.md): ONNX Runtime 1.30's CUDA provider links cudart 13, and the
 * `cuda-runtime-13` component carries CUDA 13 libraries. CUDA 13 needs an NVIDIA driver of 580 or later and a GPU
 * of compute capability 7.5 (Turing) or newer. The probe reports `cuda` wherever the driver offers it; these floors
 * decide whether Taalcut's runtimes can use it (`availableBackends`, the tier rules, `gpu_driver_old`).
 */
import type { GpuSetup, GpuSetupState } from '@taalcut/core';
import type { GpuInfo } from './types';

export const CUDA_FLOOR = {
  /** NVIDIA driver major version (CUDA 13's minimum, Linux 580.65.06). */
  driverMajor: 580,
  /** sm_75: CUDA 13 dropped Maxwell, Pascal and Volta. */
  computeCapability: 7.5,
} as const;

/** '615.71.09' → 615; NaN when it isn't NVIDIA's numbering. */
export function driverMajor(version: string): number {
  const match = /^(\d+)\.\d+/.exec(version);
  return match ? Number(match[1]) : NaN;
}

/** An NVIDIA driver too old for CUDA 13. Unknown versions aren't judged. */
export function nvidiaDriverTooOld(gpu: Pick<GpuInfo, 'vendor' | 'driverVersion'>): boolean {
  if (gpu.vendor !== 'nvidia' || gpu.driverVersion === undefined) return false;
  const major = driverMajor(gpu.driverVersion);
  return Number.isFinite(major) && major < CUDA_FLOOR.driverMajor;
}

/** '8.9' → true; unknown capabilities aren't judged (the driver floor already covers pre-R510 drivers). */
export function capabilityFits(capability: string | undefined): boolean {
  if (capability === undefined) return true;
  const [major = 0, minor = 0] = capability.split('.').map(Number);
  return major * 10 + minor >= CUDA_FLOOR.computeCapability * 10;
}

/** The GPU offers CUDA and Taalcut's CUDA 13 runtimes can run on it. */
export function cudaRuntimeFits(gpu: GpuInfo): boolean {
  return gpu.apis.includes('cuda') && !nvidiaDriverTooOld(gpu) && capabilityFits(gpu.computeCapability);
}

/** The GPU's APIs Taalcut's runtimes can use: `cuda` only where CUDA 13 runs. */
export function usableGpuApis(gpu: GpuInfo): GpuInfo['apis'] {
  return cudaRuntimeFits(gpu) ? gpu.apis : gpu.apis.filter((api) => api !== 'cuda');
}

/** What the desktop knows of the CUDA runtime component here. */
export interface CudaRuntimeFacts {
  /** The registry has it, its folder on disk. */
  readonly installed: boolean;
  /** NVIDIA's terms for it are accepted (the library's acknowledgement). */
  readonly termsAccepted: boolean;
  /** Every library the CUDA builds load from it is in its folder. Default true. */
  readonly intact?: boolean;
  /** Its library folder is on the loader path this process started with. Default true. */
  readonly loaded?: boolean;
}

/** The NVIDIA GPU the CUDA builds would run on. */
function cudaCandidate(gpus: readonly GpuInfo[]): GpuInfo | undefined {
  const nvidia = gpus.filter((gpu) => gpu.vendor === 'nvidia');
  return nvidia.find(cudaRuntimeFits) ?? nvidia.find((gpu) => gpu.apis.includes('cuda')) ?? nvidia[0];
}

function stateOf(gpu: GpuInfo, runtime: CudaRuntimeFacts): GpuSetupState {
  if (!gpu.apis.includes('cuda')) return 'no_driver';
  if (nvidiaDriverTooOld(gpu)) return 'driver_old';
  if (!capabilityFits(gpu.computeCapability)) return 'gpu_too_old';
  if (!runtime.installed) return 'runtime_missing';
  if (runtime.intact === false) return 'runtime_damaged';
  if (runtime.loaded === false) return 'restart_needed';
  return 'ready';
}

/**
 * What an NVIDIA GPU still needs before Taalcut's CUDA builds can use it (LNX1-TRM): the NVIDIA GPU setup card in
 * first run and Settings reads it from the hardware report (core's gpuSetupSchema). One derivation, from the probe
 * (the CUDA floors above) and the facts about the `cuda-runtime-13` component the desktop reads from its
 * registry and environment; never guessed in the window.
 *
 * Worst first, for the GPU CUDA would run on (the first that fits, else the first NVIDIA driver lists, else the
 * first NVIDIA GPU the kernel sees):
 * - `no_driver`: the kernel lists an NVIDIA GPU (PCI vendor 0x10de) but nvidia-smi doesn't (nouveau, or none);
 * - `driver_old`: NVIDIA's driver is below CUDA 13's 580 (the `gpu_driver_old` shortfall);
 * - `gpu_too_old`: compute capability below 7.5 (before Turing);
 * - `runtime_missing`: NVIDIA's CUDA libraries aren't installed (their terms not accepted, or not downloaded yet);
 * - `runtime_damaged`: installed, but libraries the CUDA builds load are missing from its folder;
 * - `restart_needed`: installed since the app's processes started, so the loader didn't see it (used from the
 *   next start);
 * - `ready`.
 *
 * Undefined without an NVIDIA GPU.
 */
export function nvidiaGpuSetup(gpus: readonly GpuInfo[], runtime: CudaRuntimeFacts): GpuSetup | undefined {
  const gpu = cudaCandidate(gpus);
  if (!gpu) return undefined;
  return {
    state: stateOf(gpu, runtime),
    gpuName: gpu.name,
    ...(gpu.driverVersion === undefined ? {} : { driverVersion: gpu.driverVersion }),
    minDriver: String(CUDA_FLOOR.driverMajor),
    ...(gpu.computeCapability === undefined ? {} : { computeCapability: gpu.computeCapability }),
    minComputeCapability: CUDA_FLOOR.computeCapability.toFixed(1),
    ...(gpu.kernelDriver === undefined ? {} : { kernelDriver: gpu.kernelDriver }),
    termsAccepted: runtime.termsAccepted,
  };
}
