// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, ok, type NormalisedBox } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createOcrMeter } from '../../src/ocr/meter';
import { readShotsText, shotSamples } from '../../src/ocr/read-shots';
import { recognizeWithReuse } from '../../src/ocr/reuse';
import { trackOnScreenText } from '../../src/ocr/track';
import type { OcrFrame, OcrObservation } from '../../src/ocr/types';
import { LATIN_CAPS, fakeEngine, frame, observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const TOP: NormalisedBox = { x: 0.1, y: 0.1, width: 0.5, height: 0.06 };
const LOW: NormalisedBox = { x: 0.1, y: 0.8, width: 0.6, height: 0.06 };

/** Shots of an asset on a 30 fps grid, and what each frame shows. */
const SHOTS = [
  { start: 0, end: 100 },
  { start: 100, end: 115 }, // under a second: no grid sample inside, reads its middle frame
  { start: 115, end: 400 },
];
function shown(f: number): OcrObservation[] {
  return [
    ...(f >= 20 && f < 80 ? [observation('Opening title', TOP)] : []),
    ...(f >= 100 && f < 115 ? [observation('Flash card', LOW)] : []),
    ...(f >= 200 && f < 330 ? [observation('Garlic cream pasta', LOW)] : []),
  ];
}
/** A frame's pixels change with its text, so unchanged frames reuse a page. */
const pixels = (f: number) => frame(f, 8, 8, shown(f).length * 60 + (f >= 100 && f < 115 ? 30 : 0));

function world() {
  const reads: number[][] = [];
  const frames = async (indexes: readonly number[]) => {
    reads.push([...indexes]);
    return ok(indexes.map(pixels));
  };
  const engine = fakeEngine(LATIN_CAPS, (f: OcrFrame) => shown(f.index));
  return { reads, frames, engine };
}

describe('readShotsText', () => {
  it('samples each shot on the one-second grid, or its best (else middle) frame', () => {
    const [first, flash, last] = SHOTS;
    expect(first && shotSamples(first, 30)).toEqual([0, 30, 60, 90]);
    expect(flash && shotSamples(flash, 30)).toEqual([107]);
    expect(flash && shotSamples({ ...flash, bestFrame: 112 }, 30)).toEqual([112]);
    expect(last && shotSamples(last, 30)).toEqual([120, 150, 180, 210, 240, 270, 300, 330, 360, 390]);
  });

  it('stores what tracking each shot alone stores, with one frame read and one engine call per window', async () => {
    const { reads, frames, engine } = world();
    const meter = createOcrMeter();
    const result = await readShotsText(
      { rate: RATE, shots: SHOTS, every: 30, languages: ['en'] },
      { ocr: engine, frames, meter },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const [i, shot] of SHOTS.entries()) {
      const samples = shotSamples(shot, 30).map(pixels);
      const pages = await recognizeWithReuse(world().engine, samples, { languages: ['en'] });
      if (!pages.ok) throw new Error(pages.error.code);
      const alone = await trackOnScreenText({
        rate: RATE,
        pages: pages.value,
        endFrame: shot.end,
      });
      expect(result.value[i]).toEqual(alone.ok && alone.value);
    }
    expect(result.value.map((shot) => shot.map((t) => t.text))).toEqual([
      ['Opening title'],
      ['Flash card'],
      ['Garlic cream pasta'],
    ]);
    // One window (15 samples ≤ 32): the samples are the only frames read, in one engine call.
    expect(reads).toEqual([[0, 30, 60, 90, 107, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390]]);
    expect(engine.calls).toHaveLength(1);
    expect(meter.counts()).toMatchObject({ sampled: 15, tracks: 3, flickers: 0, refineCalls: 0 });
  });

  it('stores sample-grain edges: every stored instant shows the text, each end at most a sample short', async () => {
    const { frames, engine } = world();
    const result = await readShotsText(
      { rate: RATE, shots: SHOTS, every: 30, languages: ['en'] },
      { ocr: engine, frames },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const texts = result.value.flat();
    for (const text of texts) {
      const start = text.range.start.value;
      const end = start + text.range.duration.value;
      const shows = (f: number) => shown(f).some((o) => o.text === text.text);
      for (let f = start; f < end; f++) expect(shows(f)).toBe(true);
      // The first frame that shows it is under one sample (30 frames) before the stored start; likewise the end.
      let first = start;
      while (shows(first - 1)) first--;
      let last = end - 1;
      while (shows(last + 1)) last++;
      expect(start - first).toBeLessThan(30);
      expect(last + 1 - end).toBeLessThan(30);
    }
    expect(texts.map((t) => [t.text, t.range.start.value, t.range.duration.value])).toEqual([
      ['Opening title', 30, 31],
      // Seen in one sample (the sub-second shot's middle frame): kept, one frame long.
      ['Flash card', 107, 1],
      ['Garlic cream pasta', 210, 91],
    ]);
  });

  it('splits long assets into windows', async () => {
    const { reads, frames, engine } = world();
    // Past every text: all frames look alike.
    const shots = [
      { start: 400, end: 490 },
      { start: 490, end: 580 },
    ];
    const result = await readShotsText(
      { rate: RATE, shots, every: 30, languages: ['en'] },
      { ocr: engine, frames },
      { window: 2 },
    );
    expect(result.ok && result.value.length).toBe(2);
    expect(reads).toEqual([
      [420, 450, 480],
      [510, 540, 570],
    ]);
  });

  it('never reuses a page across a cut', async () => {
    const { frames, engine } = world();
    // The second shot's first sample looks like the first shot's last, yet it is read.
    // Past every text: all frames look alike.
    const shots = [
      { start: 400, end: 490 },
      { start: 490, end: 580 },
    ];
    const result = await readShotsText(
      { rate: RATE, shots, every: 30, languages: ['en'] },
      { ocr: engine, frames },
    );
    expect(result.ok).toBe(true);
    expect(engine.calls[0]?.frames).toEqual([420, 510]);
  });

  it('drops texture readings before tracking, so they cost no refinement reads', async () => {
    const reads: number[][] = [];
    const frames = async (indexes: readonly number[]) => {
      reads.push([...indexes]);
      return ok(indexes.map((f) => frame(f, 8, 8, f % 60)));
    };
    // Busy texture: a new garbage reading on every other sample.
    const engine = fakeEngine(LATIN_CAPS, (f: OcrFrame) =>
      f.index % 60 === 0 ? [observation('٠٠٠', LOW)] : [],
    );
    const result = await readShotsText(
      { rate: RATE, shots: [{ start: 0, end: 300 }], every: 30, languages: ['en'] },
      { ocr: engine, frames },
    );
    expect(result.ok && result.value).toEqual([[]]);
    expect(reads).toHaveLength(1);
  });

  it('passes cancellation through', async () => {
    const { frames, engine } = world();
    const controller = new AbortController();
    controller.abort();
    const result = await readShotsText(
      { rate: RATE, shots: SHOTS, every: 30, languages: ['en'] },
      { ocr: engine, frames },
      { signal: controller.signal },
    );
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });
});
