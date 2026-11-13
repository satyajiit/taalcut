// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-GFX: an overlay's design read from synthetic frames: a chat bubble with its colours and tail, a pill, words
 * on the picture, a fade and a cut, typing dots, and the step's own rules (scene text unread, no pixels no design).
 */
import { describe, expect, it } from 'vitest';
import {
  FrameRate,
  ok,
  RationalTime,
  textOverlaySchema,
  type OverlayDesign,
  type TextOverlay,
} from '@taalcut/core';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import { framesFor, readOverlayDesigns } from '../src/breakdown/overlay-design';
import type { BreakdownAnalysers } from '../src/breakdown/ports';
import type { StepContext } from '../src/breakdown/steps';
import type { RgbFrame } from '../src/overlay-look';
import { boxOf, drawFrame, HEIGHT, soften, type DrawnOverlay } from './helpers/overlay-frames';

const RATE = FrameRate.of(30);
const ID1 = '01JBRK1GFX0000000000000001';
const ID2 = '01JBRK1GFX0000000000000002';
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

function overlayFor(drawn: DrawnOverlay, id: string, extra: Partial<TextOverlay> = {}): TextOverlay {
  return textOverlaySchema.parse({
    id,
    text: 'How was your trip',
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
    ...extra,
  });
}

function context(
  drawn: readonly DrawnOverlay[],
  pixels = true,
  look: (image: RgbFrame) => RgbFrame = (image) => image,
): StepContext & { asked: number[][] } {
  const asked: number[][] = [];
  const media = {
    ...(pixels
      ? {
          framePixels: async (_path: string, frames: readonly number[]) => {
            asked.push([...frames]);
            return ok(frames.map((frame) => look(drawFrame(frame, drawn))));
          },
        }
      : {}),
  };
  return {
    path: '/synthetic/reel.mp4',
    dir: '/synthetic/work',
    rate: RATE,
    total: TOTAL,
    analysers: { media } as unknown as BreakdownAnalysers,
    config: BREAKDOWN_CONFIG,
    signal: new AbortController().signal,
    asked,
  };
}

async function designOf(drawn: DrawnOverlay): Promise<OverlayDesign | undefined> {
  const read = await readOverlayDesigns(context([drawn]), [overlayFor(drawn, ID1)]);
  if (!read.ok) throw new Error(read.error.code);
  return read.value.overlays[0]!.design;
}

const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const near = (hex: string, colour: readonly number[], within: number) =>
  channels(hex).every((value, index) => Math.abs(value - colour[index]!) <= within);

