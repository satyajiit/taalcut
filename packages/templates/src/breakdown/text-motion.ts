// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the pixels say about each reading (FIX-SIGN): text printed in the scene moves with the picture behind it; text
 * added in editing stays put on the screen while the picture moves, keeps its ink when something passes, and often
 * sits on a still, even fill. For each reading a few frames inside its settled time and inside one shot are read
 * (one decode for all readings, in chunks), in pairs (pairsToRead): where the words went
 * (block matching), where the picture round them went (the median of textured blocks outside the words and any
 * shape round them), and how much of the words' ink changed. Optional: without `framePixels` nothing is measured.
 * Beside FRM1-MOT's estimator, not instead of it: the camera measure starts once the text is judged.
 */
import type { Box } from '@taalcut/core';
import type { PixelRect, RgbFrame } from '../overlay-look';
import type { StepContext } from './steps';
import type { PixelEvidence } from './text-signals';
import {
  bestShift,
  fillOf,
  greyOf,
  halve,
  inkError,
  inkOf,
  sideCover,
  texture,
  type Grey,
} from './text-pixels';
import { shotAt, type Span } from './text-sites';

/** Measured here; its type lives in text-signals.ts so text-scene.ts doesn't import this module. */
export type { PixelEvidence } from './text-signals';

/** The reference frame round the words, for asking the vision model (text-check.ts). */
export interface ContextCrop {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
  readonly words: PixelRect;
}

export const TEXT_PIXELS = {
  /** The longest readings are measured first, at most this many. */
  maxReadings: 48,
  /** Anchor frames per reading, and how far each one's partner comes after it. */
  anchors: 4,
  gapFrames: 3,
  /** Frames asked of the decoder at once. */
  chunk: 32,
  maxDimension: 720,
  /** Frames left out at each end of a reading: an entrance or exit animation. */
  settleFrames: 6,
  /** Background blocks per pair, at most. */
  maxBlocks: 16,
} as const;

interface Plan {
  readonly index: number;
  readonly pairs: readonly (readonly [number, number])[];
  readonly frames: readonly number[];
  readonly box: Box;
}

/**
 * The frame pairs read for a reading: anchors spread over the longest piece of `span` inside one shot (its settling
 * ends left out), each against the frame `gap` later (a fast pan stays inside the search) and against the first
 * anchor (a slow drift adds up). Empty when the piece is too short.
 */
export function pairsToRead(
  span: Span,
  cuts: readonly number[],
  total: number,
): (readonly [number, number])[] {
  const bounds = [
    ...new Set([span.start, ...cuts.filter((cut) => cut > span.start && cut < span.end), span.end]),
  ];
  let piece: Span = { start: span.start, end: span.start };
  for (let i = 0; i + 1 < bounds.length; i++)
    if (bounds[i + 1]! - bounds[i]! > piece.end - piece.start)
      piece = { start: bounds[i]!, end: bounds[i + 1]! };
  const shot = shotAt(piece.start, cuts, total);
  const start = Math.max(piece.start, shot.start);
  const end = Math.min(piece.end, shot.end);
  const settle = Math.min(TEXT_PIXELS.settleFrames, Math.floor((end - start) / 4));
  const from = start + settle;
  const to = end - 1 - settle;
  if (to - from < 2) return [];
  const gap = Math.min(TEXT_PIXELS.gapFrames, to - from);
  const count = Math.max(1, Math.min(TEXT_PIXELS.anchors, Math.floor((to - from) / gap)));
  const anchors = [
    ...new Set(
      Array.from({ length: count }, (_, k) =>
        Math.round(from + ((to - gap - from) * k) / Math.max(1, count - 1)),
      ),
    ),
  ];
  return [
    ...anchors.map((anchor) => [anchor, anchor + gap] as const),
    ...anchors.slice(1).map((anchor) => [anchors[0]!, anchor] as const),
  ];
}

