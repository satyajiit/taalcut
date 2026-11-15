// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: a text's box follows its words. The owner's "After 9 to 5" was given a box 70 % of the frame wide, and at
 * its size the four words were wider than that, so render wrapped them: a stated box broke a sentence in two.
 *
 * A text is anchored, not boxed: its words start from an anchor (the left edge, centre or right edge of where it
 * was put, as its alignment says, at its middle height) and draw on one line for each line they are written on.
 * The box stored for it is the words' own at that size (assembly/placement/text-size.ts `fitWords`), round the
 * anchor. A width wraps the words only when someone states it (`TextItem.breaks: 'width'`). The frame is the one
 * limit: a box is moved the least that keeps it inside, and a line wider than the frame wraps at the frame's width.
 * Pure; nothing reads what the words say.
 */
import type { NormalisedBox, TextItem } from '@taalcut/core';
import { fitWords, type WordsFit } from '../assembly/placement/text-size';

type Align = TextItem['appearance']['align'];
interface Canvas {
  readonly width: number;
  readonly height: number;
}

export interface Anchor {
  /** The words' left edge, centre or right edge, as their alignment says: a share of the frame's width. */
  readonly x: number;
  /** Their middle: a share of the frame's height. */
  readonly y: number;
}

/** Where a box anchors its words. */
export const anchorOf = (box: NormalisedBox, align: Align): Anchor => ({
  x: align === 'left' ? box.x : align === 'right' ? box.x + box.width : box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** How far a span from `from`, `length` long, has to move to lie in 0..1; 0 when it is longer than that. */
export const intoFrame = (from: number, length: number): number =>
  length >= 1 ? 0 : from < 0 ? -from : from + length > 1 ? 1 - from - length : 0;

/** A box as a timeline stores one: inside the frame, to the digit when it already is. */
export function stored(box: NormalisedBox): NormalisedBox {
  const width = Math.min(1, box.width);
  const height = Math.min(1, box.height);
  return {
    x: Math.min(Math.max(0, box.x), 1 - width),
    y: Math.min(Math.max(0, box.y), 1 - height),
    width,
    height,
  };
}

/** The words' size as shares of the frame. */
export const fitShares = (fit: WordsFit, canvas: Canvas) => ({
  width: fit.width / canvas.width,
  height: fit.height / canvas.height,
});

/**
 * The box of a text's words round `anchor`, at the text's size and alignment, inside the frame. `wrapAt` is a
 * stated width (a share of the frame's): without it the words are one line for each written line.
 */
export function wordsBox(
  item: Pick<TextItem, 'text' | 'appearance'>,
  anchor: Anchor,
  canvas: Canvas,
  wrapAt?: number,
): NormalisedBox {
  const { align, size } = item.appearance;
  const own = fitShares(
    fitWords(item.text, size, canvas, wrapAt === undefined ? undefined : wrapAt * canvas.width),
    canvas,
  );
  const left =
    align === 'left' ? anchor.x : align === 'right' ? anchor.x - own.width : anchor.x - own.width / 2;
  const top = anchor.y - own.height / 2;
  return stored({
    x: left + intoFrame(left, own.width),
    y: top + intoFrame(top, own.height),
    ...own,
  });
}

/** How a text's words break as it stands: as written, or at its box's width when that was stated (or before TXT1). */
export function fitOf(
  item: Pick<TextItem, 'text' | 'appearance' | 'box' | 'breaks'>,
  canvas: Canvas,
): WordsFit {
  return fitWords(
    item.text,
    item.appearance.size,
    canvas,
    item.breaks === 'written' ? undefined : item.box.width * canvas.width,
  );
}
