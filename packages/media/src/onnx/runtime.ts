// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared ONNX sessions. The caller's accelerated candidates in order (default
 * WebGPU), each tried once; the CPU execution provider only when none can be
 * created, with `accelerator_failed` (or `out_of_memory`) and every device's
 * failure in the detail. A device that fails before another accelerated one
 * opens is reported through `onDeviceFailed` (logged by default): the session
 * then says which backend it got. Core ML is never a default candidate.
 *
 * CUDA (LNX1): the provider takes the probe's `deviceId`, the only CUDA option
 * onnxruntime-node 1.30's binding reads (`ParseExecutionProviders` copies
 * `deviceId` alone into OrtCUDAProviderOptionsV2; `gpu_mem_limit`,
 * `arena_extend_strategy` and `cudnn_conv_algo_search` are dropped whether
 * passed on the provider object or as session config entries, measured in
 * test/onnx-cuda.int.test.ts). A CUDA failure names the libraries the loader
 * can't find (cuda-libraries.ts). `onnxruntime-node` is loaded on demand and is
 * not a dependency of this package.
 */
import {
  selectBackend,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type ComputeFallbackReason,
} from '@taalcut/core';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { emitComputeFallback } from '../compute-report';
import { OnnxFailed, OnnxUnavailable } from '../errors';
import { cudaFailureDetail, type LibrarySearch } from './cuda-libraries';