const clampRect = (rect: PixelRect, width: number, height: number): PixelRect => ({
  left: Math.max(0, Math.min(width - 1, Math.floor(rect.left))),
  top: Math.max(0, Math.min(height - 1, Math.floor(rect.top))),
  right: Math.max(1, Math.min(width, Math.ceil(rect.right))),
  bottom: Math.max(1, Math.min(height, Math.ceil(rect.bottom))),
});
/** `rect` grown by whole pixels: every rectangle here indexes pixels. */
const grown = (rect: PixelRect, x: number, y: number): PixelRect => ({
  left: Math.floor(rect.left - x),
  top: Math.floor(rect.top - y),
  right: Math.ceil(rect.right + x),
  bottom: Math.ceil(rect.bottom + y),
});
const local = (rect: PixelRect, origin: PixelRect): PixelRect => ({
  left: rect.left - origin.left,
  top: rect.top - origin.top,
  right: rect.right - origin.left,
  bottom: rect.bottom - origin.top,
});
const meets = (a: PixelRect, b: PixelRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const toPixels = (box: Box, width: number, height: number): PixelRect =>
  clampRect(
    {
      left: box.x * width,
      top: box.y * height,
      right: (box.x + box.width) * width,
      bottom: (box.y + box.height) * height,
    },
    width,
    height,
  );

/** The rectangles one reading is measured in, in its region's pixels. */
interface Layout {
  readonly region: PixelRect;
  readonly words: PixelRect;
  /** The words with a little of what is round them: what is matched. */
  readonly patch: PixelRect;
  readonly blocks: readonly PixelRect[];
  readonly radius: number;
  readonly textHeight: number;
}

function layoutFor(box: Box, others: readonly Box[], width: number, height: number): Layout {
  const words = toPixels(box, width, height);
  const h = Math.max(4, words.bottom - words.top);
  const radius = Math.min(20, Math.max(6, Math.round(1.2 * h)));
  // A bubble's or a pill's shape reaches about a line's height round its words: blocks start past it.
  const shape = grown(words, Math.max(1.2 * h, 0.15 * (words.right - words.left)), h);
  const band = grown(shape, 3 * h, 3 * h);
  const region = clampRect(grown(band, radius, radius), width, height);
  const size = Math.min(24, Math.max(12, Math.round(1.5 * h)));
  const avoid = others.map((other) => grown(toPixels(other, width, height), 0.5 * h, 0.5 * h));
  const blocks: PixelRect[] = [];
  for (let top = band.top; top + size <= band.bottom; top += size)
    for (let left = band.left; left + size <= band.right; left += size) {
      const block = { left, top, right: left + size, bottom: top + size };
      const inside =
        block.left - radius >= region.left &&
        block.top - radius >= region.top &&
        block.right + radius <= region.right &&
        block.bottom + radius <= region.bottom;
      if (inside && !meets(block, shape) && !avoid.some((rect) => meets(block, rect)))
        blocks.push(local(block, region));
    }
  const patch = clampRect(grown(words, Math.max(2, 0.3 * h), Math.max(2, 0.3 * h)), width, height);
  return {
    region,
    words: local(words, region),
    patch: local(patch, region),
    blocks,
    radius,
    textHeight: h,
  };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[sorted.length >> 1]!;
};

/** The evidence from one reading's crops (by frame) over its pairs. */
export function evidenceFrom(
  crops: ReadonlyMap<number, Grey>,
  pairs: readonly (readonly [number, number])[],
  layout: Layout,
): PixelEvidence | null {
  const first = crops.get(pairs[0]?.[0] ?? -1);
  if (!first || pairs.length === 0) return null;
  const { words, patch, radius } = layout;
  const blocks = layout.blocks.filter((block) => texture(first, block) >= 4);
  const step = Math.max(1, Math.ceil(blocks.length / TEXT_PIXELS.maxBlocks));
  const used = blocks.filter((_, k) => k % step === 0);
  const { contrast } = inkOf(first, words);
  const halves = new Map([...crops].map(([frame, crop]) => [frame, halve(crop)]));
  let withPicture = 0;
  let fixedOnPicture = 0;
  let ownMove = 0;
  let covered = 0;
  let measured = 0;
  let informative = 0;
  let ownStill = 0;
  const inks = new Map<number, Uint8Array>();
  for (const [from, to] of pairs) {
    const reference = crops.get(from)!;
    const crop = crops.get(to)!;
    const halved = { a: halves.get(from)!, b: halves.get(to)! };
    const shift = bestShift(reference, crop, patch, radius, halved);
    // A block counts when its match explains the change (one that moved past the search fits nowhere); the words
    // too, or when their own ink matches after the shift, whatever shows between the letters.
    const moves = used
      .map((block) => bestShift(reference, crop, block, radius, halved))
      .filter((m) => m.error <= Math.max(4, 0.5 * m.still));
    if (moves.length < 3) continue;
    const picture = { dx: median(moves.map((m) => m.dx)), dy: median(moves.map((m) => m.dy)) };
    covered = Math.max(covered, sideCover(reference, crop, words, shift, Math.max(30, 0.25 * contrast)));
    if (!inks.has(from)) inks.set(from, inkOf(reference, words).ink);
    const explained = shift.error <= Math.max(4, 0.6 * shift.still);
    if (!explained && inkError(reference, crop, words, inks.get(from)!, shift) > Math.max(8, 0.15 * contrast))
      continue;
    measured++;
    const agree = moves.filter(
      (m) => Math.max(Math.abs(m.dx - picture.dx), Math.abs(m.dy - picture.dy)) <= 1.5,
    ).length;
    const reliable = agree >= moves.length / 2;
    const pictureMoved = Math.hypot(picture.dx, picture.dy);
    const wordsMoved = Math.hypot(shift.dx, shift.dy);
    // The words moved as part of the picture round them: enough blocks moved as they did (a scene moves unevenly,
    // with parallax and a hand's roll, so not every block agrees).
    const support = moves.filter(
      (m) => Math.hypot(m.dx - shift.dx, m.dy - shift.dy) <= Math.max(1.5, 0.3 * wordsMoved),
    ).length;
    if (wordsMoved >= 1.5 && support >= Math.max(3, moves.length / 4)) {
      const weight = Math.min(1, wordsMoved / 4);
      informative += weight;
      withPicture += weight;
    } else if (reliable && pictureMoved >= 1.5) {
      // Most of the picture moved one way: the words stayed put on the screen, or moved their own way.
      const weight = Math.min(1, pictureMoved / 4);
      informative += weight;
      if (wordsMoved <= 0.75) fixedOnPicture += weight;
      else ownMove += weight;
    } else if (reliable) {
      // The picture held still: the words moving on their own is a shirt or a bus.
      ownStill += 1;
      if (wordsMoved >= 1.5) ownMove += Math.min(1, wordsMoved / 4);
    }
  }
  const fill = fillOf([...crops.values()], words);
  return {
    pairs: measured,
    // Shares of the pairs where the picture moved, a pair and a half of them before a share counts in full.
    withPicture: withPicture / Math.max(1.5, informative),
    fixedOnPicture: fixedOnPicture / Math.max(1.5, informative),
    ownMove: ownMove / Math.max(1.5, informative + ownStill),
    covered,
    fill: fill.evenness,
    bounded: fill.bounded,
    contrast,
  };
}

const contextOf = (frame: RgbFrame, layout: Layout): ContextCrop => {
  const { region, words, textHeight } = layout;
  const absolute = {
    left: words.left + region.left,
    top: words.top + region.top,
    right: words.right + region.left,
    bottom: words.bottom + region.top,
  };
  const rect = clampRect(
    grown(absolute, Math.max(2 * textHeight, 0.6 * (absolute.right - absolute.left)), 3 * textHeight),
    frame.width,
    frame.height,
  );
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = ((rect.top + y) * frame.width + rect.left) * 3;
    rgb.set(frame.rgb.subarray(from, from + width * 3), y * width * 3);
  }
  return { width, height, rgb, words: local(absolute, rect) };
};

