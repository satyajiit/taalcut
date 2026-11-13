// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where TransNetV2 runs (IX2-C2, LNX1), by platform, best first: ONNX Runtime keeps the execution providers its
 * module lists and takes the first that opens, and a CPU session goes through media's `selectBackend` with its
 * reason (ADR 0002). The Mac's order is measured (vision SPEC, "Shot boundaries"): WebGPU took 155 ms and
 * 122 ms of CPU time per 100-frame window, the CPU provider 248 ms and 2.3 s of CPU time, and every Core ML
 * setting was slower than the CPU's; WebGPU's predictions match the CPU's to 6.4e-7. Linux takes CUDA on NVIDIA,
 * WebGPU (Vulkan) elsewhere; the Windows row follows the OCR's (ocr/backends.ts) and has not run on that hardware.
 * The probe's accelerators drop the rows the machine can't run; without a probe the row is tried as it is.
 */
import type { ComputeBackend } from '@taalcut/core';
import { usableDevices, type MachineAccelerators } from '@taalcut/media';

/** Where the mac helper runs TransNetV2 on Core ML first (IX2-S10), before the ONNX process. */
const CORE_ML_PLATFORMS: ReadonlySet<string> = new Set(['darwin']);

/** Whether `platform` tries the Core ML model in the mac helper first. */
export function shotModelOnCoreMl(platform: string): boolean {
  return CORE_ML_PLATFORMS.has(platform);
}

export const SHOT_MODEL_DEVICES: Readonly<Record<string, readonly ComputeBackend[]>> = {
  darwin: ['webgpu', 'cpu'],
  win32: ['cuda', 'directml', 'webgpu', 'cpu'],
  linux: ['cuda', 'webgpu', 'cpu'],
};

/** What the model's process opens TransNetV2 with: the jobs process has the probe, the model's process doesn't. */
export interface ShotModelRuntime {
  readonly devices: readonly ComputeBackend[];
  /** The CUDA session's device (the probe's CUDA ordinal). */
  readonly cudaDeviceId?: number;
  /** TAALCUT_FORCE_CPU: the CPU, recorded as `disabled`. */
  readonly disableGpu?: boolean;
}

/** `platform` is `process.platform`; `accelerators` what the probe found (absent: the row as it is). */
export function shotModelDevices(
  platform: string,
  accelerators?: MachineAccelerators,
): readonly ComputeBackend[] {
  return usableDevices(SHOT_MODEL_DEVICES[platform] ?? ['cpu'], accelerators);
}

export function shotModelRuntime(platform: string, accelerators?: MachineAccelerators): ShotModelRuntime {
  const devices = shotModelDevices(platform, accelerators);
  const cudaDeviceId = accelerators?.cudaDeviceId;
  return {
    devices,
    ...(devices.includes('cuda') && cudaDeviceId !== undefined ? { cudaDeviceId } : {}),
    ...(accelerators?.forcedCpu ? { disableGpu: true } : {}),
  };
}
