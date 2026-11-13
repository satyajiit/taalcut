// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where CLAP, AST and their front-end graphs run (EAR1-F4), best first, through media's ONNX runtime: the rows
 * follow Beat This! (beats/devices.ts, ADR 0002). The Mac's row is WebGPU (Metal); Linux takes CUDA on NVIDIA,
 * else WebGPU over Vulkan. A CPU session is logged as `compute.fallback` with one of LISTEN_OPERATIONS.
 */
import type { ComputeFallbackReason } from '@taalcut/core';
import { cpuReasonFor, usableDevices, type LibrarySearch, type MachineAccelerators } from '@taalcut/media';

export type ListenDevice = 'cuda' | 'directml' | 'webgpu' | 'cpu';

/** The `compute.fallback` operations: one per model, and the spectrogram graphs. */
export const LISTEN_OPERATIONS = {
  clapAudio: 'listen.clap.audio',
  clapText: 'listen.clap.text',
  ast: 'listen.ast',
  frontEnd: 'listen.frontend',
} as const;
export type ListenOperation = (typeof LISTEN_OPERATIONS)[keyof typeof LISTEN_OPERATIONS];

export interface ListenDevicePlan {
  readonly devices: readonly ListenDevice[];
  readonly cudaDeviceId?: number;
  /** Why the CPU alone, when the machine runs none of the rows: `disabled` (TAALCUT_FORCE_CPU) or `no_accelerator`. */
  readonly cpuReason?: {
    readonly reason: ComputeFallbackReason;
    readonly detail: string;
    readonly wanted: readonly ListenDevice[];
  };
  readonly cudaLibraries?: LibrarySearch;
}

export const LISTEN_DEVICES: Readonly<Record<string, readonly ListenDevice[]>> = {
  darwin: ['webgpu', 'cpu'],
  win32: ['cuda', 'directml', 'webgpu', 'cpu'],
  linux: ['cuda', 'webgpu', 'cpu'],
};

/** Without a probe: WebGPU, then the CPU. */
export const DEFAULT_LISTEN_PLAN: ListenDevicePlan = { devices: ['webgpu', 'cpu'] };

/** `platform` is `process.platform`; `accelerators` what the probe found (absent: the row as it is). */
export function listenDevicePlan(platform: string, accelerators?: MachineAccelerators): ListenDevicePlan {
  const rows = LISTEN_DEVICES[platform] ?? DEFAULT_LISTEN_PLAN.devices;
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
