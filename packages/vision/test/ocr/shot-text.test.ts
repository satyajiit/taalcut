// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** vision.ocr's read over an asset's frame source (IX-O5): the pass's 1 fps frames, best frames, languages. */
import { FrameRate, RationalTime, TimeRange } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import { createOcrMeter } from '../../src/ocr/meter';
import { createRoutedOcr } from '../../src/ocr/router';
import { readShotText } from '../../src/ocr/shot-text';
import type { OcrFrame } from '../../src/ocr/types';
import { fakeFrameSource } from '../helpers/fake-frame-source';
import { DEVA_CAPS, LATIN_CAPS, fakeEngine, observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const range = (start: number, frames: number) =>
  TimeRange.of(RationalTime.of(start, RATE), RationalTime.of(frames, RATE));
const LOW = { x: 0.1, y: 0.8, width: 0.6, height: 0.06 };

describe('readShotText', () => {
  it('reads the 1 fps grid frames at the OCR size, and a short shot’s best frame', async () => {
    const frames = fakeFrameSource({ frames: 150, width: 1920, height: 1080 });
    const engine = fakeEngine(LATIN_CAPS, (f: OcrFrame) =>
      f.index >= 60 && f.index < 120 ? [observation('Garlic cream pasta', LOW)] : [],
    );
    const meter = createOcrMeter();
    const read = await readShotText(
      [
        { shotId: 'a', range: range(0, 100), bestFrame: 40 },
        // Under a second, no grid frame inside: its best frame, 7 frames in.
        { shotId: 'b', range: range(100, 20), bestFrame: 7 },
        { shotId: 'c', range: range(120, 30) },
      ],
      frames,
      engine,
      ['hi', 'en'],
      { meter },
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.map((s) => [s.shotId, s.onScreenText.map((t) => t.text)])).toEqual([
      ['a', ['Garlic cream pasta']],
      ['b', ['Garlic cream pasta']],
      ['c', []],
    ]);
    // One request for the window: the grid frames and b's best frame, rgb at 1280 px.
    expect(frames.requests).toEqual([
      { size: { width: 1280, height: 720 }, format: 'rgb24', frames: [0, 30, 60, 90, 107, 120] },
    ]);
    // The engine reads only what it serves (Hindi is not Vision's).
    expect(engine.calls.every((call) => call.languages.join() === 'en')).toBe(true);
    expect(meter.counts()).toMatchObject({ sampled: 6, refineCalls: 0 });
  });

  it('reads nothing when the engine serves none of the languages', async () => {
    const frames = fakeFrameSource();
    const engine = fakeEngine(LATIN_CAPS, () => []);
    const read = await readShotText([{ shotId: 'a', range: range(0, 90) }], frames, engine, ['hi']);
    expect(read.ok && read.value).toEqual([{ shotId: 'a', onScreenText: [] }]);
    expect(frames.requests).toEqual([]);
    expect(engine.calls).toEqual([]);
  });

  it('fails while the Latin reader can’t start, instead of storing no text for every shot (IX-F3)', async () => {
    const frames = fakeFrameSource();
    // The desktop's wiring: the helper's engine fails to start; the Devanagari component is installed.
    const ocr = createRoutedOcr({
      vision: fakeEngine(OcrFailed(undefined, { detail: 'helper did not start' }), () => []),
      devanagari: fakeEngine(DEVA_CAPS, () => []),
    });
    const read = await readShotText([{ shotId: 'a', range: range(0, 90) }], frames, ocr, ['hi', 'en']);
    expect(!read.ok && read.error.code).toBe('vision.ocr_failed');
    expect(frames.requests).toEqual([]);
  });
});
