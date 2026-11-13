// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { err, FrameRate, ok, onScreenTextSchema, type NormalisedBox, type OnScreenText } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { OcrFailed } from '../../src/errors';
import { trackOnScreenText } from '../../src/ocr/track';
import { pageShows, refineEdges, type OcrFrames } from '../../src/ocr/track-refine';
import type { OcrObservation, OcrPage } from '../../src/ocr/types';
import { observation } from './helpers/fakes';

const RATE = FrameRate.of(30);
const BOX: NormalisedBox = { x: 0.1, y: 0.8, width: 0.6, height: 0.06 };
const TOP: NormalisedBox = { x: 0.2, y: 0.1, width: 0.6, height: 0.08 };

/** Samples every 8 frames (≈ 4 fps at 30 fps). */
function pages(readings: readonly (readonly OcrObservation[])[], step = 8): OcrPage[] {
  return readings.map((observations, i) => ({ frame: i * step, observations }));
}

function frames(text: OnScreenText): [number, number] {
  return [text.range.start.value, text.range.start.value + text.range.duration.value];
}

/** A frame reader that shows `text` in [from, to). */
function truth(text: string, box: NormalisedBox, from: number, to: number) {
  const calls: number[] = [];
  const ocrFrames: OcrFrames = async (frames) => {
    calls.push(...frames);
    return ok(
      frames.map((frame) => ({
        frame,
        observations: frame >= from && frame < to ? [observation(text, box)] : [],
      })),
    );
  };
  return { calls, ocrFrames };
}

