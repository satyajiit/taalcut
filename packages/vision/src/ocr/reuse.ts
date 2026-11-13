// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OCR over sampled frames that skips frames which barely changed: a frame
 * whose 64×64 gray thumbnail differs from the last OCR'd one by a mean
 * absolute difference under `unchangedMad` reuses that page. Reels hold a
 * caption for seconds, so most 4 fps samples repeat the previous one.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import type { OcrEngine, OcrFrame, OcrPage, OcrRecognizeOptions } from './types';

/** A gray thumbnail (box-filtered; nearest pixel when the frame is smaller), values 0–1. */
export function grayThumbnail(frame: OcrFrame, size: number = VISION_CONFIG.ocr.thumbSize): Float32Array {
  const out = new Float32Array(size * size);
  const span = (t: number, length: number): [number, number] => {
    const from = Math.min(length - 1, Math.floor((t * length) / size));
    return [from, Math.max(from + 1, Math.floor(((t + 1) * length) / size))];
  };
  for (let ty = 0; ty < size; ty++) {
    const [y0, y1] = span(ty, frame.height);
    for (let tx = 0; tx < size; tx++) {
      const [x0, x1] = span(tx, frame.width);
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * frame.width + x) * 3;
          sum +=
            0.299 * (frame.rgb[i] ?? 0) + 0.587 * (frame.rgb[i + 1] ?? 0) + 0.114 * (frame.rgb[i + 2] ?? 0);
        }
      }
      out[ty * size + tx] = sum / ((y1 - y0) * (x1 - x0)) / 255;
    }
  }
  return out;
}

export function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

/** Which frames need reading: `source[i]` is the frame whose page frame i takes (itself when read). */
export interface ReusePlan {
  readonly toRead: readonly number[];
  readonly source: readonly number[];
}

/**
 * Plans reuse over frames in order (one shot's samples): a frame whose thumbnail barely differs from the last
 * read frame takes its page. `offset` is added to every index (plans of several shots in one list).
 */
export function planReuse(frames: readonly OcrFrame[], offset = 0): ReusePlan {
  const source: number[] = [];
  const toRead: number[] = [];
  let reference: Float32Array | undefined;
  let referenceIndex = -1;
  frames.forEach((frame, i) => {
    const thumb = grayThumbnail(frame);
    if (reference && meanAbsoluteDifference(thumb, reference) < VISION_CONFIG.ocr.unchangedMad) {
      source.push(referenceIndex);
      return;
    }
    reference = thumb;
    referenceIndex = offset + i;
    source.push(offset + i);
    toRead.push(offset + i);
  });
  return { toRead, source };
}

/** Pages for `frames` under a plan: one engine call for the frames to read (the engine makes the requests). */
export async function readPlanned(
  engine: OcrEngine,
  frames: readonly OcrFrame[],
  plan: ReusePlan,
  options: OcrRecognizeOptions,
): AsyncResult<OcrPage[]> {
  if (options.signal?.aborted) return err(CancelledError());
  options.meter?.sampled(frames.length, frames.length - plan.toRead.length);
  const read = new Map<number, OcrPage>();
  if (plan.toRead.length > 0) {
    const pages = await engine.recognize(
      plan.toRead.map((i) => frames[i] as OcrFrame),
      options,
    );
    if (!pages.ok) return pages;
    plan.toRead.forEach((i, k) => {
      const page = pages.value[k];
      if (page) read.set(i, page);
    });
  }
  return ok(
    frames.map((frame, i) => ({
      frame: frame.index,
      observations: read.get(plan.source[i] ?? i)?.observations ?? [],
    })),
  );
}

/** Pages for every frame, in order; unchanged frames reuse the last OCR'd page under their own index. */
export async function recognizeWithReuse(
  engine: OcrEngine,
  frames: readonly OcrFrame[],
  options: OcrRecognizeOptions,
): AsyncResult<OcrPage[]> {
  if (options.signal?.aborted) return err(CancelledError());
  return readPlanned(engine, frames, planReuse(frames), options);
}
