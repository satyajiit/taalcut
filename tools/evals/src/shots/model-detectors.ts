// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where `predict:shots` runs TransNetV2 (IX2-C4, IX2-S2):
 * - `transnetv2`: a process of its own, as the app runs it (vision's remote model; here a Node child running
 *   model-process-entry.ts, in the app an Electron utility process);
 * - `transnetv2-coreml`: on Core ML in the development mac helper's `shots` service (IX2-S10), as the app runs it
 *   first on a Mac (`VISION_CONFIG.shots.model.computeUnits`), from the `transnetv2-coreml` folder;
 * - `transnetv2-inline`: on the pass's thread, as the app ran it before IX2-S2 (each window holds the thread).
 * (A worker thread, `transnetv2-thread` in IX2-C4, is gone: the app can't use one, vision SPEC.)
 * Each is warmed with one window before the first clip, so its start and first run are timed apart.
 */
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import {
  childChannel,
  coreMlShotModel,
  createOrtRuntime,
  developmentShotsHelper,
  remoteShotModel,
  shotModelDevices,
  transNetLoader,
  VISION_CONFIG,
  WINDOW_FRAMES,
  type ModelChannel,
  type ShotBoundaryModel,
} from '@taalcut/vision';

export const SHOT_DETECTORS = ['scdet', 'transnetv2', 'transnetv2-coreml', 'transnetv2-inline'] as const;
export type ShotDetector = (typeof SHOT_DETECTORS)[number];
export type ModelDetectorName = Exclude<ShotDetector, 'scdet'>;

export interface ModelDetector {
  readonly load: (signal?: AbortSignal) => AsyncResult<ShotBoundaryModel>;
  close(): Promise<void>;
}

const processEntry = new URL('./model-process-entry.ts', import.meta.url);

/** The model in its own process, from `start`, as the app's jobs process sees it. */
function remote(
  start: () => ModelChannel,
  modelDir: string,
  onFallback: (event: ComputeFallbackEvent) => void,
): ModelDetector {
  const devices = shotModelDevices(process.platform);
  const model = remoteShotModel({
    start: async () => ok(start()),
    modelDir: async () => modelDir,
    idleMs: VISION_CONFIG.shots.model.idleMs,
    startMs: VISION_CONFIG.shots.model.startMs,
    expectedBackend: devices[0] ?? 'cpu',
    onFallback,
  });
  return { load: (signal) => model.load(signal), close: () => model.close() };
}

/** The model on Core ML in the development helper, over the `transnetv2-coreml` folder. */
function coreml(modelDir: string): ModelDetector {
  const { idleMs, startMs, computeUnits } = VISION_CONFIG.shots.model;
  // The helper reads the windows from a folder of the eval's own, removed at the close.
  let windows: Promise<string> | undefined;
  const windowsDir = () =>
    (windows ??= mkdtemp(join(tmpdir(), 'taalcut-shots-eval-')).then((dir) => realpath(dir)));
  const model = coreMlShotModel({
    helper: {
      windowsDir,
      start: async (dir, windowsAt) => {
        const helper = await developmentShotsHelper(windowsDir);
        return helper.ok ? helper.value.start(dir, windowsAt) : helper;
      },
    },
    modelDir: async () => modelDir,
    units: computeUnits,
    idleMs,
    startMs,
  });
  return {
    load: (signal) => model.load(signal),
    close: async () => {
      await model.close();
      if (windows) await rm(await windows, { recursive: true, force: true });
    },
  };
}

/** `modelDir` is the detector's component folder: `transnetv2`'s, or `transnetv2-coreml`'s for that one. */
export function modelDetector(
  name: ModelDetectorName,
  modelDir: string,
  onFallback: (event: ComputeFallbackEvent) => void,
): ModelDetector {
  if (name === 'transnetv2-coreml') return coreml(modelDir);
  if (name === 'transnetv2')
    // The child inherits this process's tsx loader (fork's default execArgv).
    return remote(
      () => childChannel(fork(processEntry, [], { serialization: 'advanced' })),
      modelDir,
      onFallback,
    );
  const load = transNetLoader(
    createOrtRuntime({ devices: shotModelDevices(process.platform), onFallback }),
    async () => modelDir,
  );
  return {
    load,
    async close() {
      const model = await load();
      if (model.ok) await model.value.release();
    },
  };
}

/** One window of black, so a detector's start and first run happen before the first clip. */
export async function warmUp(detector: ModelDetector): AsyncResult<ShotBoundaryModel> {
  const model = await detector.load();
  if (!model.ok) return model;
  const window = new Float32Array(WINDOW_FRAMES * 48 * 27 * 3);
  const out = await model.value.predict(window);
  return out.ok ? model : out;
}