export interface OnnxSessionLike {
  readonly inputNames?: readonly string[];
  readonly outputNames?: readonly string[];
  run(feeds: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  release?(): Promise<void> | void;
}

/** An execution provider as onnxruntime-node takes it: its name, or an object with the options its binding reads. */
export type OnnxProviderConfig = string | { readonly name: string; readonly deviceId?: number };

export interface OnnxModule {
  InferenceSession: {
    create(
      model: Uint8Array | string,
      options?: {
        readonly executionProviders?: readonly OnnxProviderConfig[];
        readonly logSeverityLevel?: number;
      },
    ): Promise<OnnxSessionLike>;
  };
}

/** CUDA provider options the binding honours. */
export interface CudaProviderOptions {
  /** The CUDA ordinal (models' `cudaDeviceId`, CUDA_VISIBLE_DEVICES applied). Default: ORT's, device 0. */
  readonly deviceId?: number;
}

/** An accelerated device whose session could not be created. */
export interface OnnxDeviceFailure {
  readonly operation: string;
  readonly backend: ComputeBackend;
  readonly reason: Extract<ComputeFallbackReason, 'accelerator_failed' | 'out_of_memory'>;
  readonly detail: string;
  /** The candidate tried next, `cpu` included; undefined when none is left. */
  readonly next?: ComputeBackend;
}

export interface OnnxRuntimeOptions {
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
  /** Loads onnxruntime-node: the desktop's comes from the `onnxruntime` component. Default: a dynamic import. */
  readonly loadModule?: () => Promise<OnnxModule>;
  readonly runtimeDir?: string;
  /** ORT's own log level for new sessions (0 verbose … 4 fatal). Default 2, warnings. */
  readonly logSeverityLevel?: number;
  /** Options for CUDA sessions. */
  readonly cuda?: CudaProviderOptions;
  /** Each accelerated device that failed, before the next is tried. Default: one warning line. */
  readonly onDeviceFailed?: (failure: OnnxDeviceFailure) => void;
  /** Where the CUDA libraries are looked for when the provider doesn't load. Default: LD_LIBRARY_PATH, then the system's. */
  readonly libraries?: LibrarySearch;
}

export interface OpenSessionOptions {
  readonly operation: string;
  readonly candidates?: readonly ComputeBackend[];
  /**
   * Why the CPU, when `candidates` has no accelerated backend: `disabled` by default; a caller that
   * found no WebGPU execution provider in the module says `no_accelerator`.
   */
  readonly cpuReason?: {
    readonly reason: ComputeFallbackReason;
    readonly detail: string;
    /** The accelerated backends that were wanted (the event's `wanted`). Default WebGPU. */
    readonly wanted?: readonly ComputeBackend[];
  };
}

export interface OnnxSession {
  readonly backend: ComputeBackend;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  release(): Promise<void>;
}

const DEFAULT_CANDIDATES: readonly ComputeBackend[] = ['webgpu', 'cpu'];

/** onnxruntime-node's execution provider names where they differ from core's backend names. */
const PROVIDER_NAMES: Partial<Record<ComputeBackend, string>> = { directml: 'dml' };

/** The execution provider name onnxruntime takes for a backend ('directml' → 'dml'). */
export function onnxProviderName(backend: ComputeBackend): string {
  return PROVIDER_NAMES[backend] ?? backend;
}

async function defaultLoad(): Promise<OnnxModule> {
  const name = 'onnxruntime-node';
  return (await import(name)) as OnnxModule;
}

function detailOf(cause: unknown): string {
  return (cause instanceof Error ? cause.message : 'session creation failed').slice(0, 400);
}

const OUT_OF_MEMORY = /out of memory|CUDA_ERROR_OUT_OF_MEMORY|cudaErrorMemoryAllocation/i;

/** The provider as onnxruntime-node takes it: CUDA with the probe's device, the others by name. */
export function onnxProvider(backend: ComputeBackend, cuda?: CudaProviderOptions): OnnxProviderConfig {
  const name = onnxProviderName(backend);
  return backend === 'cuda' && cuda?.deviceId !== undefined ? { name, deviceId: cuda.deviceId } : name;
}

const warnDeviceFailed = (failure: OnnxDeviceFailure): void =>
  console.warn(
    `[media] ${failure.operation}: ${failure.backend} ${failure.reason} (${failure.detail})` +
      (failure.next ? `; trying ${failure.next}` : ''),
  );

export function createOnnxRuntime(options: OnnxRuntimeOptions = {}) {
  const load = options.loadModule ?? defaultLoad;
  return {
    async openSession(model: Uint8Array | string, request: OpenSessionOptions): AsyncResult<OnnxSession> {
      let mod: OnnxModule;
      try {
        mod = await load();
      } catch (cause) {
        return err(OnnxUnavailable({ model: request.operation }, { detail: detailOf(cause) }));
      }
      const candidates = request.candidates ?? DEFAULT_CANDIDATES;
      const accelerated = candidates.filter((backend) => backend !== 'cpu');
      const failures: OnnxDeviceFailure[] = [];
      for (const [index, backend] of accelerated.entries()) {
        try {
          const created = await mod.InferenceSession.create(model, {
            executionProviders: [onnxProvider(backend, options.cuda)],
            logSeverityLevel: options.logSeverityLevel ?? 2,
          });
          selectBackend(candidates, [backend, ...candidates]);
          return ok(wrap(created, backend));
        } catch (cause) {
          const message = detailOf(cause);
          const detail = backend === 'cuda' ? cudaFailureDetail(message, options.libraries) : message;
          const next = accelerated[index + 1] ?? (candidates.includes('cpu') ? 'cpu' : undefined);
          const failure: OnnxDeviceFailure = {
            operation: request.operation,
            backend,
            reason: OUT_OF_MEMORY.test(message) ? 'out_of_memory' : 'accelerator_failed',
            detail,
            ...(next ? { next } : {}),
          };
          failures.push(failure);
          (options.onDeviceFailed ?? warnDeviceFailed)(failure);
        }
      }
      const failure =
        failures.map((f) => `${f.backend}: ${f.detail}`).join('; ') || 'no accelerated candidate';
      if (!candidates.includes('cpu')) {
        return err(OnnxFailed({ model: request.operation }, { detail: failure }));
      }
      const memory = failures.length > 0 && failures.every((f) => f.reason === 'out_of_memory');
      const tried = accelerated.length > 0;
      emitComputeFallback(
        options.onComputeFallback,
        request.operation,
        tried ? accelerated : (request.cpuReason?.wanted ?? ['webgpu']),
        tried ? (memory ? 'out_of_memory' : 'accelerator_failed') : (request.cpuReason?.reason ?? 'disabled'),
        tried ? failure : (request.cpuReason?.detail ?? failure),
      );
      try {
        const created = await mod.InferenceSession.create(model, {
          executionProviders: ['cpu'],
          logSeverityLevel: options.logSeverityLevel ?? 2,
        });
        return ok(wrap(created, 'cpu'));
      } catch (cause) {
        return err(OnnxFailed({ model: request.operation }, { detail: detailOf(cause) }));
      }
    },
  };
}

function wrap(session: OnnxSessionLike, backend: ComputeBackend): OnnxSession {
  return {
    backend,
    inputNames: [...(session.inputNames ?? [])],
    outputNames: [...(session.outputNames ?? [])],
    run: (feeds) => session.run(feeds),
    release: async () => {
      await session.release?.();
    },
  };
}
