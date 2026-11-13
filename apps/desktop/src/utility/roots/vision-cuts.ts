// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's shot-boundary model (IX2-C4, IX2-S2, IX2-S10), in this order:
 * 1. **Core ML** in the mac helper's `shots` service, when the helper and `transnetv2-coreml` are installed and the
 *    model opens (the load starts the helper and asks; `VISION_CONFIG.shots.model.computeUnits`). Its transitions
 *    are the ONNX model's, at a twentieth of its GPU time, so whisper and the frame embedder keep the GPU.
 * 2. **The ONNX model** (`transnetv2`) in a utility process of its own that main forks on the first window of a
 *    shots job (shot-model.ts; asked for over the parent port, shot-model-port.ts), on the devices this process's
 *    probe allows (`shotModelRuntime`: CUDA on the probe's device, WebGPU, the CPU). Its CPU sessions go on the bus
 *    as `compute.fallback`.
 * 3. **scdet** and the embedding check, when neither loads (vision's detect-shots.ts logs that `compute.fallback`).
 * Each ends after VISION_CONFIG.shots.model.idleMs without a window. A component that isn't installed yet is looked
 * up again at the next job, so shots move up the order once it lands; the step from Core ML to ONNX is logged once
 * per reason.
 *
 * Not on the jobs thread: onnxruntime-node runs a window synchronously on the calling thread, so the model held
 * the jobs thread for each window (~155 ms on WebGPU) and FFmpeg's pipes went unread meanwhile. Not on a worker
 * thread either: ONNX Runtime has one WebGPU device per process and Dawn's device is not safe from two threads
 * (the jobs process crashed 12 times that way, 2026-10-19). Its own process has its own device.
 */
import { err, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import type { MachineAccelerators } from '@taalcut/media';
import {
  coreMlShotModel,
  remoteShotModel,
  ShotModelFailed,
  shotModelDevices,
  shotModelOnCoreMl,
  shotModelRuntime,
  TRANSNET_COMPONENT,
  TRANSNET_COREML_COMPONENT,
  VISION_CONFIG,
  type ModelChannel,
  type ShotBoundaryModel,
  type ShotsHelper,
} from '@taalcut/vision';
import { hostPlatform } from '../../platform';

export interface DesktopBoundaryModelDeps {
  /** An installed component's folder, or null. */
  readonly installed: (id: string) => Promise<string | null>;
  readonly onFallback: (event: ComputeFallbackEvent) => void;
  /** Default this host's (the platform services'): Core ML first on a Mac, and the ONNX process's first provider. */
  readonly platform?: string;
  /** A new model process's port (shot-model-port.ts); undefined where nothing can fork one (tests' compositions). */
  readonly start: (() => AsyncResult<ModelChannel>) | undefined;
  /** The mac helper's shots service; undefined where there is no helper. */
  readonly helper?: ShotsHelper;
  /** Where the step down from Core ML is said (once per reason). */
  readonly log?: (line: string) => void;
  /** The probe's accelerators (machine-accelerators.ts); absent or undefined: the platform's row as it is. */
  readonly accelerators?: () => Promise<MachineAccelerators | undefined>;
}

/** `vision.shots`' model; where this process can't get one, its failure (scdet decides, logged). */
export function desktopBoundaryModel(
  deps: DesktopBoundaryModelDeps,
): (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel> {
  const { idleMs, startMs, computeUnits } = VISION_CONFIG.shots.model;
  const platform = deps.platform ?? hostPlatform().name;
  const devices = shotModelDevices(platform);
  const coreml =
    deps.helper && shotModelOnCoreMl(platform)
      ? coreMlShotModel({
          helper: deps.helper,
          modelDir: () => deps.installed(TRANSNET_COREML_COMPONENT),
          units: computeUnits,
          idleMs,
          startMs,
        })
      : undefined;
  const { start, accelerators } = deps;
  const onnx = start
    ? remoteShotModel({
        start,
        modelDir: () => deps.installed(TRANSNET_COMPONENT),
        idleMs,
        startMs,
        expectedBackend: devices[0] ?? 'cpu',
        onFallback: deps.onFallback,
        ...(accelerators ? { runtime: async () => shotModelRuntime(platform, await accelerators()) } : {}),
      })
    : undefined;
  const said = new Set<string>();
  const sayOnce = (line: string) => {
    if (!said.has(line)) deps.log?.(line);
    said.add(line);
  };

  return async (signal) => {
    let why = 'no mac helper in this process';
    if (coreml) {
      const lease = await coreml.load(signal);
      if (lease.ok || lease.error.code === 'core.cancelled') return lease;
      why = lease.error.detail ?? lease.error.code;
    }
    // Core ML didn't open: the ONNX process, which tries its devices in order and reports a CPU session itself.
    // Not a `compute.fallback`: nothing here comes to the CPU (scdet's step does, logged by vision).
    if (!onnx) return err(ShotModelFailed(undefined, { detail: 'no shot model process in this process' }));
    if (coreml) sayOnce(`[vision] shots: Core ML unavailable (${why}); TransNetV2 on ONNX Runtime instead`);
    return onnx.load(signal);
  };
}
