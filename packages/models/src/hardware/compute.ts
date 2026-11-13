// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a local model runs (ADR 0002, GPU first). Each local model lists the
 * backends its runtime supports, accelerated ones first; the machine offers
 * the backends its hardware has; the first match wins. The CPU is chosen only
 * when nothing accelerated matches, and the choice then carries the reason.
 */
import type { ComputeBackend as CoreComputeBackend } from '@taalcut/core';
import { usableGpuApis } from './cuda';
import type { HardwareInfo } from './types';

/** The backends model runtimes use, spelled as core's compute backends (a misspelling fails to compile). */
export const COMPUTE_BACKENDS = [
  'metal',
  'mlx',
  'coreml',
  'ane',
  'webgpu',
  'cuda',
  'rocm',
  'directml',
  'vulkan',
  'cpu',
] as const satisfies readonly CoreComputeBackend[];
export type ComputeBackend = (typeof COMPUTE_BACKENDS)[number];

/** Why a CPU path was chosen; logged and shown next to the model. */
export type CpuFallbackReason =
  /** The model's runtime has no accelerated backend at all. */
  | 'no_accelerated_backend'
  /** It has some, but this machine offers none of them. */
  | 'hardware_lacks_backend'
  /** A GPU backend was expected, but the runtime ended up on the CPU (driver or memory failure). */
  | 'gpu_failed_at_runtime'
  /** TAALCUT_FORCE_CPU turned the GPUs off (the probe's `forcedCpu`): `compute.fallback.disabled`. */
  | 'disabled';

export interface ComputeChoice {
  readonly backend: ComputeBackend;
  /** On a GPU or the Neural Engine. */
  readonly accelerated: boolean;
  /** Set only for a CPU choice. */
  readonly cpuReason?: CpuFallbackReason;
  /** i18n key for Settings → About and the model picker, e.g. "GPU (Metal)" or "CPU, slower". */
  readonly labelKey: string;
}

export function isAccelerated(backend: ComputeBackend): boolean {
  return backend !== 'cpu';
}

/**
 * The backends this machine offers for model inference, accelerated first.
 * Metal and MLX count only on Apple GPUs: Ollama, llama.cpp and MLX don't
 * accelerate on Intel Macs' AMD or Intel GPUs. CUDA counts only where
 * Taalcut's CUDA 13 runtimes run (cuda.ts: driver 580+, compute capability
 * 7.5+). WebGPU (ONNX Runtime's execution provider, through Dawn) counts where a
 * GPU offers Metal, Vulkan or Direct3D 12 (DirectML's API). A forced-CPU machine
 * (TAALCUT_FORCE_CPU) has its GPUs' APIs removed by the probe, so it offers the
 * CPU alone.
 */
export function availableBackends(info: HardwareInfo): readonly ComputeBackend[] {
  if (info.forcedCpu) return ['cpu'];
  const apis = new Set(info.gpus.flatMap(usableGpuApis));
  const appleGpu = info.gpus.some((g) => g.vendor === 'apple' && g.apis.includes('metal'));
  const out: ComputeBackend[] = [];
  if (appleGpu) out.push('metal', 'mlx');
  if (info.platform === 'darwin') out.push('coreml');
  if (info.neuralEngine) out.push('ane');
  for (const api of ['cuda', 'rocm', 'directml', 'vulkan'] as const) if (apis.has(api)) out.push(api);
  if (apis.has('metal') || apis.has('vulkan') || apis.has('directml')) out.push('webgpu');
  out.push('cpu');
  return out;
}

export interface SelectComputeOptions {
  /** TAALCUT_FORCE_CPU (the probe's `forcedCpu`): a CPU choice says `disabled`, not that the GPU lacks support. */
  readonly forcedCpu?: boolean;
}

/** The first backend the model supports that the machine offers. */
export function selectCompute(
  supported: readonly ComputeBackend[],
  available: readonly ComputeBackend[],
  options: SelectComputeOptions = {},
): ComputeChoice {
  const offered = new Set(options.forcedCpu ? ['cpu' as const] : available);
  const backend = supported.find((b) => offered.has(b)) ?? 'cpu';
  if (isAccelerated(backend)) return { backend, accelerated: true, labelKey: `models.compute.${backend}` };
  const cpuReason: CpuFallbackReason = !supported.some(isAccelerated)
    ? 'no_accelerated_backend'
    : options.forcedCpu
      ? 'disabled'
      : 'hardware_lacks_backend';
  return { backend: 'cpu', accelerated: false, cpuReason, labelKey: 'models.compute.cpu' };
}
