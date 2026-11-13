// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TransNetV2 on Core ML in the mac helper (IX2-S10): the helper's `shots` service (native/mac-helper SPEC) over
 * the `transnetv2-coreml` component, one fp32 model whose transitions are the ONNX model's (the pack's gate; vision
 * SPEC, "Shot boundaries on Core ML"). On the GPU it takes 8.5 ms a window where ONNX Runtime's WebGPU took
 * 155 ms, so whisper and the frame embedder get the GPU back. A window goes to the helper as a file of the rgb24
 * bytes it was made of (380 KB, in a folder the helper may read) and comes back as two heads of 100 float32: the
 * same bytes as base64 in the request line took the helper 19 ms to read, more than the model's 8.5.
 *
 * The process's lifecycle is the pool's (model-pool.ts), eager: a load starts the helper and opens the model
 * (`shots.prepare`), so a Mac where it won't open uses the ONNX process instead (apps/desktop vision-cuts.ts). A
 * helper failure on a window ends the session: that job's later windows fail and scdet decides, as with the ONNX
 * process.
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  float32sFrom,
  ok,
  raceAbort,
  type AsyncResult,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { helperCode, type JsonLineSidecar } from '@taalcut/media';
import { z } from 'zod';
import { shotModelFailed, shotModelPool, type ShotModelPool } from './model-pool';
import {
  realTimers,
  SessionEnd,
  type ModelSession,
  type ModelTimers,
  type OpenedModel,
} from './model-session';
import { WINDOW_FRAMES, type WindowOutput } from './windows';

/** The component that holds the compiled model (`TransNetV2.mlmodelc`). */
export const TRANSNET_COREML_COMPONENT = 'transnetv2-coreml';

/** Where Core ML runs the model (the helper's `computeUnits`). */
export const SHOT_MODEL_UNITS = ['cpuAndGPU', 'cpuAndNeuralEngine', 'cpuOnly', 'all'] as const;
export type ShotModelUnits = (typeof SHOT_MODEL_UNITS)[number];

/** `serve` argv for the helper's shots service: the model from `modelsDir`, windows only from `windowsDir`. */
export function shotsServeArgs(modelsDir: string, windowsDir: string): string[] {
  return ['serve', '--services', 'shots', '--models', modelsDir, '--allow-root', windowsDir];
}

/** How this process gets a helper's shots service. */
export interface ShotsHelper {
  /** A folder this process writes windows into and the helper may read (symlinks resolved, as the helper does). */
  readonly windowsDir: () => Promise<string>;
  /** Starts the helper's shots service (`shotsServeArgs(modelsDir, windowsDir)`). */
  readonly start: (modelsDir: string, windowsDir: string) => AsyncResult<JsonLineSidecar>;
}

export interface CoreMlShotModelOptions {
  readonly helper: ShotsHelper;
  /** The installed component's folder, or null (looked up again at every load). */
  readonly modelDir: () => Promise<string | null>;
  readonly units: ShotModelUnits;
  /** The helper ends after this long without a window in flight. */
  readonly idleMs: number;
  /** How long the helper may take to start and open the model. */
  readonly startMs: number;
  /** Per window. Default 60 s. */
  readonly windowMs?: number;
  readonly timers?: ModelTimers;
}

const DEFAULT_WINDOW_MS = 60_000;
const RELEASED = 'the model was released';
const outputSchema = z.object({ single: z.string(), manyHot: z.string() });

/** A head's 100 float32, or undefined when the helper sent another length. */
const head = (base64: string) => float32sFrom(Buffer.from(base64, 'base64'), WINDOW_FRAMES);

/** Writes the window as the rgb24 bytes it was made of (its floats are whole numbers 0–255, windows.ts). */
async function writeWindow(path: string, window: Float32Array): Promise<string | undefined> {
  try {
    await writeFile(path, Uint8Array.from(window));
    return undefined;
  } catch (cause) {
    return String(cause);
  }
}

function why(method: string, error: TaalcutError): TaalcutError {
  return shotModelFailed(`${method}: ${helperCode(error)}${error.detail ? ` (${error.detail})` : ''}`);
}

interface SessionOptions {
  readonly units: ShotModelUnits;
  readonly windowsDir: string;
  readonly startMs: number;
  readonly windowMs: number;
}

