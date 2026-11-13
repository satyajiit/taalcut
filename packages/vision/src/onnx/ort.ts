// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ONNX Runtime sessions for vision's own graphs (PP-OCRv5, TransNetV2), on
 * media's shared runtime (`createOnnxRuntime`): the caller's devices in order
 * (default WebGPU, then the CPU), keeping those the module lists; the CPU EP
 * only when none can be created, logged as `compute.fallback`. Core ML is
 * never a default (spike 05: worse accuracy, slower). The planners
 * (`ocr/backends.ts`, `cuts/backends.ts`) give the devices from the probe:
 * CUDA first on NVIDIA (with the probe's device id), DirectML first on
 * Windows. A CUDA session that won't open is logged with the libraries it
 * missed and the next device is tried (media's runtime). This layer adds
 * float32 tensors in and out, cancellation and vision's error codes. The
 * module loads lazily so importing vision never maps the native runtime;
 * `load` is where the desktop hands in the onnxruntime-node it loads from the
 * `onnxruntime` component.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeBackend,
  type ComputeFallbackEvent,
} from '@taalcut/core';
import {
  createOnnxRuntime,
  type CudaProviderOptions,
  type LibrarySearch,
  type OnnxDeviceFailure,
  type OnnxModule,
  type OnnxProviderConfig,
} from '@taalcut/media';
import { EmbedderUnavailable, OcrFailed } from '../errors';

export interface OnnxTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export interface OnnxSession {
  readonly backend: ComputeBackend;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(
    feeds: Readonly<Record<string, OnnxTensor>>,
    signal?: AbortSignal,
  ): AsyncResult<Record<string, OnnxTensor>>;
  release(): Promise<void>;
}

export interface OnnxRuntime {
  openSession(
    modelPath: string,
    options: { readonly operation: string; readonly signal?: AbortSignal },
  ): AsyncResult<OnnxSession>;
}

/** The slice of onnxruntime-node used here, so tests can pass a fake module. */
export interface OrtModule {
  readonly Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
  readonly InferenceSession: {
    create(
      path: string,
      options: { executionProviders: OnnxProviderConfig[]; logSeverityLevel?: number },
    ): Promise<OrtSession>;
  };
  readonly listSupportedBackends?: () =>
    ReadonlyArray<{ readonly name: string }> | Promise<ReadonlyArray<{ readonly name: string }>>;
}

interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
  release?(): Promise<void>;
}

export interface OrtRuntimeOptions {
  /** Loads onnxruntime-node. Default: a dynamic import. */
  readonly load?: () => Promise<OrtModule>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Turn acceleration off (tests, diagnostics, TAALCUT_FORCE_CPU): logged as `disabled`. */
  readonly disableGpu?: boolean;
  /** Execution providers, best first; those the module doesn't list are dropped. Default WebGPU, then the CPU. */
  readonly devices?: readonly ComputeBackend[];
  /** CUDA's provider options: the probe's device id. */
  readonly cuda?: CudaProviderOptions;
  /** An accelerated device that failed before the next was tried. Default: media's warning line. */
  readonly onDeviceFailed?: (failure: OnnxDeviceFailure) => void;
  /** Where a CUDA failure's missing libraries are looked for: the desktop names the installed cuda-runtime-13. */
  readonly cudaLibraries?: LibrarySearch;
}

const DEFAULT_DEVICES: readonly ComputeBackend[] = ['webgpu', 'cpu'];

/** onnxruntime's provider names (`listSupportedBackends`) as core's backends. */
const LISTED_NAMES: Readonly<Record<string, ComputeBackend>> = {
  cpu: 'cpu',
  webgpu: 'webgpu',
  coreml: 'coreml',
  dml: 'directml',
  cuda: 'cuda',
};

const MODULE_NAME = 'onnxruntime-node';

async function defaultLoad(): Promise<OrtModule> {
  return (await import(MODULE_NAME)) as unknown as OrtModule;
}

