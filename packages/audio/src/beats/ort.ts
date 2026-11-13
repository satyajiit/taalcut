// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Beat This! tensors on media's `createOnnxRuntime`. The devices come from the plan (the probe's, devices.ts:
 * CUDA on its device, WebGPU, the CPU); without one, WebGPU then the CPU. The device order and the fallback log
 * belong to that runtime. This file only packs `spect`.
 */
import { CancelledError, err, ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { createOnnxRuntime, type OnnxSession } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { BeatTrackingFailed, ModelMissing } from '../errors';
import { loadOnnxRuntime } from './ort-load';
import { DEFAULT_BEAT_PLAN } from './devices';
import type {
  BeatDevice,
  BeatDevicePlan,
  BeatModelOutput,
  BeatOnnxRuntime,
  BeatOnnxSession,
  BeatSpectInput,
} from './types';

interface OrtTensor {
  readonly data: ArrayLike<number>;
  dispose?: () => void;
}

type OnnxRuntime = ReturnType<typeof createOnnxRuntime>;

interface OrtNamespace {
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

/** `plan` is asked once, at the first session (the desktop's: the probe's accelerators). */
export function createOrtBeatRuntime(
  onFallback?: (event: ComputeFallbackEvent) => void,
  plan?: () => Promise<BeatDevicePlan>,
): BeatOnnxRuntime {
  let planned: Promise<BeatDevicePlan> | undefined;
  const devices = () => (planned ??= plan ? plan() : Promise.resolve(DEFAULT_BEAT_PLAN));
  let runtime: Promise<OnnxRuntime> | undefined;
  const opened = () => (runtime ??= devices().then((chosen) => beatOnnxRuntime(chosen, onFallback)));
  return {
    plan: devices,
    async openSession(modelPath, options) {
      if (options.signal?.aborted) return err(CancelledError());
      const [chosen, onnx] = await Promise.all([devices(), opened()]);
      const session = await onnx.openSession(modelPath, {
        operation: options.operation,
        candidates: [...options.candidates],
        ...(chosen.cpuReason ? { cpuReason: chosen.cpuReason } : {}),
      });
      if (!session.ok) return mapOpen(session.error.code, session.error.detail);
      return ok(wrap(session.value));
    },
  };
}

/** Media's runtime, CUDA sessions on the plan's device. */
export function beatOnnxRuntime(
  plan: BeatDevicePlan,
  onFallback?: (event: ComputeFallbackEvent) => void,
): OnnxRuntime {
  return createOnnxRuntime({
    loadModule: loadOnnxRuntime,
    // Errors only: the exported graph carries unused initializers ORT warns about on every open.
    logSeverityLevel: 3,
    ...(onFallback ? { onComputeFallback: onFallback } : {}),
    ...(plan.cudaDeviceId !== undefined ? { cuda: { deviceId: plan.cudaDeviceId } } : {}),
    ...(plan.cudaLibraries ? { libraries: plan.cudaLibraries } : {}),
  });
}

function mapOpen(code: string, detail?: string) {
  if (code === 'media.onnx_unavailable') return err(ModelMissing({ component: 'onnxruntime' }));
  return err(BeatTrackingFailed(undefined, { detail: (detail ?? code).slice(0, 500) }));
}

function wrap(session: OnnxSession): BeatOnnxSession {
  return {
    backend: beatDevice(session.backend),
    release: () => session.release(),
    run(input, options) {
      return runSession(session, input, options?.signal);
    },
  };
}

async function runSession(
  session: OnnxSession,
  input: BeatSpectInput,
  signal?: AbortSignal,
): AsyncResult<BeatModelOutput> {
  if (signal?.aborted) return err(CancelledError());
  let tensor: { dispose?: () => void } | undefined;
  try {
    const ort = (await import('onnxruntime-node')) as unknown as OrtNamespace;
    tensor = new ort.Tensor('float32', input.data, input.dims) as { dispose?: () => void };
    const outputs = await session.run({ spect: tensor });
    const beat = take(outputs, 'beat', input.dims[0]);
    const downbeat = take(outputs, 'downbeat', input.dims[0]);
    if (!beat || !downbeat) {
      return err(BeatTrackingFailed(undefined, { detail: 'beat model outputs were missing' }));
    }
    return ok({ beat, downbeat });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'beat model run failed';
    return err(BeatTrackingFailed(undefined, { detail: detail.slice(0, 500) }));
  } finally {
    tensor?.dispose?.();
  }
}

function take(
  outputs: Readonly<Record<string, unknown>>,
  name: string,
  windows: number,
): Float32Array | null {
  const direct = outputs[name];
  const tensor = isTensor(direct)
    ? direct
    : Object.entries(outputs).find(([key]) => key.toLowerCase().includes(name))?.[1];
  if (!isTensor(tensor)) return null;
  const length = windows * AUDIO_CONFIG.beats.windowFrames;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = tensor.data[i] ?? 0;
  return out;
}

function beatDevice(backend: string): BeatDevice {
  return backend === 'cuda' || backend === 'directml' || backend === 'webgpu' ? backend : 'cpu';
}

function isTensor(value: unknown): value is OrtTensor {
  return Boolean(value) && typeof value === 'object' && value !== null && 'data' in value;
}
