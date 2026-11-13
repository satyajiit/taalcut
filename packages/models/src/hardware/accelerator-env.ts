// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The environment switches the Linux and Windows probes honour (LNX1). The probe takes the environment as a
 * dependency (the desktop passes `process.env`), so tests set it per case and nothing reads `process.env` here.
 *
 * - `TAALCUT_FORCE_CPU=1` (or `true`): every GPU loses its APIs and the machine is marked `forcedCpu`: the CPU-only
 *   gate path, where each CPU choice records the reason `disabled`.
 * - `CUDA_VISIBLE_DEVICES`, as CUDA reads it: a comma-separated list of device indices; the first entry that isn't a
 *   GPU ends the list, so `-1` or an empty value hides every GPU from CUDA. A GPU it hides loses `cuda` (Vulkan
 *   still sees it); a GPU it shows gets its ordinal in the list as `cudaDeviceId`. Indices are nvidia-smi's (PCI
 *   order), which is CUDA's order on one GPU and under `CUDA_DEVICE_ORDER=PCI_BUS_ID`. UUID entries (`GPU-…`,
 *   `MIG-…`) aren't resolved: every GPU then keeps `cuda`, without an ordinal.
 */
import type { GpuInfo } from './types';

export const FORCE_CPU_ENV = 'TAALCUT_FORCE_CPU';
export const CUDA_VISIBLE_DEVICES_ENV = 'CUDA_VISIBLE_DEVICES';

/** The variables a probe reads; `process.env` fits. */
export type ProbeEnv = Readonly<Record<string, string | undefined>>;

export function forceCpuFrom(env: ProbeEnv): boolean {
  return /^(1|true|yes)$/i.test(env[FORCE_CPU_ENV]?.trim() ?? '');
}

/**
 * nvidia-smi index → CUDA ordinal for the GPUs CUDA_VISIBLE_DEVICES shows; `'all'` when it is unset (ordinal =
 * index), `'unresolved'` when it names GPUs by UUID.
 */
export function cudaVisibility(
  value: string | undefined,
  indices: readonly number[],
): ReadonlyMap<number, number> | 'all' | 'unresolved' {
  if (value === undefined) return 'all';
  const visible = new Map<number, number>();
  for (const entry of value.split(',').map((e) => e.trim())) {
    if (/^(GPU|MIG)-/i.test(entry)) return 'unresolved';
    const index = /^\d+$/.test(entry) ? Number(entry) : NaN;
    if (!indices.includes(index) || visible.has(index)) break;
    visible.set(index, visible.size);
  }
  return visible;
}

/** The probed GPUs with the switches applied. */
export function applyAcceleratorEnv(
  gpus: readonly GpuInfo[],
  env: ProbeEnv,
): { readonly gpus: GpuInfo[]; readonly forcedCpu: boolean } {
  if (forceCpuFrom(env)) return { gpus: gpus.map((gpu) => ({ ...gpu, apis: [] })), forcedCpu: true };
  const indices = gpus.flatMap((gpu) =>
    gpu.apis.includes('cuda') && gpu.index !== undefined ? [gpu.index] : [],
  );
  const visibility = cudaVisibility(env[CUDA_VISIBLE_DEVICES_ENV], indices);
  return {
    gpus: gpus.map((gpu) => {
      // Both nvidia-smi queries ask for the index; a GPU without one can't be matched, so it isn't judged.
      if (!gpu.apis.includes('cuda') || gpu.index === undefined || visibility === 'unresolved') return gpu;
      if (visibility === 'all') return { ...gpu, cudaDeviceId: gpu.index };
      const ordinal = visibility.get(gpu.index);
      return ordinal === undefined ? { ...gpu, apis: withoutCuda(gpu) } : { ...gpu, cudaDeviceId: ordinal };
    }),
    forcedCpu: false,
  };
}

const withoutCuda = (gpu: GpuInfo) => gpu.apis.filter((api) => api !== 'cuda');
