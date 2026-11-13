// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pop highlight (SPEC section 6, "Room for the pop"): the current word scales from 1 to POP_SCALE and back
 * around (50 %, POP_ORIGIN_Y) of its box, peaking POP_PEAK_FRAMES in. These constants are the one source the
 * animation (compile/caption-motion.ts), the drawing (compile/css.ts) and the layout (layout.ts) read.
 *
 * At rest a pop caption is set like any other: one space between words. The pop makes its own room. A word's
 * envelope is its box (its advance width, one line tall) widened by the stroke on each side; at the peak it grows
 * by g = (s − 1)(w/2 + stroke) on each side, (s − 1)·POP_ORIGIN_Y·h above and (s − 1)(1 − POP_ORIGIN_Y)·h below.
 * - While a word pops, the other words of its line move apart by its push (`pushOf`): those before it by −d,
 *   those after it by +d, with the scale's timing and easing. d is its growth plus what a heavy stroke needs, so
 *   at the peak its outline keeps max(space − 2·stroke, space/2) from its neighbours': never less than plain
 *   text at rest, never less than half a space. One word of a cue pops at a time (`popWindows`), so pushes never
 *   stack.
 * - The layout reserves only what that motion needs: each line's widest moment (`lineReach`, each side of the
 *   centred line) inside the safe width when wrapping and clamping, and vertically the lead over every line
 *   (the larger of rise and drop) and the drop under the last.
 */
import { RationalTime, type CaptionWord, type FrameRate } from '@taalcut/core';

/** The popped word's scale at its peak. */
export const POP_SCALE = 1.18;
/** The scale's origin, as a share of the word's box height from its top (x is the centre). */
export const POP_ORIGIN_Y = 0.6;
/** The pop peaks this many frames into a word (the QA probe reads every peak). */
export const POP_PEAK_FRAMES = 3;

const GROWTH = POP_SCALE - 1;

/** Room is drawn in hundredths of a pixel, rounded up, so the CSS never gives less than was reserved. */
const up = (px: number) => Math.ceil(px * 100 - 1e-6) / 100;

/** What the room depends on besides the words: the cue's stroke and the width of its space. */
export interface PopMetrics {
  readonly strokePx: number;
  readonly spacePx: number;
}

/** How far a word's envelope grows on each side at the peak. */
export const sideGrowth = (widthPx: number, strokePx: number) => GROWTH * (widthPx / 2 + strokePx);

/** How far a line-tall box grows above (rise) and below (drop) its line at the peak. */
export function verticalGrowth(lineHeightPx: number): { rise: number; drop: number } {
  return {
    rise: up(GROWTH * POP_ORIGIN_Y * lineHeightPx),
    drop: up(GROWTH * (1 - POP_ORIGIN_Y) * lineHeightPx),
  };
}

/** The room kept over every line: whichever of a popped word's rise and the word above's drop is larger. */
export function popLead(lineHeightPx: number): number {
  const { rise, drop } = verticalGrowth(lineHeightPx);
  return Math.max(rise, drop);
}

/**
 * How far a popped word pushes the other words of its line (each way): its growth, plus what a stroke heavier
 * than a quarter space needs to keep the outlines half a space apart.
 */
export const pushOf = (widthPx: number, metrics: PopMetrics) =>
  up(sideGrowth(widthPx, metrics.strokePx) + Math.max(0, 2 * metrics.strokePx - metrics.spacePx / 2));

/**
 * How far a centred line reaches past either end at its widest moment, from its words' advance widths. A lone
 * word grows by its own growth; on a line of several, a pop moves the words at one end or both by its push.
 */
export function lineReach(widths: readonly number[], metrics: PopMetrics): number {
  const [only, ...others] = widths;
  if (only === undefined) return 0;
  if (others.length === 0) return up(sideGrowth(only, metrics.strokePx));
  return Math.max(...widths.map((width) => pushOf(width, metrics)));
}

/** The extra height a block of `lines` lines takes: the lead over each line and the drop under the last. */
export function roomHeight(lines: number, lineHeightPx: number): number {
  if (lines <= 0) return 0;
  return lines * popLead(lineHeightPx) + verticalGrowth(lineHeightPx).drop;
}

/** Each word's frames on the timeline. */
export function wordSpans(
  words: readonly Pick<CaptionWord, 'range'>[],
  rate: FrameRate,
): { start: number; end: number }[] {
  return words.map((word) => {
    const start = RationalTime.toFrames(word.range.start, rate);
    return { start, end: start + RationalTime.toFrames(word.range.duration, rate) };
  });
}

/** When a word pops, in frames: up to `peak`, back to rest at `end`. */
export interface PopWindow {
  readonly start: number;
  readonly peak: number;
  readonly end: number;
}

/**
 * Each word's pop, so that no two words of a cue ever pop at once (their pushes would stack): a word's pop
 * ends by the time the next word to start begins. Words that start together leave the
 * pop to the last of them (null for the others). With words one after another, as every caption source makes
 * them, each pop spans its word exactly.
 */
export function popWindows(
  spans: readonly { readonly start: number; readonly end: number }[],
): (PopWindow | null)[] {
  const order = spans
    .map((span, index) => ({ start: span.start, end: span.end, index }))
    .sort((a, b) => a.start - b.start || a.index - b.index);
  const windows: (PopWindow | null)[] = spans.map(() => null);
  order.forEach((span, rank) => {
    const following = order[rank + 1];
    const end = following === undefined ? span.end : Math.min(span.end, following.start);
    if (end > span.start)
      windows[span.index] = { start: span.start, peak: Math.min(span.start + POP_PEAK_FRAMES, end - 1), end };
  });
  return windows;
}
