// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How big a made text item will be drawn (FRM1-OVL), so the solver places the whole of it: its wrapped lines in its
 * box, with its chrome. Widths use render's own estimate without fonts (0.6 of the size a grapheme), which is wider
 * than the bundled fonts draw, so the box holds what render draws. HFW1 retire: a graphic is a composition that lays
 * itself out with CSS, so nothing here sizes one. Pure.
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

/**
 * The width a text item needs so no word breaks letter by letter: its longest word at `size` (a share of the canvas
 * height), with room for a wider real font. A reel's box read off a narrow sign can be narrower than a word.
 */
export function longestWordPx(text: string, size: number, canvas: Size): number {
  const fontPx = Math.round((size * canvas.height) / DESIGN.capShare);
  const longest = Math.max(
    0,
    ...text
      .trim()
      .split(/\s+/u)
      .map((word) => graphemes(word)),
  );
  return Math.ceil(longest * fontPx * DESIGN.advance * WORD_SLACK);
}
const WORD_SLACK = 1.15;

/** A text item drawn in a box `width` pixels wide at its cap height: its lines' height, with its chrome. */
export function textFootprint(
  text: string,
  appearance: TextItem['appearance'],
  width: number,
  canvas: Size,
): Size {
  const fontPx = Math.round((appearance.size * canvas.height) / DESIGN.capShare);
  const lines = estimateLines(text, fontPx, Math.max(1, width));
  const chrome = textChrome(appearance.background);
  return { width: width + 2 * chrome.x, height: lines.count * Math.round(fontPx * 1.2) + 2 * chrome.y };
}
