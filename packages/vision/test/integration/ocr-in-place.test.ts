// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text that changes in place, read by the real mac helper (IX-O4): a running
 * clock over moving content with a title under it, a scoreboard whose score
 * changes, and a title over busy texture, drawn into frames with a pixel font
 * (no video, no decode). Samples a second on a 30 fps grid; the clock and the
 * scoreboard go through the tracker with refinement reads that draw and read
 * the frames they ask for (the breakdown's path), the texture through
 * indexing's reader (sample-grain edges, no refinement). Skips
 * without the helper (native/mac-helper/build.sh). Setup awaits the helper's
 * real warm-up before functional timing begins.
 */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, ok } from '@taalcut/core';
import { createJsonLineSidecar, createSidecarResolver, type JsonLineSidecar } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppleVisionOcr } from '../../src/ocr/apple-vision';
import { isCounter } from '../../src/ocr/counter-text';
import { createOcrMeter } from '../../src/ocr/meter';
import { plausible, writtenBy } from '../../src/ocr/plausible';
import { readShotsText } from '../../src/ocr/read-shots';
import { recognizeWithReuse } from '../../src/ocr/reuse';
import { trackOnScreenText } from '../../src/ocr/track';
import type { OcrFrames } from '../../src/ocr/track-refine';
import type { OcrEngine, OcrFrame } from '../../src/ocr/types';
import {
  OCR_READY_TIMEOUT_MS,
  OCR_SETUP_TIMEOUT_MS,
  prepareOcrFixture,
} from '../ocr/helpers/fixture-startup';
import {
  backdrop,
  busyTexture,
  clockText,
  movingStripes,
  pixelFrame,
  soften,
  type Overlay,
} from '../ocr/helpers/pixel-text';

const helper = await createSidecarResolver({
  name: 'taalcut-mac-helper',
  development: true,
  pin: '',
  env: process.env,
}).resolve();

const FPS = 30;
const W = 1280;
const H = 720;
const END = 300;

/** Reads the samples a second, then tracks with refinement reads of frames drawn on demand. */
async function read(ocr: OcrEngine, draw: (frame: number) => OcrFrame) {
  const meter = createOcrMeter();
  const samples = Array.from({ length: END / FPS }, (_, i) => draw(i * FPS));
  const pages = await recognizeWithReuse(ocr, samples, { languages: ['en'], meter });
  if (!pages.ok) throw new Error(pages.error.code);
  const ocrFrames: OcrFrames = async (frames) =>
    ocr.recognize(
      frames.map((f) => draw(f)),
      { languages: ['en'], meter },
    );
  const texts = await trackOnScreenText(
    { rate: FrameRate.of(FPS), pages: pages.value, endFrame: END, ocrFrames },
    { meter },
  );
  if (!texts.ok) throw new Error(texts.error.code);
  return { texts: texts.value, counts: meter.counts() };
}

const span = (t: { range: { start: { value: number }; duration: { value: number } } }) => [
  t.range.start.value,
  t.range.start.value + t.range.duration.value,
];

describe.skipIf(!helper.ok)('text that changes in place (mac helper)', () => {
  let temp: string;
  let sidecar: JsonLineSidecar;
  let ocr: OcrEngine;

  beforeAll(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-ocr-inplace-')));
    sidecar = createJsonLineSidecar({
      command: helper.ok ? helper.value.path : '',
      args: ['serve', '--services', 'ocr,image', '--allow-root', temp],
      readyTimeoutMs: OCR_READY_TIMEOUT_MS,
    });
    ocr = createAppleVisionOcr(sidecar, { tempDir: temp });
    await prepareOcrFixture(sidecar, ocr);
  }, OCR_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await sidecar?.close();
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  it('keeps a running clock over moving content one text, and the title under it whole', async () => {
    const draw = (frame: number) => {
      const overlays: Overlay[] = [{ text: clockText(frame, FPS), left: 300, top: 40, scale: 6 }];
      if (frame >= 95 && frame < 205) overlays.push({ text: 'LIVE TONIGHT', left: 300, top: 520, scale: 9 });
      return soften(pixelFrame(frame, W, H, movingStripes, overlays), 2);
    };
    const { texts, counts } = await read(ocr, draw);
    console.warn(
      `clock: ${JSON.stringify(texts.map((t) => [t.text, ...span(t)]))} ${JSON.stringify(counts)}`,
    );
    // Vision misreads some ticks ("00-00:01.500"); whatever it reads there is one counter over the whole clip.
    const top = texts.filter((t) => t.box.y < 0.2);
    expect(top.map((t) => isCounter(t.text))).toEqual([true]);
    expect(top.map(span)).toEqual([[0, END]]);
    const titles = texts.filter((t) => t.text === 'LIVE TONIGHT').map(span);
    expect(titles).toHaveLength(1);
    // 1 fps samples and 3 bisection reads per edge: each edge within 4 frames.
    const [from = -1, to = -1] = titles[0] ?? [];
    expect(Math.abs(from - 95)).toBeLessThanOrEqual(4);
    expect(Math.abs(to - 205)).toBeLessThanOrEqual(4);
  });

  it('keeps a scoreboard: its names whole, and at most one text where the score changes', async () => {
    const score = (frame: number) => (frame < 100 ? '2 - 1' : frame < 200 ? '3 - 1' : '10 - 1');
    const draw = (frame: number) =>
      soften(
        pixelFrame(frame, W, H, backdrop, [
          { text: 'HOME', left: 80, top: 60, scale: 6 },
          { text: score(frame), left: 520, top: 60, scale: 6 },
          { text: 'AWAY', left: 900, top: 60, scale: 6 },
        ]),
        2,
      );
    const { texts, counts } = await read(ocr, draw);
    console.warn(
      `scoreboard: ${JSON.stringify(texts.map((t) => [t.text, ...span(t)]))} ${JSON.stringify(counts)}`,
    );
    for (const name of ['HOME', 'AWAY'])
      expect(texts.filter((t) => t.text === name).map(span), name).toEqual([[0, END]]);
    // Vision reads a lone digit as one character (dropped) and "10-1" at low confidence: one counter at most.
    const scores = texts.filter((t) => t.box.x > 0.38 && t.box.x < 0.65);
    expect(scores.length).toBeLessThanOrEqual(1);
  });

  it('keeps a title over busy texture, and nothing no English writer could have written', async () => {
    const draw = (frame: number) =>
      pixelFrame(
        frame,
        W,
        H,
        busyTexture,
        frame >= 65 && frame < 235 ? [{ text: 'NEW SETUP 2026', left: 240, top: 300, scale: 9 }] : [],
      );
    const meter = createOcrMeter();
    const shots = await readShotsText(
      { rate: FrameRate.of(FPS), shots: [{ start: 0, end: END }], every: FPS, languages: ['en'] },
      { ocr, frames: async (indexes) => ok(indexes.map(draw)), meter },
    );
    if (!shots.ok) throw new Error(shots.error.code);
    const texts = shots.value[0] ?? [];
    console.warn(
      `texture: ${JSON.stringify(texts.map((t) => [t.text, ...span(t)]))} ${JSON.stringify(meter.counts())}`,
    );
    const en = writtenBy(['en']);
    for (const t of texts) expect(plausible({ ...t, engine: 'apple-vision' }, en), t.text).toBe(true);
    // Shown over frames 65–234: stored from the first sample that shows it (90) to one frame after the last (210).
    expect(texts.filter((t) => t.text === 'NEW SETUP 2026').map(span)).toEqual([[90, 211]]);
    expect(meter.counts()).toMatchObject({ refineCalls: 0 });
  });
});