/** A piece of text to measure: where it is and its frames [start, end). */
export interface TextPlace {
  readonly box: Box;
  readonly start: number;
  readonly end: number;
}

/**
 * Each place's pixel evidence and the frame round it (index-aligned with `places`; null when unmeasured). `cuts`
 * are the frames shots start at (not 0).
 */
export async function measureTextPixels(
  ctx: StepContext,
  places: readonly TextPlace[],
  cuts: readonly number[],
): Promise<{ evidence: (PixelEvidence | null)[]; context: (ContextCrop | null)[]; warnings: string[] }> {
  const evidence: (PixelEvidence | null)[] = places.map(() => null);
  const context: (ContextCrop | null)[] = places.map(() => null);
  const pixels = ctx.analysers.media.framePixels;
  if (!pixels || places.length === 0) return { evidence, context, warnings: [] };
  const plans: Plan[] = places
    .map((place, index) => {
      const pairs = pairsToRead(place, cuts, ctx.total);
      return { index, pairs, frames: [...new Set(pairs.flat())].sort((a, b) => a - b), box: place.box };
    })
    .filter((plan) => plan.pairs.length > 0 && plan.box.width > 0 && plan.box.height > 0)
    .sort(
      (a, b) =>
        places[b.index]!.end - places[b.index]!.start - (places[a.index]!.end - places[a.index]!.start),
    )
    .slice(0, TEXT_PIXELS.maxReadings);
  const wanted = [...new Set(plans.flatMap((plan) => plan.frames))].sort((a, b) => a - b);
  const crops = new Map<number, Map<number, Grey>>(plans.map((plan) => [plan.index, new Map()]));
  const layouts = new Map<number, Layout>();
  let failed = 0;
  for (let at = 0; at < wanted.length && !ctx.signal.aborted; at += TEXT_PIXELS.chunk) {
    const chunk = wanted.slice(at, at + TEXT_PIXELS.chunk);
    const got = await pixels(ctx.path, chunk, {
      rate: ctx.rate,
      maxDimension: TEXT_PIXELS.maxDimension,
      signal: ctx.signal,
    });
    if (!got.ok) {
      failed++;
      continue;
    }
    for (const frame of got.value)
      for (const plan of plans) {
        if (!plan.frames.includes(frame.frame)) continue;
        let layout = layouts.get(plan.index);
        if (!layout) {
          // Other text showing at the same time is not the picture behind.
          const first = plan.frames[0]!;
          const others = places
            .filter((other, k) => k !== plan.index && other.start <= first && first < other.end)
            .map((other) => other.box);
          layout = layoutFor(plan.box, others, frame.width, frame.height);
          layouts.set(plan.index, layout);
        }
        crops.get(plan.index)!.set(frame.frame, greyOf(frame, layout.region));
        if (frame.frame === plan.frames[0]) context[plan.index] = contextOf(frame, layout);
      }
  }
  for (const plan of plans) {
    const layout = layouts.get(plan.index);
    const read = crops.get(plan.index)!;
    // Every frame or none: a place missing a frame would compare the wrong ones.
    if (layout && read.size === plan.frames.length)
      evidence[plan.index] = evidenceFrom(read, plan.pairs, layout);
  }
  return { evidence, context, warnings: failed > 0 ? [`text_pixels_failed: ${failed}`] : [] };
}
