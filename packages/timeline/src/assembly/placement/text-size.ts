// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How big a text item's words are drawn (FRM1-OVL, TXT1), so its box holds the whole of them. Widths use render's own
 * estimate without fonts (0.6 of the size a grapheme), which is wider than the bundled fonts draw, so the box holds
 * what render draws. HFW1 retire: a graphic is a composition that lays itself out with CSS, so nothing here sizes
 * one. Pure.
 *
 * TXT1 (the owner's "the single sentence has also broken into two lines"): the box follows the words, never the
 * other way round. A text draws on one line for each line it is written on (a line break in the words), whatever
 * its size, unless someone states a width to wrap at (`fitWords`). The one other break is the frame's: a line
 * wider than the frame at its size wraps at the frame's width, and the tools say so.
 */
import type { TextItem } from '@taalcut/core';
import type { Size } from './geometry';

/** Render's text constants, in design pixels at 1080 on the shorter side. */
const DESIGN = { capShare: 0.7, advance: 0.6 } as const;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (text: string) => [...segmenter.segment(text)].length;

interface Lines {
  /** The widest a line may be drawn: the estimate's widest line, or the wrap for wrapped words. */
  readonly width: number;
  /** The estimate's widest line. */
  readonly widest: number;
  readonly count: number;
}

/** Greedy breaking at spaces, as render's fitText does, with the estimated advance. */
export function estimateLines(text: string, sizePx: number, maxWidth: number): Lines {
  const advance = sizePx * DESIGN.advance;
  const fits = (value: string) => graphemes(value) * advance <= maxWidth;
  const lines: string[] = [];
  for (const word of text.trim().split(/\s+/u)) {
    const pieces: string[] = [];
    if (fits(word)) pieces.push(word);
    else {
      // A word too wide for a line breaks grapheme by grapheme.
      let current = '';
      for (const { segment } of segmenter.segment(word)) {
        if (current !== '' && !fits(current + segment)) {
          pieces.push(current);
          current = segment;
        } else current += segment;
      }
      if (current !== '') pieces.push(current);
    }
    for (const piece of pieces) {
      const last = lines[lines.length - 1];
      if (last !== undefined && fits(`${last} ${piece}`)) lines[lines.length - 1] = `${last} ${piece}`;
      else lines.push(piece);
    }
  }
  // Wrapped words may fill a line up to the wrap with the real fonts (narrower than the estimate, so more
  // words a line): the wrap is the only safe bound on a wrapped text's width.
  const widest = Math.ceil(Math.max(0, ...lines.map((line) => graphemes(line) * advance)));
  const width = lines.length > 1 ? Math.max(widest, Math.floor(maxWidth)) : widest;
  return { width, widest, count: Math.max(1, lines.length) };
}

/** Render's text item chrome: a box background's padding, an outline's stroke (css.ts textRule). */
export function textChrome(background: TextItem['appearance']['background']): { x: number; y: number } {
  if (background === 'box') return { x: 16, y: 8 };
  if (background === 'outline') return { x: 6, y: 6 };
  return { x: 0, y: 0 };
}

/** The lines a text is written on: a line break in its words is the only break nobody else states. */
export const writtenLines = (text: string): string[] => text.split(/\r?\n/u);

export interface WordsFit {
  /** The words' own box, pixels, without chrome. */
  readonly width: number;
  readonly height: number;
  /** The lines the words draw on. */
  readonly lines: number;
  /** A written line is wider than the frame at this size: it wraps at the frame's width. */
  readonly widerThanFrame: boolean;
}

/**
 * The box a text's words take at `size` (the capitals' height over the canvas's): one line for each written line,
 * as wide as the widest of them. `wrapAt` (pixels) is a width someone stated: the words wrap there instead.
 */
export function fitWords(text: string, size: number, canvas: Size, wrapAt?: number): WordsFit {
  const fontPx = Math.round((size * canvas.height) / DESIGN.capShare);
  const written = writtenLines(text);
  const widest = Math.max(0, ...written.map((line) => estimateLines(line, fontPx, Infinity).widest));
  const widerThanFrame = wrapAt === undefined && widest > canvas.width;
  const limit = wrapAt ?? (widerThanFrame ? canvas.width : undefined);
  const lines =
    limit === undefined
      ? written.length
      : written.reduce((sum, line) => sum + estimateLines(line, fontPx, Math.max(1, limit)).count, 0);
  return {
    width: Math.max(1, limit === undefined ? widest : Math.round(limit)),
    height: lines * Math.round(fontPx * 1.2),
    lines,
    widerThanFrame,
  };
}
