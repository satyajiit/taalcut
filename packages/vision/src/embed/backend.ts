// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the embedding model runs (ADR 0002, IX-E3, IX2-E5): the profile's
 * devices in order, keeping those this machine offers, and the first that
 * loads wins. An ONNX Runtime provider is offered when the loaded runtime
 * lists it; a native device (`coreml`: the mac helper's Core ML model) when
 * its backend says it is available, and never through ONNX Runtime. A device
 * that fails to load is reported (`onDeviceFailed`) and the next one tried.
 * The CPU only when none is offered (`no_accelerator`), every offered one
 * failed to load (`accelerator_failed`) or acceleration is turned off
 * (`disabled`); each CPU choice goes out as a `compute.fallback` (operation
 * `vision.embed`).
 */
import {
  cpuFallback,
  computeFallbackEvent,
  selectBackend,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { cudaFailureDetail, type LibrarySearch } from '@taalcut/media';
import { EmbedderUnavailable } from '../errors';
import type { EmbeddingDevice, EmbeddingModel, EmbeddingModelLoader, EmbeddingModelOptions } from './model';

const OPERATION = 'vision.embed';
const ORT_MODULE = 'onnxruntime-node';

/** ONNX Runtime's provider names, as core's compute backends. */
const ORT_NAMES: Readonly<Record<string, EmbeddingDevice>> = {
  cpu: 'cpu',
  webgpu: 'webgpu',
  coreml: 'coreml',
  dml: 'directml',
  cuda: 'cuda',
};

/** A model outside ONNX Runtime (IX2-E5): the mac helper's Core ML model. */
export interface NativeEmbeddingBackend {
  /** Whether it can load now without a long wait (installed, its helper present, compiled for this Mac). */
  available(): Promise<boolean>;
  /** Throws when it won't load. */
  load(): Promise<EmbeddingModel>;
  /** `listener` runs once it becomes available after saying it wasn't (its first compile on this Mac finished). */
  onAvailable?(listener: () => void): void;
}

/** Devices only a native backend serves: ONNX Runtime's Core ML provider is never a candidate (IX-E3). */
const NATIVE_ONLY: ReadonlySet<EmbeddingDevice> = new Set(['coreml']);

export interface BackendDeps {
  readonly loader: EmbeddingModelLoader;
  readonly modelOptions: EmbeddingModelOptions;
  /** Native backends by device. */
  readonly native?: Partial<Readonly<Record<EmbeddingDevice, NativeEmbeddingBackend>>>;
  /** An accelerated device that failed to load, before the next one is tried. */
  readonly onDeviceFailed?: (device: EmbeddingDevice, detail: string) => void;
  /** Where a CUDA failure's missing libraries are looked for (media's LibrarySearch). */
  readonly cudaLibraries?: LibrarySearch;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Turn acceleration off (diagnostics). */
  readonly disableGpu?: boolean;
  /** The providers the runtime offers. Default: onnxruntime-node's `listSupportedBackends`. */
  readonly listDevices?: () => Promise<readonly EmbeddingDevice[] | null>;
}

/** The providers onnxruntime-node lists, or null when it can't say (then every candidate is tried). */
export async function ortListedDevices(): Promise<readonly EmbeddingDevice[] | null> {
  try {
    const ort = (await import(ORT_MODULE)) as {
      listSupportedBackends?: () => ReadonlyArray<{ readonly name: string }>;
    };
    if (typeof ort.listSupportedBackends !== 'function') return null;
    return ort.listSupportedBackends().flatMap((entry) => {
      const name = ORT_NAMES[entry.name.toLowerCase()];
      return name ? [name] : [];
    });
  } catch {
    return null;
  }
}

function describe(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
}

/** Which devices this machine offers: native ones that say they are available, others the runtime lists. */
async function offeredDevices(
  candidates: readonly EmbeddingDevice[],
  deps: BackendDeps,
): Promise<(backend: string) => boolean> {
  if (deps.disableGpu) return () => false;
  const listed = await (deps.listDevices ?? ortListedDevices)();
  const ready = new Set<EmbeddingDevice>();
  for (const device of candidates) {
    if (await deps.native?.[device]?.available()) ready.add(device);
  }
  return (backend) => {
    const device = candidates.find((d) => d === backend);
    if (device === undefined) return false;
    if (deps.native?.[device] || NATIVE_ONLY.has(device)) return ready.has(device);
    return listed === null || listed.includes(device);
  };
}

/** The first accelerated device that loads, in order, each failure reported; or the last failure. */
async function firstThatLoads(
  dir: string,
  devices: readonly EmbeddingDevice[],
  deps: BackendDeps,
): Promise<EmbeddingModel | string> {
  let failure = '';
  for (const device of devices) {
    try {
      const native = deps.native?.[device];
      return await (native ? native.load() : deps.loader(dir, device, deps.modelOptions));
    } catch (cause) {
      // A CUDA provider that didn't load says which library the loader missed (media's cuda-libraries.ts).
      const detail =
        device === 'cuda' ? cudaFailureDetail(describe(cause), deps.cudaLibraries) : describe(cause);
      failure = failure ? `${failure}; ${device}: ${detail}` : `${device}: ${detail}`;
      deps.onDeviceFailed?.(device, detail);
    }
  }
  return failure;
}

/**
 * The model on a native device the profile puts before `current`, once its backend is available (IX2-F2: Core ML's
 * first compile finished after the model loaded on WebGPU); each failure reported, undefined when none loads. No
 * CPU step: the model on `current` stays.
 */
export async function loadNativeAhead(
  devices: readonly EmbeddingDevice[],
  current: EmbeddingDevice,
  deps: Pick<BackendDeps, 'native' | 'onDeviceFailed' | 'disableGpu'>,
): Promise<EmbeddingModel | undefined> {
  if (deps.disableGpu) return undefined;
  const at = devices.indexOf(current);
  for (const device of at < 0 ? devices : devices.slice(0, at)) {
    const backend = deps.native?.[device];
    if (!backend || !(await backend.available())) continue;
    try {
      return await backend.load();
    } catch (cause) {
      deps.onDeviceFailed?.(device, describe(cause));
    }
  }
  return undefined;
}

/** Loads the model on the first device that works, else the CPU with its reason logged. */
export async function loadOnBestDevice(
  dir: string,
  devices: readonly EmbeddingDevice[],
  deps: BackendDeps,
): Promise<EmbeddingModel | TaalcutError> {
  const candidates: readonly EmbeddingDevice[] = devices.includes('cpu') ? devices : [...devices, 'cpu'];
  const offered = await offeredDevices(candidates, deps);
  const choice = selectBackend(candidates, offered, {
    fallbackReason: deps.disableGpu ? 'disabled' : 'no_accelerator',
    detail: deps.disableGpu ? 'acceleration turned off' : `no listed provider among ${devices.join(', ')}`,
  });
  if (!choice.ok) return choice.error;
  let fallback = choice.value.fallback;
  if (!fallback) {
    // The first offered device is selectBackend's choice; the others are tried in the profile's order.
    const loaded = await firstThatLoads(
      dir,
      candidates.filter((d) => d !== 'cpu' && offered(d)),
      deps,
    );
    if (typeof loaded !== 'string') return loaded;
    fallback = cpuFallback('accelerator_failed', loaded).fallback;
  }
  if (fallback) deps.onFallback?.(computeFallbackEvent(OPERATION, candidates, fallback));
  try {
    return await deps.loader(dir, 'cpu', deps.modelOptions);
  } catch (cause) {
    return EmbedderUnavailable(undefined, { detail: describe(cause) });
  }
}
