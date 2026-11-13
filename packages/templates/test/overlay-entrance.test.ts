// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: an overlay's entrance judged over the frames round its appearance, never one frame (the owner's bubbles
 * read as cuts): a one-frame pop, a pop that lands between the sparse early frames (read again round it), a cut
 * that stays a cut, and "can't tell" kept apart from a cut, on made-up frames.
 */
import { describe, expect, it } from 'vitest';
import { FrameRate, ok, RationalTime, textOverlaySchema, type TextOverlay } from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import { readOverlayDesigns } from '../src/breakdown/overlay-design';
import type { BreakdownAnalysers } from '../src/breakdown/ports';
import type { StepContext } from '../src/breakdown/steps';
import { crop, edgeFramesFor } from '../src/overlay-look';
import { entranceOf, presence, type Mask } from '../src/overlay-look/motion';
import { boxOf, drawFrame, HEIGHT, type DrawnOverlay } from './helpers/overlay-frames';

const RATE = FrameRate.of(30);
const ID = '01JHFW1TPA0000000000000001';
const TOTAL = 120;

const bubble = (over: Partial<DrawnOverlay> = {}): DrawnOverlay => ({
  words: [120, 150, 96, 14],
  pad: { x: 22, y: 9 },
  fill: [242, 242, 247],
  ink: [12, 12, 14],
  radius: 0.36,
  tail: 'right',
  start: 30,
  end: 90,
  ...over,
});

const overlayFor = (drawn: DrawnOverlay): TextOverlay =>
  textOverlaySchema.parse({
    id: ID,
    text: 'Made-up words here',
    role: 'caption',
    start: RationalTime.of(drawn.start, RATE),
    duration: RationalTime.of(drawn.end - drawn.start, RATE),
    slotId: null,
    box: boxOf(drawn),
    appearance: { size: drawn.words[3] / HEIGHT, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'caption',
    reveal: 'none',
    language: 'en',
    confidence: 0.9,
  });

async function read(drawn: DrawnOverlay, total = TOTAL) {
  const asked: number[][] = [];
  const ctx: StepContext = {
    path: '/made-up/reel.mp4',
    dir: '/made-up/work',
    rate: RATE,
    total,
    analysers: {
      media: {
        framePixels: async (_path: string, frames: readonly number[]) => {
          asked.push([...frames]);
          return ok(frames.map((frame) => drawFrame(frame, [drawn])));
        },
      },
    } as unknown as BreakdownAnalysers,
    config: BREAKDOWN_CONFIG,
    signal: new AbortController().signal,
  };
  const done = await readOverlayDesigns(ctx, [overlayFor(drawn)]);
  if (!done.ok) throw new Error(done.error.code);
  return { design: done.value.overlays[0]!.design, asked };
}

describe('an entrance judged over the frames round it (HFW1)', () => {
  it('reads a one-frame pop as a pop: the frame under a third there is part-way, not missing', async () => {
    // The shape comes on six frames before the words with typing dots, under 30 % on its first frame.
    const { design } = await read(bubble({ typingFrames: 6, popFrames: 1 }));
    expect(design?.motion.typing).toBe(true);
    expect(design?.motion.enter).toBe('pop');
  });

  it('reads a pop that lands between the sparse early frames, reading the frames round it again', async () => {
    const { design, asked } = await read(bubble({ typingFrames: 20, popFrames: 1 }));
    expect(design?.motion.enter).toBe('pop');
    // One decode for the overlay, then one for the frames round where its shape came on.
    expect(asked).toHaveLength(2);
    expect(asked[1]).toEqual(expect.arrayContaining([10, 11]));
  });

  it('keeps a cut a cut: gone on one frame, all there on the next, nothing between', async () => {
    const { design, asked } = await read(bubble());
    expect(design?.motion).toMatchObject({ enter: 'none', exit: 'none' });
    expect(asked).toHaveLength(1);
  });

  it('stores "can’t tell" apart from a cut: on from the reel’s first frame, or on to its last', async () => {
    const { design } = await read(bubble({ start: 0, end: 60 }));
    expect(design?.motion.enter).toBe('unknown');
    const late = await read(bubble({ start: 40, end: TOTAL }));
    expect(late.design?.motion.exit).toBe('unknown');
  });

  it('is unknown when the frame before the appearance was not read', () => {
    const drawn = bubble();
    const region = { left: 60, top: 100, right: 300, bottom: 220 };
    const at = (frame: number) => ({ frame, image: crop(drawFrame(frame, [drawn]), region) });
    const rect = { left: 98 - 60, top: 141 - 100, right: 238 - 60, bottom: 173 - 100 };
    const mask: Mask = { rect, hole: { left: 60, top: 50, right: 156, bottom: 64 }, colour: [242, 242, 247] };
    const full = presence(at(60).image, mask);
    expect(entranceOf({ frames: [at(30), at(31), at(32)] }, mask, full, 30)).toBe('unknown');
    expect(entranceOf({ frames: [at(29), at(30), at(31), at(32)] }, mask, full, 30)).toBe('none');
  });

  it('names the frames round an appearance and an end, inside the reel', () => {
    expect(edgeFramesFor(30, 90, TOTAL)).toEqual([
      26, 27, 28, 29, 30, 31, 32, 33, 34, 86, 87, 88, 89, 90, 91,
    ]);
    expect(edgeFramesFor(1, 119, TOTAL).every((frame) => frame >= 0 && frame < TOTAL)).toBe(true);
  });
});