describe('trackOnScreenText', () => {
  it('de-duplicates a caption across samples and refines both edges to the frame', async () => {
    const caption = observation('Save 20% today', BOX, 0.95, 'apple-vision', 'en');
    const misread = observation('Save 20% todav', BOX, 0.6);
    // Visible in frames [13, 45): samples 16, 24, 32, 40 see it; 8 and 48 don't.
    const input = pages([[], [], [caption], [misread], [caption], [caption], []]);
    const oracle = truth('Save 20% today', BOX, 13, 45);
    const result = await trackOnScreenText({ rate: RATE, pages: input, ocrFrames: oracle.ocrFrames });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    const [text] = result.value;
    expect(text).toMatchObject({ text: 'Save 20% today', script: 'latin', language: 'en', reveal: 'none' });
    expect(frames(text!)).toEqual([13, 45]);
    expect(oracle.calls.length).toBeLessThanOrEqual(6);
    expect(onScreenTextSchema.safeParse(text).success).toBe(true);
  });

  it('keeps edges at the samples without refinement, and closes at the end frame', async () => {
    const caption = observation('Follow for more', BOX);
    const result = await trackOnScreenText({ rate: RATE, pages: pages([[caption], [caption]]) });
    expect(result.ok && frames(result.value[0]!)).toEqual([0, 9]);
    // A text still showing at the last sample is bisected up to the end (8 frames: 3 calls reach it).
    const oracle = truth('Follow for more', BOX, 0, 16);
    const toEnd = await trackOnScreenText({
      rate: RATE,
      pages: pages([[caption], [caption]]),
      endFrame: 16,
      ocrFrames: oracle.ocrFrames,
    });
    expect(toEnd.ok && frames(toEnd.value[0]!)).toEqual([0, 16]);
  });

  it('bridges a single OCR dropout but splits after two', async () => {
    const caption = observation('Watch until the end', BOX);
    const bridged = await trackOnScreenText({ rate: RATE, pages: pages([[caption], [], [caption]]) });
    expect(bridged.ok && bridged.value.length).toBe(1);
    const split = await trackOnScreenText({ rate: RATE, pages: pages([[caption], [], [], [caption]]) });
    expect(split.ok && split.value.map(frames)).toEqual([
      [0, 1],
      [24, 25],
    ]);
  });

  it('drops low confidence, one-character and empty readings; keeps two texts apart', async () => {
    const result = await trackOnScreenText({
      rate: RATE,
      pages: pages([
        [
          observation('x', BOX),
          observation('Noise', BOX, 0.1),
          observation('Top line', TOP),
          observation('Bottom', BOX),
        ],
        [observation('Top line', TOP), observation('Bottom', BOX)],
      ]),
    });
    expect(result.ok && result.value.map((t) => t.text)).toEqual(['Top line', 'Bottom']);
  });

  it('picks the most frequent variant, ties to the higher confidence', async () => {
    const result = await trackOnScreenText({
      rate: RATE,
      pages: pages([
        [observation('Mira el video', BOX, 0.7)],
        [observation('Mira el vídeo', BOX, 0.9)],
        [observation('Mira el video', BOX, 0.6)],
        [observation('Mira el vídeo', BOX, 0.8)],
      ]),
    });
    expect(result.ok && result.value.map((t) => t.text)).toEqual(['Mira el vídeo']);
  });

  it('marks a word-by-word reveal and a typewriter reveal', async () => {
    const words = ['Aula', 'Aula grátis', 'Aula grátis amanhã'].map((t, i) =>
      observation(t, { ...BOX, width: 0.2 + 0.2 * i }),
    );
    const byWord = await trackOnScreenText({
      rate: RATE,
      pages: pages([[words[0]!], [words[1]!], [words[2]!], [words[2]!]]),
    });
    expect(byWord.ok && byWord.value.map((t) => [t.text, t.reveal])).toEqual([
      ['Aula grátis amanhã', 'wordByWord'],
    ]);
    expect(byWord.ok && byWord.value[0]!.box.width).toBeCloseTo(0.6);
    const typed = ['Hel', 'Hello wo', 'Hello world'].map((t, i) =>
      observation(t, { ...BOX, width: 0.2 + 0.2 * i }),
    );
    const typewriter = await trackOnScreenText({
      rate: RATE,
      pages: pages([[typed[0]!], [typed[1]!], [typed[2]!]]),
    });
    expect(typewriter.ok && typewriter.value.map((t) => t.reveal)).toEqual(['typewriter']);
  });

  it('drops a one-sample flicker that refinement does not confirm', async () => {
    const flicker = observation('Ghost', BOX);
    const oracle = truth('Ghost', BOX, 1000, 1001);
    const result = await trackOnScreenText({
      rate: RATE,
      pages: pages([[], [flicker], []]),
      ocrFrames: oracle.ocrFrames,
    });
    expect(result.ok && result.value).toEqual([]);
    const confirmed = truth('Ghost', BOX, 5, 12);
    const kept = await trackOnScreenText({
      rate: RATE,
      pages: pages([[], [flicker], []]),
      ocrFrames: confirmed.ocrFrames,
    });
    expect(kept.ok && kept.value.map(frames)).toEqual([[5, 12]]);
  });

  it('reads a still: one page, one frame', async () => {
    const result = await trackOnScreenText({
      rate: FrameRate.of(1),
      pages: [{ frame: 0, observations: [observation('नमस्ते दोस्तों', TOP, 0.9, 'ppocr-v5', 'hi')] }],
      endFrame: 1,
    });
    expect(result.ok && result.value).toMatchObject([
      { text: 'नमस्ते दोस्तों', script: 'devanagari', language: 'hi' },
    ]);
    expect(result.ok && frames(result.value[0]!)).toEqual([0, 1]);
  });

  it('passes refinement errors and cancellation through', async () => {
    const caption = observation('Save 20% today', BOX);
    const failing = await trackOnScreenText({
      rate: RATE,
      pages: pages([[], [caption]]),
      ocrFrames: async () => err(OcrFailed()),
    });
    expect(!failing.ok && failing.error.code).toBe('vision.ocr_failed');
    const controller = new AbortController();
    controller.abort();
    const cancelled = await trackOnScreenText(
      { rate: RATE, pages: pages([[caption]]) },
      { signal: controller.signal },
    );
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });
});

describe('refineEdges', () => {
  it('bisects within its call budget and stops when adjacent', async () => {
    const oracle = truth('A line', BOX, 3, 100);
    const one = (absent: number, present: number) => [{ absent, present, text: 'A line', box: BOX }];
    const edge = await refineEdges(one(0, 8), oracle.ocrFrames, undefined);
    expect(edge.ok && edge.value).toEqual([{ frame: 3, confirmed: 2, calls: 3 }]);
    const adjacent = await refineEdges(one(7, 8), oracle.ocrFrames, undefined);
    expect(adjacent.ok && adjacent.value[0]?.calls).toBe(0);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await refineEdges(one(0, 8), oracle.ocrFrames, controller.signal);
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });

  it('matches text in about the same place only', () => {
    const page = { frame: 0, observations: [observation('A line', BOX)] };
    expect(pageShows(page, 'A line', BOX)).toBe(true);
    expect(pageShows(page, 'A line', TOP)).toBe(false);
    expect(pageShows(page, 'Something else', BOX)).toBe(false);
  });
});
