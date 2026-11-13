// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which OCR engines a machine gets (IX-O7, LNX1). On a Mac with the helper, Apple Vision reads Latin text and
 * PP-OCRv5 Devanagari reads Hindi (spike 05). Elsewhere (Linux, Windows) PP-OCRv5 reads both, through ONNX Runtime
 * on the first execution provider that opens: CUDA, then DirectML on Windows, then WebGPU, then the CPU with its
 * reason (`createOrtRuntime({ devices: plan.ortDevices })`, which keeps the ones the module lists and goes through
 * media's `selectBackend`, ADR 0002).
 *
 * The rows are per platform, and the probe's accelerators (`MachineAccelerators`) drop the ones this machine can't
 * run: CUDA only where the driver and compute capability fit CUDA 13, WebGPU only with Metal, Vulkan or Direct3D
 * 12, nothing but the CPU when TAALCUT_FORCE_CPU turned the GPUs off. Without a probe the row is tried as it is.
 * onnxruntime-node 1.30's npm build lists CUDA only on Linux x64, so a Windows NVIDIA PC takes DirectML until a
 * CUDA build ships as a component. Not run on Windows hardware.
 */
import type { ComputeBackend } from '@taalcut/core';
import { usableDevices, type MachineAccelerators } from '@taalcut/media';
import { PADDLE_DEVANAGARI, PADDLE_LATIN, type PaddleModel } from './paddle/models';

export interface OcrHost {
  /** `process.platform`. */
  readonly platform: string;
  /** The mac helper (Apple Vision) is installed and runs. */
  readonly helper: boolean;
  /** What the hardware probe found; absent when it failed (the platform's row is tried as it is). */
  readonly accelerators?: MachineAccelerators;
}

export interface OcrBackendPlan {
  /** Who reads Latin languages. */
  readonly latin: 'apple-vision' | PaddleModel;
  readonly devanagari: PaddleModel;
  /** ONNX Runtime execution providers for the PP-OCR sessions, best first. */
  readonly ortDevices: readonly ComputeBackend[];
  /** The CPU was forced (TAALCUT_FORCE_CPU): the runtime records `disabled`. */
  readonly disableGpu: boolean;
}

/** Execution providers by platform, best first (the Windows row is for the port; not run on Windows hardware). */
export const OCR_ORT_DEVICES: Readonly<Record<string, readonly ComputeBackend[]>> = {
  darwin: ['webgpu', 'cpu'],
  win32: ['cuda', 'directml', 'webgpu', 'cpu'],
  linux: ['cuda', 'webgpu', 'cpu'],
};

export function planOcrBackends(host: OcrHost): OcrBackendPlan {
  const rows = OCR_ORT_DEVICES[host.platform] ?? ['webgpu', 'cpu'];
  return {
    latin: host.platform === 'darwin' && host.helper ? 'apple-vision' : PADDLE_LATIN,
    devanagari: PADDLE_DEVANAGARI,
    ortDevices: usableDevices(rows, host.accelerators),
    disableGpu: host.accelerators?.forcedCpu ?? false,
  };
}