describe('reading an overlay’s design (BRK1-GFX)', () => {
  it('reads a white chat bubble with its tail on the right, its colours and its cut', async () => {
    const design = await designOf(bubble());
    expect(design?.kind).toBe('chatBubble');
    expect(design?.tail).toBe('right');
    expect(near(design!.colors.fill!, [242, 242, 247], 3)).toBe(true);
    expect(near(design!.colors.text, [12, 12, 14], 12)).toBe(true);
    expect(design?.cornerRadius).toBeGreaterThan(0.2);
    expect(design?.motion).toEqual({ enter: 'none', exit: 'none', typing: false });
    // The shape, not the words: wider than the words by the padding.
    expect(design!.shape!.width * 360).toBeGreaterThan(96 + 30);
    expect(design!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('reads a green bubble’s tail on the left', async () => {
    const design = await designOf(bubble({ fill: [217, 253, 211], tail: 'left' }));
    expect(design?.kind).toBe('chatBubble');
    expect(design?.tail).toBe('left');
    expect(near(design!.colors.fill!, [217, 253, 211], 3)).toBe(true);
  });

  it('reads both tails through the softening the pipeline’s analysis copy adds (BRK1 gate)', async () => {
    // The gate's failing case: the reel's small tails (a fifth of the bubble's height), the words' box as OCR finds
    // it, and edges blurred by the analysis copy's scale and encode, so no bottom corner reads square.
    for (const [tail, fill] of [
      ['right', [242, 242, 247]],
      ['left', [217, 253, 211]],
    ] as const) {
      const drawn = bubble({ fill, tail, tailReach: 0.22, hook: true, pad: { x: 24, y: 8 } });
      const read = await readOverlayDesigns(context([drawn], true, soften), [overlayFor(drawn, ID1)]);
      const design = read.ok ? read.value.overlays[0]!.design : undefined;
      expect(design?.kind, tail).toBe('chatBubble');
      expect(design?.tail).toBe(tail);
    }
    // The reply's read ticks are read, and a bubble without them has none.
    const ticked = bubble({
      fill: [217, 253, 211],
      tail: 'left',
      hook: true,
      tailReach: 0.22,
      receipt: true,
      pad: { x: 36, y: 9 },
    });
    const withTicks = await readOverlayDesigns(context([ticked], true, soften), [overlayFor(ticked, ID1)]);
    expect(withTicks.ok && withTicks.value.overlays[0]!.design?.receipt).toBe(true);
    const plainBubble = bubble({ tail: 'right', hook: true, tailReach: 0.22 });
    const without = await readOverlayDesigns(context([plainBubble], true, soften), [
      overlayFor(plainBubble, ID1),
    ]);
    expect(without.ok && without.value.overlays[0]!.design?.receipt).toBeUndefined();
    // And a softened pill stays a pill: blur alone grows no tail.
    const pill = bubble({ tail: 'none', radius: 0.5 });
    const read = await readOverlayDesigns(context([pill], true, soften), [overlayFor(pill, ID1)]);
    expect(read.ok && read.value.overlays[0]!.design?.kind).toBe('pill');
  });

  it('reads round ends without a tail as a pill, and square ones as a label', async () => {
    expect((await designOf(bubble({ tail: 'none', radius: 0.5 })))?.kind).toBe('pill');
    const label = await designOf(bubble({ tail: 'none', radius: 0.12 }));
    expect(label?.kind).toBe('label');
    expect(label?.cornerRadius).toBeLessThan(0.25);
  });

  it('reads words on the picture as plain, with their colour', async () => {
    const design = await designOf(bubble({ pad: null, ink: [250, 220, 40], tail: 'none' }));
    expect(design?.kind).toBe('plain');
    expect(design?.colors.fill).toBeNull();
    expect(near(design!.colors.text, [250, 220, 40], 6)).toBe(true);
    expect(design?.shape).toBeUndefined();
  });

  it('reads a fade in from the frames round its start', async () => {
    const design = await designOf(bubble({ fadeFrames: 4 }));
    expect(design?.motion.enter).toBe('fade');
  });

  it('reads typing dots before the words', async () => {
    const design = await designOf(bubble({ typingFrames: 9 }));
    expect(design?.kind).toBe('chatBubble');
    expect(design?.motion.typing).toBe(true);
    expect(design?.motion.enter).toBe('none');
  });

  it('marks a filled shape’s overlay as boxed and leaves the others alone', async () => {
    const drawn = [bubble(), bubble({ words: [120, 400, 96, 14], start: 40, end: 44 })];
    const ctx = context(drawn);
    const read = await readOverlayDesigns(ctx, [overlayFor(drawn[0]!, ID1), overlayFor(drawn[1]!, ID2)]);
    expect(read.ok && read.value.overlays.map((overlay) => overlay.appearance.background)).toEqual([
      'box',
      'none',
    ]);
    // The four-frame flash goes unread: one decode, for the bubble.
    expect(ctx.asked).toHaveLength(1);
  });

  it('leaves text that may be part of the scene unread, and everything plain without pixels', async () => {
    const drawn = bubble();
    const doubted = overlayFor(drawn, ID1, { doubts: [{ reason: 'textMaybeScene', confidence: 0.8 }] });
    const ctx = context([drawn]);
    const read = await readOverlayDesigns(ctx, [doubted]);
    expect(read.ok && read.value.overlays[0]!.design).toBeUndefined();
    expect(ctx.asked).toHaveLength(0);

    const without = await readOverlayDesigns(context([drawn], false), [overlayFor(drawn, ID1)]);
    expect(without.ok && without.value).toEqual({
      overlays: [overlayFor(drawn, ID1)],
      warnings: [],
      leads: {},
    });
  });

  it('asks for settled frames inside the overlay and every frame round its edges', () => {
    const { settled, edges } = framesFor(30, 90, TOTAL);
    expect(settled.every((frame) => frame >= 32 && frame <= 87)).toBe(true);
    expect(settled.length).toBe(5);
    expect(edges).toEqual(expect.arrayContaining([18, 29, 30, 31, 32, 87, 88, 89, 90]));
    expect(framesFor(0, 10, 10).edges.every((frame) => frame >= 0 && frame < 10)).toBe(true);
  });
});
