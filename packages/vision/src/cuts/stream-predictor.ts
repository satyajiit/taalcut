// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary model over the analysis pass's RGB stream (IX2-C4): one windowed predictor per segment
 * of the pass, fed while the pass decodes, then the segments' predictions joined into one per stream frame of
 * the file. A long video's segments overlap by their pre-roll (at least two windows' context, `context`), and
 * each frame's prediction comes from the segment that saw the most frames on both sides of it, so a segment's
 * last frames (no frames after them in that segment) are predicted where the next segment's pre-roll has them.
 */
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import type { RgbBatch } from '@taalcut/media';
import type { PassStream } from '../media/frame-source';
import { WINDOW_CONTEXT, windowedPredictor, type WindowModel, type WindowedPredictor } from './windows';

/** One prediction per stream frame: prediction k is grid frame k × every. */
export interface BoundaryPredictions {
  readonly every: number;
  readonly single: Float32Array;
  readonly manyHot: Float32Array;
}

export interface StreamPredictor {
  readonly stream: PassStream;
  /** After the pass: the file's predictions, `frames` grid frames long. */
  finish(frames: number): AsyncResult<BoundaryPredictions>;
}

interface SegmentPart {
  /** The segment's first stream frame. */
  readonly first: number;
  readonly predictor: WindowedPredictor;
  failure?: TaalcutError;
}

interface DonePart {
  readonly first: number;
  readonly single: Float32Array;
  readonly manyHot: Float32Array;
}

/** Each stream frame from the part that has the most frames around it (the earlier on a tie). */
export function joinParts(
  parts: readonly DonePart[],
  length: number,
): { single: Float32Array; manyHot: Float32Array } {
  const single = new Float32Array(length);
  const manyHot = new Float32Array(length);
  const sorted = [...parts].sort((a, b) => a.first - b.first);
  for (let k = 0; k < length; k++) {
    let best: DonePart | undefined;
    let room = -1;
    for (const part of sorted) {
      const at = k - part.first;
      if (at < 0 || at >= part.single.length) continue;
      const around = Math.min(at, part.single.length - 1 - at);
      if (around > room) {
        best = part;
        room = around;
      }
    }
    if (!best) continue;
    single[k] = best.single[k - best.first] ?? 0;
    manyHot[k] = best.manyHot[k - best.first] ?? 0;
  }
  return { single, manyHot };
}

export function streamPredictor(
  model: WindowModel,
  size: { readonly width: number; readonly height: number; readonly every: number },
  signal?: AbortSignal,
): StreamPredictor {
  const bytes = size.width * size.height * 3;
  const parts = new Map<number, SegmentPart>();
  const stream: PassStream = {
    ...size,
    // The pre-roll a segment needs so the one before it can leave its last WINDOW_CONTEXT frames to it.
    context: 2 * WINDOW_CONTEXT,
    async onFrames(batch: RgbBatch, segment: number) {
      let part = parts.get(segment);
      if (!part) {
        part = {
          first: Math.round(batch.index / size.every),
          predictor: windowedPredictor(model, bytes, signal),
        };
        parts.set(segment, part);
      }
      if (part.failure) return;
      const frames = Array.from({ length: batch.count }, (_, i) =>
        batch.data.subarray(i * bytes, (i + 1) * bytes),
      );
      const pushed = await part.predictor.push(frames);
      if (!pushed.ok) part.failure = pushed.error;
    },
  };
  return {
    stream,
    async finish(frames) {
      const done: DonePart[] = [];
      for (const part of parts.values()) {
        if (part.failure) return err(part.failure);
        const predicted = await part.predictor.finish();
        if (!predicted.ok) return predicted;
        done.push({ first: part.first, ...predicted.value });
      }
      const length = Math.ceil(frames / size.every);
      return ok({ every: size.every, ...joinParts(done, length) });
    },
  };
}
