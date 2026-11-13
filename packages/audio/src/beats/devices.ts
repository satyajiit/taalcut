// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where Beat This! and its log-mel front end run (LNX1), best first, through media's ONNX runtime: the first
 * execution provider that opens, the CPU with its reason (ADR 0002). The Mac's row is WebGPU (Metal); Linux takes
 * CUDA on NVIDIA, else WebGPU over Vulkan; the Windows row follows vision's OCR and has not run on that hardware.
 * The probe's accelerators drop the rows the machine can't run; without a probe the runtime keeps WebGPU, then the
 * CPU, as before.
 */
import { cpuReasonFor, usableDevices, type MachineAccelerators } from '@taalcut/media';
import type { BeatDevice, BeatDevicePlan } from './types';

export const BEAT_DEVICES: Readonly<Record<string, readonly BeatDevice[]>> = {
  darwin: ['webgpu', 'cpu'],
  win32: ['cuda', 'directml', 'webgpu', 'cpu'],
  linux: ['cuda', 'webgpu', 'cpu'],
};

/** What a runtime without a plan opens on (the Mac's measured order). */
export const DEFAULT_BEAT_PLAN: BeatDevicePlan = { devices: ['webgpu', 'cpu'] };

/** `platform` is `process.platform`; `accelerators` what the probe found (absent: the row as it is). */
export function beatDevicePlan(platform: string, accelerators?: MachineAccelerators): BeatDevicePlan {
  const rows = BEAT_DEVICES[platform] ?? DEFAULT_BEAT_PLAN.devices;
  const devices = usableDevices(rows, accelerators);
  const cudaDeviceId = accelerators?.cudaDeviceId;
  const wanted = rows.filter((row) => row !== 'cpu');
  return {
    devices,
    ...(devices.includes('cuda') && cudaDeviceId !== undefined ? { cudaDeviceId } : {}),
    ...(devices.every((device) => device === 'cpu')
      ? { cpuReason: { ...cpuReasonFor(rows, accelerators), wanted } }
      : {}),
  };
}
