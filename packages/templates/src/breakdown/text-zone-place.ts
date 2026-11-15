// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sequence's place (LYR1): where its words show, from the readings that chained, what is cut out and read round
 * them, and which line of a page is the place's word. A word is on the words' own line, in their size, at what they
 * keep in common across (their centre, or the edge they are set against) and clear of the cut-out's sides: every
 * other line is the scene behind them. Words of one length keep all three in common, so a place may have more than
 * one anchor and a word needs only one of them. Pure.
 */
import type { Box } from '@taalcut/core';
import type { OcrLine } from './ports';
import { unionBox } from './text-sequence';
import { normaliseText } from './text-track';

/** A word sits within this share of the place's width of one of the place's anchors. */
const ANCHOR_SHARE = 0.15;

type Side = 'left' | 'centre' | 'right';
const SIDES: readonly Side[] = ['centre', 'left', 'right'];
const sideOf = (box: Box, side: Side) =>
  side === 'left' ? box.x : side === 'right' ? box.x + box.width : box.x + box.width / 2;

/** Where a sequence's words show, from the readings that chained. */
export interface ZonePlace {
  /** The words' line: its centre and height (medians), and the range across that the words reach. */
  readonly centreY: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  /** What the words keep in common across: their centre, or an edge they are set against; `within` is how nearly. */
  readonly anchors: readonly { readonly side: Side; readonly at: number }[];
  readonly within: number;
  /** What is cut out and read, and where the picture's change is measured (the words' own box). */
  readonly region: Box;
  readonly watch: Box;
}

export const median = (values: readonly number[]) =>
  [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The place of a chain's boxes: read with a line's height above and below and half its width either side. */
export function zonePlace(boxes: readonly Box[]): ZonePlace {
  const watch = unionBox(boxes);
  const height = median(boxes.map((box) => box.height));
  const x = clamp01(watch.x - watch.width * 0.5);
  const y = clamp01(watch.y - height);
  const spread = (side: Side) => {
    const at = boxes.map((box) => sideOf(box, side));
    return Math.max(...at) - Math.min(...at);
  };
  const least = SIDES.reduce((best, next) => (spread(next) < spread(best) ? next : best));
  const within = Math.max(spread(least), watch.width * ANCHOR_SHARE);
  return {
    centreY: median(boxes.map((box) => box.y + box.height / 2)),
    height,
    left: watch.x,
    right: watch.x + watch.width,
    anchors: SIDES.filter((side) => spread(side) <= within).map((side) => ({
      side,
      at: median(boxes.map((box) => sideOf(box, side))),
    })),
    within,
    region: {
      x,
      y,
      width: clamp01(watch.x + watch.width * 1.5) - x,
      height: clamp01(watch.y + watch.height + height) - y,
    },
    watch,
  };
}

/**
 * The place with only the anchors its read words kept. Chained words of one length leave all three open, and an
 * open edge lets the scene's print set against it pass for a word; the words read since then say which it is.
 */
export function refinePlace(place: ZonePlace, boxes: readonly Box[]): ZonePlace {
  if (boxes.length < 2 || place.anchors.length < 2) return place;
  const kept = place.anchors.filter(({ side }) => {
    const at = boxes.map((box) => sideOf(box, side));
    return Math.max(...at) - Math.min(...at) <= place.within * 2;
  });
  return kept.length > 0 && kept.length < place.anchors.length ? { ...place, anchors: kept } : place;
}

/** What a line must pass to be the place's word. */
export interface WordTest {
  readonly minConfidence: number;
  readonly sizeRatio: number;
}

/** The line among `lines` that is the place's word, if one is: on its line, in its size, at its anchor. */
export function wordOn(lines: readonly OcrLine[], place: ZonePlace, options: WordTest): OcrLine | null {
  const edge = place.region.width * 0.01;
  let best: OcrLine | null = null;
  for (const line of lines) {
    const { box } = line;
    if (line.confidence < options.minConfidence || normaliseText(line.text).length === 0) continue;
    if (Math.abs(box.y + box.height / 2 - place.centreY) > place.height * 0.5) continue;
    const small = Math.min(box.height, place.height);
    if (small <= 0 || Math.max(box.height, place.height) / small > options.sizeRatio) continue;
    // A line that runs to the cut-out's side is the scene's print passing through, with or without the word in it.
    if (box.x <= place.region.x + edge) continue;
    if (box.x + box.width >= place.region.x + place.region.width - edge) continue;
    if (!place.anchors.some(({ side, at }) => Math.abs(sideOf(box, side) - at) <= place.within)) continue;
    if (!best || box.width * box.height > best.box.width * best.box.height) best = line;
  }
  return best;
}
