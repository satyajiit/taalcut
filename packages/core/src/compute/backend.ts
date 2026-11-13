// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GPU first (ADR 0002): every compute path runs on a GPU or NPU backend, and
 * on the CPU only when no accelerated path is possible, with the reason
 * recorded. selectBackend makes that choice the same way everywhere; a CPU
 * choice can't be built without a typed fallback reason, and the caller
 * emits it as a `compute.fallback` event so traces show every CPU fallback.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { err, ok, type Result } from '../basics/result';

export const COMPUTE_KINDS = ['gpu', 'npu', 'cpu'] as const;
export type ComputeKind = (typeof COMPUTE_KINDS)[number];

/** Every backend Taalcut may run work on, and what kind of hardware it uses. */
export const COMPUTE_BACKENDS = {
  /** Apple GPU (shaders, MPS). */
  metal: 'gpu',
  /** Apple media engine: hardware video decode and encode. */
  videotoolbox: 'gpu',
  /** Core ML with all compute units: the Neural Engine first, then the GPU. */
  coreml: 'npu',
  /** Apple Neural Engine, addressed directly. */
  ane: 'npu',
  mlx: 'gpu',
  webgpu: 'gpu',
  cuda: 'gpu',
  rocm: 'gpu',
  directml: 'gpu',
  vulkan: 'gpu',
  /** Hardware video encoders: NVIDIA, Intel Quick Sync, AMD, Linux VA-API. */
  nvenc: 'gpu',
  qsv: 'gpu',
  amf: 'gpu',
  vaapi: 'gpu',
  cpu: 'cpu',
} as const satisfies Record<string, ComputeKind>;

export type ComputeBackend = keyof typeof COMPUTE_BACKENDS;
export type AcceleratedBackend = Exclude<ComputeBackend, 'cpu'>;

export const computeBackendSchema = z.enum(
  Object.keys(COMPUTE_BACKENDS) as [ComputeBackend, ...ComputeBackend[]],
);

export function computeKind(backend: ComputeBackend): ComputeKind {
  return COMPUTE_BACKENDS[backend];
}

/**
 * Why work ran on the CPU. Each has a message key `compute.fallback.<reason>`
 * for the UI and traces.
 * - no_accelerator: none of the GPU/NPU backends for this operation exists on this machine.
 * - unsupported_input: the GPU path can't take this input (codec, pixel format, model op).
 * - accelerator_failed: the GPU path was tried and failed at runtime.
 * - out_of_memory: not enough GPU memory for this input.
 * - disabled: the user or a test turned acceleration off.
 */
export const COMPUTE_FALLBACK_REASONS = [
  'no_accelerator',
  'unsupported_input',
  'accelerator_failed',
  'out_of_memory',
  'disabled',
] as const;
export type ComputeFallbackReason = (typeof COMPUTE_FALLBACK_REASONS)[number];

export interface ComputeFallback {
  readonly reason: ComputeFallbackReason;
  /** i18n key: 'compute.fallback.<reason>'. */
  readonly messageKey: string;
  /** Developer detail (the codec, the driver error). Never secrets. */
  readonly detail?: string;
}

export type BackendChoice =
  | {
      readonly backend: AcceleratedBackend;
      readonly kind: Exclude<ComputeKind, 'cpu'>;
      readonly fallback: null;
    }
  | { readonly backend: 'cpu'; readonly kind: 'cpu'; readonly fallback: ComputeFallback };

/** The only way to build a CPU choice: with its reason. */
export function cpuFallback(reason: ComputeFallbackReason, detail?: string): BackendChoice {
  const fallback: ComputeFallback = {
    reason,
    messageKey: `compute.fallback.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  };
  return { backend: 'cpu', kind: 'cpu', fallback };
}

/** No candidate is available and the CPU isn't one of them. */
export const ComputeUnavailable = defineError<{ candidates: string }>('core.compute_unavailable');

export interface SelectBackendOptions {
  /** The reason to record if it comes to the CPU. Default 'no_accelerator'. */
  readonly fallbackReason?: ComputeFallbackReason;
  readonly detail?: string;
}

/**
 * The first available GPU/NPU candidate, in the caller's order of
 * preference. The CPU only if it is a candidate and no accelerated one is
 * available, wherever it appears in the list; it then carries its reason.
 */
export function selectBackend(
  candidates: readonly ComputeBackend[],
  available: Iterable<ComputeBackend> | ((backend: ComputeBackend) => boolean),
  options: SelectBackendOptions = {},
): Result<BackendChoice> {
  const set = typeof available === 'function' ? undefined : new Set(available);
  const has = (backend: ComputeBackend): boolean =>
    set ? set.has(backend) : (available as (backend: ComputeBackend) => boolean)(backend);
  for (const backend of candidates) {
    if (backend === 'cpu' || !has(backend)) continue;
    const kind = COMPUTE_BACKENDS[backend];
    return ok({ backend, kind, fallback: null });
  }
  if (candidates.includes('cpu')) {
    return ok(cpuFallback(options.fallbackReason ?? 'no_accelerator', options.detail));
  }
  return err(ComputeUnavailable({ candidates: candidates.join(', ') }, { detail: options.detail }));
}

/** Payload of the `compute.fallback` event. */
export const computeFallbackEventSchema = z.object({
  /** What ran on the CPU, e.g. 'media.transcode', 'vision.embedFrames'. */
  operation: z.string().min(1).max(128),
  /** The accelerated backends that were wanted, in order. */
  wanted: z.array(computeBackendSchema).max(16),
  reason: z.enum(COMPUTE_FALLBACK_REASONS),
  detail: z.string().max(2000).optional(),
});
export type ComputeFallbackEvent = z.infer<typeof computeFallbackEventSchema>;

/** The event payload for a CPU choice: `bus.emit('compute.fallback', computeFallbackEvent(...))`. */
export function computeFallbackEvent(
  operation: string,
  candidates: readonly ComputeBackend[],
  fallback: ComputeFallback,
): ComputeFallbackEvent {
  return {
    operation,
    wanted: candidates.filter((backend) => backend !== 'cpu'),
    reason: fallback.reason,
    ...(fallback.detail === undefined ? {} : { detail: fallback.detail }),
  };
}
