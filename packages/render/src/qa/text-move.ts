// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * captionSafeZone's fix for a text item (FIX-QA): the nearest box that passes, as a ready `timeline.moveText`
 * payload. The probe measures the text as Chrome laid it out, which can reach past the item's box (its padding and
 * outline, or words wrapped into a column taller than a narrow box), so the move is planned on both: the item's box
 * and every probed box of it move together, by the least that brings them inside the safe rect less a margin. The
 * width is kept, so the lines break where they did; a box wider or taller than the safe rect is narrowed to it, the
 * text kept where its alignment puts it. When even the text can't fit, it is centred on the safe rect: the least it
 * can stick out. Pure.
 */
import type { Box, Rect } from '@taalcut/core';

export interface TextMoveInput {
  /** The item's box, normalised to the canvas. */
  readonly box: Box;
  readonly align: 'left' | 'center' | 'right';
  /** Every box the probe measured for the item (canvas pixels), at every frame it read. */
  readonly probed: readonly Rect[];
  readonly safe: Rect;
  readonly canvas: { readonly width: number; readonly height: number };
}

/** Room left between the moved text and the safe rect's edge, over the probe's rounding. */
export const TEXT_MOVE_MARGIN_PX = 4;

interface Span {
  readonly start: number;
  readonly size: number;
}

const union = (rects: readonly Rect[]): Rect => {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
};

const spanOf = (a: Span, b: Span): Span => {
  const start = Math.min(a.start, b.start);
  return { start, size: Math.max(a.start + a.size, b.start + b.size) - start };
};

/** The least move that brings `span` inside `room`; centred on it when it is bigger. */
function shiftInto(span: Span, room: Span): number {
  if (span.size > room.size) return room.start + (room.size - span.size) / 2 - span.start;
  if (span.start < room.start) return room.start - span.start;
  const over = span.start + span.size - (room.start + room.size);
  return over > 0 ? -over : 0;
}

/** The box and the text on one axis: inside together when they fit, else the text alone. */
function axisShift(box: Span, text: Span, room: Span): number {
  const both = spanOf(box, text);
  return both.size <= room.size ? shiftInto(both, room) : shiftInto(text, room);
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** The nearest box (normalised) whose text the probe would find inside the safe rect. */
export function planTextMove(input: TextMoveInput): Box {
  const { canvas, safe, box } = input;
  const margin = Math.min(TEXT_MOVE_MARGIN_PX, safe.width / 4, safe.height / 4);
  const room = {
    x: { start: safe.x + margin, size: safe.width - 2 * margin },
    y: { start: safe.y + margin, size: safe.height - 2 * margin },
  };
  const old = {
    x: box.x * canvas.width,
    y: box.y * canvas.height,
    width: box.width * canvas.width,
    height: box.height * canvas.height,
  };
  const width = Math.min(old.width, room.x.size);
  const height = Math.min(old.height, room.y.size);
  const text = input.probed.length > 0 ? union(input.probed) : old;
  // A narrower box keeps the lines that already fit it; they sit where the alignment puts them.
  const narrowed = old.width - width;
  const textX = text.x - (input.align === 'right' ? narrowed : input.align === 'center' ? narrowed / 2 : 0);
  const dx = axisShift({ start: old.x, size: width }, { start: textX, size: text.width }, room.x);
  const dy = axisShift({ start: old.y, size: height }, { start: text.y, size: text.height }, room.y);
  const x = Math.min(1, Math.max(0, round4((old.x + dx) / canvas.width)));
  const y = Math.min(1, Math.max(0, round4((old.y + dy) / canvas.height)));
  return {
    x,
    y,
    width: Math.min(1 - x, round4(width / canvas.width)),
    height: Math.min(1 - y, round4(height / canvas.height)),
  };
}
