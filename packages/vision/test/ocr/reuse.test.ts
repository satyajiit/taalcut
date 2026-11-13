// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import { grayThumbnail, meanAbsoluteDifference, recognizeWithReuse } from '../../src/ocr/reuse';
import { fakeEngine, frame, LATIN_CAPS, observation } from './helpers/fakes';

const BOX = { x: 0.1, y: 0.1, width: 0.5, height: 0.1 };

describe('recognizeWithReuse', () => {
  it('reuses the last OCR result for frames that barely changed', async () => {
    const engine = fakeEngine(LATIN_CAPS, (f) => [observation(`seen ${f.index}`, BOX)]);
    // 0, 1 alike; 2 differs; 3 alike to 2 (drift of 1/255 per frame stays under the 2/255 gate).
    const frames = [frame(0, 70, 70, 10), frame(1, 70, 70, 11), frame(2, 70, 70, 200), frame(3, 70, 70, 201)];
    const pages = await recognizeWithReuse(engine, frames, { languages: ['en'] });
    expect(pages.ok && pages.value.map((p) => [p.frame, p.observations[0]?.text])).toEqual([
      [0, 'seen 0'],
      [1, 'seen 0'],
      [2, 'seen 2'],
      [3, 'seen 2'],
    ]);
    expect(engine.calls).toEqual([{ frames: [0, 2], languages: ['en'] }]);
  });

  it('compares against the last OCR frame, so slow drift is caught', async () => {
    const engine = fakeEngine(LATIN_CAPS, () => []);
    const frames = [100, 101, 103, 104].map((v, i) => frame(i, 16, 16, v));
    await recognizeWithReuse(engine, frames, { languages: [] });
    expect(engine.calls[0]?.frames).toEqual([0, 2]);
  });

  it('hands every changed frame to the engine in one call (it makes the requests) and passes errors through', async () => {
    const engine = fakeEngine(LATIN_CAPS, () => []);
    const frames = Array.from({ length: 20 }, (_, i) => frame(i, 8, 8, (i * 50) % 256));
    const pages = await recognizeWithReuse(engine, frames, { languages: ['en'] });
    expect(pages.ok && pages.value.length).toBe(20);
    expect(engine.calls.map((c) => c.frames.length)).toEqual([20]);
    const failing = fakeEngine(LATIN_CAPS, () => OcrFailed());
    const failed = await recognizeWithReuse(failing, [frame(0)], { languages: ['en'] });
    expect(!failed.ok && failed.error.code).toBe('vision.ocr_failed');
    const controller = new AbortController();
    controller.abort();
    const cancelled = await recognizeWithReuse(engine, [frame(0)], {
      languages: ['en'],
      signal: controller.signal,
    });
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });

  it('makes box-filtered gray thumbnails', () => {
    const thumb = grayThumbnail(frame(0, 128, 128, 255), 64);
    expect(thumb.length).toBe(64 * 64);
    expect(thumb[0]).toBeCloseTo(1);
    expect(meanAbsoluteDifference(thumb, grayThumbnail(frame(0, 128, 128, 0), 64))).toBeCloseTo(1);
    expect(meanAbsoluteDifference(thumb, new Float32Array(3))).toBe(Infinity);
  });
});