export function createOrtRuntime(options: OrtRuntimeOptions = {}): OnnxRuntime {
  let module: Promise<OrtModule | null> | undefined;
  const load = () =>
    (module ??= (options.load ?? defaultLoad)().catch((cause: unknown) => {
      console.warn(`[vision] onnxruntime-node did not load: ${String(cause)}`);
      return null;
    }));
  const shared = createOnnxRuntime({
    loadModule: async () => (await load()) as unknown as OnnxModule,
    ...(options.onFallback ? { onComputeFallback: options.onFallback } : {}),
    ...(options.cuda ? { cuda: options.cuda } : {}),
    ...(options.onDeviceFailed ? { onDeviceFailed: options.onDeviceFailed } : {}),
    ...(options.cudaLibraries ? { libraries: options.cudaLibraries } : {}),
    logSeverityLevel: 3,
  });

  return {
    async openSession(modelPath, { operation, signal }) {
      if (signal?.aborted) return err(CancelledError());
      const ort = await load();
      if (!ort) return err(EmbedderUnavailable(undefined, { detail: 'onnxruntime-node is not available' }));
      const listed = await listedDevices(ort);
      const wanted = options.devices ?? DEFAULT_DEVICES;
      const wantedGpu = wanted.filter((device) => device !== 'cpu');
      const accelerated = options.disableGpu
        ? []
        : wantedGpu.filter((device) => listed === null || listed.has(device));
      const opened = await shared.openSession(modelPath, {
        operation,
        candidates: [...accelerated, 'cpu'],
        cpuReason: options.disableGpu
          ? { reason: 'disabled', detail: 'acceleration turned off', ...wantedOf(wantedGpu) }
          : {
              reason: 'no_accelerator',
              detail:
                wantedGpu.length > 0
                  ? `no listed execution provider among ${wantedGpu.join(', ')}`
                  : 'no accelerated device on this machine',
              ...wantedOf(wantedGpu),
            },
      });
      if (!opened.ok) {
        const detail = `${opened.error.code}: ${opened.error.detail ?? ''}`.slice(0, 500);
        return err(OcrFailed(undefined, { detail }));
      }
      if (signal?.aborted) {
        await opened.value.release();
        return err(CancelledError());
      }
      const session = opened.value;
      return ok({
        backend: session.backend,
        inputNames: session.inputNames,
        outputNames: session.outputNames,
        async run(feeds, runSignal) {
          if (runSignal?.aborted) return err(CancelledError());
          try {
            const inputs: Record<string, unknown> = {};
            for (const [name, tensor] of Object.entries(feeds)) {
              inputs[name] = new ort.Tensor('float32', tensor.data, tensor.dims);
            }
            const outputs = (await session.run(inputs)) as Record<
              string,
              { data: unknown; dims: readonly number[] }
            >;
            const result: Record<string, OnnxTensor> = {};
            for (const [name, tensor] of Object.entries(outputs)) {
              result[name] = {
                data: Float32Array.from(tensor.data as ArrayLike<number>),
                dims: [...tensor.dims],
              };
            }
            if (runSignal?.aborted) return err(CancelledError());
            return ok(result);
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            return err(OcrFailed(undefined, { detail: detail.slice(0, 500) }));
          }
        },
        release: () => session.release(),
      });
    },
  };
}

/** The event's `wanted`, when the caller wanted any accelerated device (else media's default, WebGPU). */
const wantedOf = (devices: readonly ComputeBackend[]) => (devices.length > 0 ? { wanted: devices } : {});

/** The devices the module lists, or null when it can't say (then every device is tried). */
async function listedDevices(ort: OrtModule): Promise<ReadonlySet<ComputeBackend> | null> {
  if (typeof ort.listSupportedBackends !== 'function') return null;
  try {
    const names = (await ort.listSupportedBackends()).map((entry) => entry.name.toLowerCase());
    return new Set(names.flatMap((name) => (LISTED_NAMES[name] ? [LISTED_NAMES[name]] : [])));
  } catch {
    return null;
  }
}
