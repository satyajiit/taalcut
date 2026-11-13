// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4: the model over the pass's stream. One segment: every stream frame's prediction, in order. Two
 * segments that overlap by the pre-roll: each frame from the segment with the most frames around it, so the
 * first segment's last frames come from the second's pre-roll; a model failure is the finish's error.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { joinParts, streamPredictor } from '../../src/cuts/stream-predictor';
import { WINDOW_FRAMES, type WindowOutput } from '../../src/cuts/windows';
import { EmbeddingFailed } from '../../src/errors';

const W = 2;
const H = 1;
const BYTES = W * H * 3;

/** Frame k's first byte is k % 256; the model echoes it, plus 1000 per segment it was told about. */
function echo(offset = 0) {
  return {
    predict(window: Float32Array): AsyncResult<WindowOutput> {
      const values = Float32Array.from({ length: WINDOW_FRAMES }, (_, i) => window[i * BYTES]! + offset);
      return Promise.resolve(ok({ single: values, manyHot: values }));
    },
  };
}

function batch(index: number, every: number, count: number) {
  const data = Buffer.alloc(count * BYTES);
  for (let i = 0; i < count; i++) data[i * BYTES] = (index / every + i) % 256;
  return { index, every, count, width: W, height: H, data };
}

describe('streamPredictor', () => {
  it('predicts every stream frame of a single pass, on the stream’s grid', async () => {
    const predictor = streamPredictor(echo(), { width: W, height: H, every: 2 });
    expect(predictor.stream.context).toBe(50);
    for (let k = 0; k < 120; k += 30) await predictor.stream.onFrames(batch(k * 2, 2, 30), 0);
    const done = await predictor.finish(239);
    if (!done.ok) throw new Error(done.error.code);
    expect(done.value.every).toBe(2);
    expect(Array.from(done.value.single)).toEqual(Array.from({ length: 120 }, (_, k) => k));
  });

  it('takes each frame from the segment that has the most frames around it', () => {
    const first = {
      first: 0,
      single: Float32Array.from({ length: 100 }, () => 1),
      manyHot: new Float32Array(100),
    };
    const second = {
      first: 70,
      single: Float32Array.from({ length: 60 }, () => 2),
      manyHot: new Float32Array(60),
    };
    const joined = joinParts([second, first], 130);
    const at = (k: number) => joined.single[k];
    expect([at(0), at(80), at(84), at(85), at(99), at(100), at(129)]).toEqual([1, 1, 1, 2, 2, 2, 2]);
  });

  it('joins two segments of a long pass, the first one’s tail from the second’s pre-roll', async () => {
    const segments = new Map<number, number>([
      [0, 0],
      [1, 150],
    ]);
    // A model that tells segments apart: frames 0–199 in segment 0, 150–299 in segment 1 (50 of pre-roll).
    let calls = 0;
    const predictor = streamPredictor(
      {
        predict: (window) => {
          calls += 1;
          return echo().predict(window);
        },
      },
      { width: W, height: H, every: 1 },
    );
    for (const [segment, from] of segments)
      for (let k = from; k < (segment === 0 ? 200 : 300); k += 25)
        await predictor.stream.onFrames(batch(k, 1, 25), segment);
    const done = await predictor.finish(300);
    if (!done.ok) throw new Error(done.error.code);
    expect(Array.from(done.value.single)).toEqual(Array.from({ length: 300 }, (_, k) => k % 256));
    expect(calls).toBeGreaterThan(0);
  });

  it('fails the finish with the model’s error and reads no more of that segment', async () => {
    let calls = 0;
    const predictor = streamPredictor(
      {
        predict: () => {
          calls += 1;
          return Promise.resolve(err(EmbeddingFailed(undefined, { detail: 'session lost' })));
        },
      },
      { width: W, height: H, every: 1 },
    );
    for (let k = 0; k < 400; k += 100) await predictor.stream.onFrames(batch(k, 1, 100), 0);
    const done = await predictor.finish(400);
    expect(done.ok).toBe(false);
    expect(calls).toBe(1);
  });
});
