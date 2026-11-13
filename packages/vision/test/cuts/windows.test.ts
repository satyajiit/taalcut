// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4: the streaming windows are upstream's `predict_frames`: the same windows, in the same order, each
 * frame's prediction from the window that has it in its middle 50, however the frames arrive.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  WINDOW_CONTEXT,
  WINDOW_FRAMES,
  WINDOW_STEP,
  windowedPredictor,
  type WindowOutput,
} from '../../src/cuts/windows';
import { EmbeddingFailed } from '../../src/errors';

const BYTES = 4;
/** Frame k carries its number in its first two bytes. */
const frame = (k: number) => Uint8Array.from([k % 256, Math.floor(k / 256), 7, 9]);

/** Reads each frame's number back as its predictions, and keeps every window it saw. */
function echoModel() {
  const windows: number[][] = [];
  return {
    windows,
    predict(window: Float32Array): AsyncResult<WindowOutput> {
      const numbers = Array.from(
        { length: WINDOW_FRAMES },
        (_, i) => window[i * BYTES]! + 256 * window[i * BYTES + 1]!,
      );
      windows.push(numbers);
      return Promise.resolve(
        ok({ single: Float32Array.from(numbers), manyHot: Float32Array.from(numbers, (n) => n + 0.5) }),
      );
    },
  };
}

/** Upstream's windows over n frames, as frame numbers (inference/transnetv2.py). */
function upstreamWindows(n: number): number[][] {
  const end = WINDOW_CONTEXT + WINDOW_STEP - (n % WINDOW_STEP || WINDOW_STEP);
  const padded = [
    ...Array(WINDOW_CONTEXT).fill(0),
    ...Array.from({ length: n }, (_, k) => k),
    ...Array(end).fill(n - 1),
  ];
  const out: number[][] = [];
  for (let ptr = 0; ptr + WINDOW_FRAMES <= padded.length; ptr += WINDOW_STEP)
    out.push(padded.slice(ptr, ptr + WINDOW_FRAMES));
  return out;
}

async function run(n: number, batches: readonly number[]) {
  const model = echoModel();
  const predictor = windowedPredictor(model, BYTES);
  let k = 0;
  for (let b = 0; k < n; b++) {
    const size = batches[b % batches.length]!;
    const frames = Array.from({ length: Math.min(size, n - k) }, (_, i) => frame(k + i));
    k += frames.length;
    const pushed = await predictor.push(frames);
    expect(pushed.ok).toBe(true);
  }
  const done = await predictor.finish();
  if (!done.ok) throw new Error(done.error.code);
  return { model, predictions: done.value };
}

describe('windowedPredictor', () => {
  it.each([1, 49, 50, 51, 99, 100, 137, 250])('runs upstream’s windows over %i frames', async (n) => {
    const { model, predictions } = await run(n, [1, 7, 50, 3]);
    expect(model.windows).toEqual(upstreamWindows(n));
    expect(Array.from(predictions.single)).toEqual(Array.from({ length: n }, (_, k) => k));
    expect(Array.from(predictions.manyHot)).toEqual(Array.from({ length: n }, (_, k) => k + 0.5));
  });

  it('gives the same predictions whatever the batches', async () => {
    const one = await run(173, [173]);
    const many = await run(173, [2, 31, 1]);
    expect(many.predictions).toEqual(one.predictions);
  });

  it('hands the model 100-frame windows only', async () => {
    let held = 0;
    const model = {
      predict(window: Float32Array) {
        held = Math.max(held, window.length / BYTES);
        return Promise.resolve(
          ok({ single: new Float32Array(WINDOW_FRAMES), manyHot: new Float32Array(WINDOW_FRAMES) }),
        );
      },
    };
    const predictor = windowedPredictor(model, BYTES);
    for (let k = 0; k < 1000; k += 10)
      await predictor.push(Array.from({ length: 10 }, (_, i) => frame(k + i)));
    expect(held).toBe(WINDOW_FRAMES);
  });

  it('gives nothing for no frames, and the model’s error when a window fails', async () => {
    const quiet = windowedPredictor(echoModel(), BYTES);
    expect(await quiet.finish()).toEqual(ok({ single: new Float32Array(0), manyHot: new Float32Array(0) }));
    const failing = windowedPredictor(
      { predict: () => Promise.resolve(err(EmbeddingFailed(undefined, { detail: 'boom' }))) },
      BYTES,
    );
    const pushed = await failing.push(Array.from({ length: 80 }, (_, k) => frame(k)));
    expect(pushed.ok).toBe(false);
  });
});