class HelperSession implements ModelSession {
  readonly opened: Promise<Result<OpenedModel>>;
  private pending = 0;
  private readonly ending = new SessionEnd();

  constructor(
    private readonly helper: JsonLineSidecar,
    private readonly options: SessionOptions,
  ) {
    this.opened = helper
      .request('shots.prepare', { computeUnits: options.units }, { timeoutMs: options.startMs })
      .then((prepared) => {
        if (prepared.ok) return ok({ model: TRANSNET_COREML_COMPONENT, backend: 'coreml' as const });
        return this.lose(why('shots.prepare', prepared.error));
      });
  }

  get inFlight(): number {
    return this.pending;
  }

  async ask(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput> {
    const ready = await raceAbort(this.opened, signal);
    if (signal?.aborted) return err(CancelledError());
    if (!ready.ok) return ready;
    const { ended } = this.ending;
    if (ended) return err(ended.lost ?? shotModelFailed(RELEASED));
    this.pending += 1;
    try {
      return await this.send(window, signal);
    } finally {
      this.pending -= 1;
    }
  }

  private async send(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput> {
    const path = join(this.options.windowsDir, `shots-${randomUUID()}.rgb`);
    const unwritten = await writeWindow(path, window);
    // Not the helper's fault, but the windows can't reach it: the job falls back as on a failure.
    if (unwritten !== undefined) return err(shotModelFailed(`the window wasn't written: ${unwritten}`));
    if (signal?.aborted) {
      await rm(path, { force: true }).catch(() => undefined);
      return err(CancelledError());
    }
    const params = { computeUnits: this.options.units, count: 1, path };
    const answer = await this.helper
      .request('shots.windows', params, { timeoutMs: this.options.windowMs, ...(signal ? { signal } : {}) })
      .finally(() => rm(path, { force: true }).catch(() => undefined));
    // A cancelled window: the helper stops it; the session goes on.
    if (signal?.aborted) return err(CancelledError());
    if (!answer.ok) return this.lose(why('shots.windows', answer.error));
    const parsed = outputSchema.safeParse(answer.value);
    const single = parsed.success ? head(parsed.data.single) : undefined;
    const manyHot = parsed.success ? head(parsed.data.manyHot) : undefined;
    if (!single || !manyHot) return this.lose(shotModelFailed('shots.windows: not two heads of 100 values'));
    return ok({ single, manyHot });
  }

  async release(): Promise<void> {
    this.ending.end(undefined);
    await this.helper.close();
  }

  onEnd(listener: (lost: TaalcutError | undefined) => void): void {
    this.ending.onEnd(listener);
  }

  /** Ends the session and its helper: the pool forgets it, and the next window starts another helper. */
  private lose<T>(lost: TaalcutError): Result<T> {
    this.ending.end(lost);
    void this.helper.close();
    return err(lost);
  }
}

/** One helper's session: it opens the model at once (`shots.prepare`) and sends windows one per request. */
export function coreMlShotSession(
  helper: JsonLineSidecar,
  options: {
    readonly units: ShotModelUnits;
    readonly windowsDir: string;
    readonly startMs: number;
    readonly windowMs?: number;
  },
): ModelSession {
  return new HelperSession(helper, { ...options, windowMs: options.windowMs ?? DEFAULT_WINDOW_MS });
}

/** `vision.shots`' model on Core ML: an eager pool over the helper's shots service. */
export function coreMlShotModel(options: CoreMlShotModelOptions): ShotModelPool {
  const { units, startMs } = options;
  return shotModelPool({
    component: TRANSNET_COREML_COMPONENT,
    modelDir: options.modelDir,
    idleMs: options.idleMs,
    expectedBackend: 'coreml',
    eager: true,
    timers: options.timers ?? realTimers,
    open: async (modelDir) => {
      const windowsDir = await options.helper.windowsDir();
      const helper = await options.helper.start(modelDir, windowsDir);
      if (!helper.ok) return helper;
      return ok(
        coreMlShotSession(helper.value, {
          units,
          windowsDir,
          startMs,
          ...(options.windowMs === undefined ? {} : { windowMs: options.windowMs }),
        }),
      );
    },
  });
}
