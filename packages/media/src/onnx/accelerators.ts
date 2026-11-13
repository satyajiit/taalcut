// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The machine's accelerators as the packages under `@taalcut/models` read them (LNX1 seam 1: device lists come
 * from the probe, not `process.platform` alone). The desktop builds one from models' HardwareInfo: the GPU APIs
 * Taalcut's runtimes can use (`usableGpuApis`, so CUDA only where CUDA 13 runs), the CUDA ordinal, the VRAM it can
 * plan on and whether TAALCUT_FORCE_CPU turned the GPUs off. Vision's OCR, embedding and shot-model planners and
 * audio's beat and speech planners all take it. It lives here, beside the ONNX runtime vision and audio share,
 * because audio can't import models.
 *
 * Each planner keeps a table of rows per platform, best first (with a `win32` row for the Windows port), and
 * `usableDevices` drops the rows this machine can't run. Without a description (the probe failed) the table is
 * used as it is and the runtimes find out for themselves, each step logged (ADR 0002: never the CPU because a
 * probe failed).
 */
import type { ComputeBackend, ComputeFallbackReason } from '@taalcut/core';

/** GPU programming interfaces, as models' GPU_APIS names them. */
export type AcceleratorApi = 'metal' | 'cuda' | 'rocm' | 'directml' | 'vulkan';

export interface MachineAccelerators {
  /** `process.platform`. */
  readonly platform: string;
  /** The APIs Taalcut's runtimes can use on any of the machine's GPUs, the primary GPU's first. */
  readonly apis: readonly AcceleratorApi[];
  /** The primary GPU's vendor, e.g. 'nvidia'. */
  readonly vendor?: string;
  /** The CUDA ordinal of the GPU CUDA work goes to (CUDA_VISIBLE_DEVICES applied): ONNX Runtime's `device_id`. */
  readonly cudaDeviceId?: number;
  /** Video memory Taalcut can plan on (free when the probe ran) on a GPU with memory of its own. */
  readonly vramBytes?: number;
  /** TAALCUT_FORCE_CPU: every GPU API is off, and a CPU choice records `disabled`. */
  readonly forcedCpu: boolean;
}

/** WebGPU runs on Dawn, which needs Metal, Vulkan or Direct3D 12 (DirectML's API). */
const WEBGPU_APIS: readonly AcceleratorApi[] = ['metal', 'vulkan', 'directml'];

/** Whether this machine can run `backend`; true for every backend when nothing is known. */
export function canRun(backend: ComputeBackend, machine: MachineAccelerators | undefined): boolean {
  if (backend === 'cpu' || !machine) return true;
  if (machine.forcedCpu) return false;
  const has = (api: AcceleratorApi) => machine.apis.includes(api);
  switch (backend) {
    case 'webgpu':
      return WEBGPU_APIS.some(has);
    case 'coreml':
    case 'ane':
      return machine.platform === 'darwin';
    case 'metal':
    case 'cuda':
    case 'rocm':
    case 'directml':
    case 'vulkan':
      return has(backend);
    default:
      return false;
  }
}

/** The rows of a planner's table this machine can run, in the table's order. */
export function usableDevices<T extends ComputeBackend>(
  rows: readonly T[],
  machine: MachineAccelerators | undefined,
): T[] {
  return rows.filter((row) => canRun(row, machine));
}

/** Why the CPU when `usableDevices` left no accelerated row: `disabled` on a forced-CPU machine. */
export function cpuReasonFor(
  rows: readonly ComputeBackend[],
  machine: MachineAccelerators | undefined,
): { readonly reason: ComputeFallbackReason; readonly detail: string } {
  const wanted = rows.filter((row) => row !== 'cpu');
  if (machine?.forcedCpu) return { reason: 'disabled', detail: 'TAALCUT_FORCE_CPU turned the GPUs off' };
  const apis = machine?.apis.length ? machine.apis.join(', ') : 'none';
  return { reason: 'no_accelerator', detail: `no GPU API for ${wanted.join(', ')} (usable: ${apis})` };
}
