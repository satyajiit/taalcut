// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TransNetV2's own windowing (upstream inference/transnetv2.py, `predict_frames`), fed as frames arrive:
 * windows of 100 frames that step by 50, each keeping the predictions of its middle 50 (25 frames of context
 * on either side); the first frame repeated 25 times before the video, the last repeated after it to fill
 * the last window. The predictions are the batch version's, frame for frame (test/cuts/windows.test.ts), and
 * at most a window and a half of frames waits at once.
 */
import { ok, type AsyncResult } from '@taalcut/core';

export const WINDOW_FRAMES = 100;
export const WINDOW_STEP = 50;
/** Frames of context a window's kept predictions have on each side. */
export const WINDOW_CONTEXT = 25;

/** One window's per-frame probabilities. */
export interface WindowOutput {
  /** The frame is a shot's last before a transition (upstream's single-frame head, after its sigmoid). */
  readonly single: Float32Array;
  /** The frame is inside a transition (the many-hot head). */
  readonly manyHot: Float32Array;
}

/** A model over one window: `frames` RGB frames, back to back, as floats 0–255. */
export interface WindowModel {
  predict(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput>;
}

export interface FramePredictions {
  readonly single: Float32Array;
  readonly manyHot: Float32Array;
}

export interface WindowedPredictor {
  /** The next frames, in order (each `frameBytes` long); runs every window they complete. */
  push(frames: readonly Uint8Array[]): AsyncResult<void>;
  /** Pads the end, runs the last windows, and gives one prediction per frame pushed. */
  finish(): AsyncResult<FramePredictions>;
}

function windowInput(frames: readonly Uint8Array[], frameBytes: number): Float32Array {
  const input = new Float32Array(WINDOW_FRAMES * frameBytes);
  for (let i = 0; i < WINDOW_FRAMES; i++) {
    const frame = frames[i];
    if (frame) input.set(frame, i * frameBytes);
  }
  return input;
}

export function windowedPredictor(
  model: WindowModel,
  frameBytes: number,
  signal?: AbortSignal,
): WindowedPredictor {
  const pending: Uint8Array[] = [];
  const single: number[] = [];
  const manyHot: number[] = [];
  let pushed = 0;
  let last: Uint8Array | undefined;

  const runFull = async (): AsyncResult<void> => {
    while (pending.length >= WINDOW_FRAMES) {
      const out = await model.predict(windowInput(pending, frameBytes), signal);
      if (!out.ok) return out;
      const keep = [WINDOW_CONTEXT, WINDOW_CONTEXT + WINDOW_STEP] as const;
      single.push(...out.value.single.subarray(...keep));
      manyHot.push(...out.value.manyHot.subarray(...keep));
      pending.splice(0, WINDOW_STEP);
    }
    return ok(undefined);
  };

  return {
    push(frames) {
      const first = frames[0];
      if (pushed === 0 && first) for (let i = 0; i < WINDOW_CONTEXT; i++) pending.push(first);
      pending.push(...frames);
      pushed += frames.length;
      last = frames.at(-1) ?? last;
      return runFull();
    },
    async finish() {
      if (!last) return ok({ single: new Float32Array(0), manyHot: new Float32Array(0) });
      const fill = WINDOW_CONTEXT + WINDOW_STEP - (pushed % WINDOW_STEP || WINDOW_STEP);
      for (let i = 0; i < fill; i++) pending.push(last);
      const ran = await runFull();
      if (!ran.ok) return ran;
      return ok({
        single: Float32Array.from(single.slice(0, pushed)),
        manyHot: Float32Array.from(manyHot.slice(0, pushed)),
      });
    },
  };
}
