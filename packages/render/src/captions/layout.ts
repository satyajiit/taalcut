// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a caption cue sits: its lines (greedy wrap at word boundaries inside
 * the safe width, less stroke and background padding) and its block,
 * centred on anchorY and clamped into the preset's safe rect. Line height
 * comes from the fonts' ascent and descent, so Devanagari marks above the
 * headline and below the base count in the box.
 *
 * The compiler draws the cue the same way: a block `widthPx` wide centred in
 * the safe rect, its text `paddingPx + strokePx` below `topPx` (the room the
 * layout keeps for them), `line-height: lineHeightPx`, text centred, and a
 * line break after exactly `lineWords[i]` of the cue's words.
 *
 * A cue is laid out as its words: a line breaks only between two of them
 * (and only where the language allows one), so a word with spaces inside it
 * (a translated word with its punctuation, an edit's joined tail) stays whole.
 *
 * With the pop highlight, lines are set as plain text and wrapped so that
 * each line's widest moment fits (pop.ts: the pop pushes the other words of
 * its line apart), and the block keeps the pop's lead over every line.
 */
import type { CaptionStyle, Rect } from '@taalcut/core';
import type { CueLayout, TextMeasurer } from '../types';
import { lineReach, popLead, pushOf, roomHeight, type PopMetrics } from './pop';
import { applyLetterCase, breakUnits } from './text';

export interface CueLayoutDetail extends CueLayout {
  readonly lineHeightPx: number;
  /** Background padding on every side (0 without a background). */
  readonly paddingPx: number;
  /** Stroke width; the stroke paints outside the glyphs by this much at most. */
  readonly strokePx: number;
  /** The widest line is wider than the safe rect allows (one word too long): QA's captionOverflow. */
  readonly overflow: boolean;
  /** anchorY after clamping. */
  readonly anchorY: number;
}

/** The portrait canvas's height; landscape presets pass their own (P3-V2). */
export const CANVAS_HEIGHT = 1920;

/** Horizontal room inside the box: the stroke and the background padding are drawn on both sides. */
export function chromePx(style: Pick<CaptionStyle, 'stroke' | 'background'>): {
  padding: number;
  stroke: number;
} {
  return { padding: style.background?.paddingPx ?? 0, stroke: style.stroke?.widthPx ?? 0 };
}

/** The cue's words: given, or a text's space-separated words. */
const wordsOfCue = (cue: string | readonly string[]): readonly string[] =>
  typeof cue === 'string' ? cue.split(/\s+/u).filter(Boolean) : cue;

/**
 * The cue's words in groups a line may not break inside: the language's break opportunities (breakUnits: after
 * a whole word, its punctuation kept with it) where they fall between two of the cue's words.
 */
function breakGroups(words: readonly string[], language: string): string[][] {
  const opportunities = new Set<number>();
  let offset = 0;
  for (const unit of breakUnits(words.join(' '), language)) opportunities.add((offset += unit.length));
  const groups: string[][] = [];
  let at = 0;
  words.forEach((word, index) => {
    const last = groups[groups.length - 1];
    if (!last || (index > 0 && opportunities.has(at))) groups.push([word]);
    else last.push(word);
    at += word.length + 1;
  });
  return groups;
}

/** The pop's metrics for a style: its stroke and the width of a space in its font. */
function popMetrics(style: CaptionStyle, measurer: TextMeasurer): PopMetrics {
  return {
    strokePx: style.stroke?.widthPx ?? 0,
    spacePx: measurer.measure(' ', style.font, style.weight, style.sizePx).width,
  };
}

/** A line's width as wrapping counts it: its shaped text, and with the pop highlight its reach on both sides. */
function lineWidth(style: CaptionStyle, measurer: TextMeasurer): (words: readonly string[]) => number {
  const text = (value: string) => measurer.measure(value, style.font, style.weight, style.sizePx).width;
  if (style.highlight !== 'pop') return (words) => text(words.join(' '));
  const metrics = popMetrics(style, measurer);
  return (words) => text(words.join(' ')) + 2 * lineReach(words.map(text), metrics);
}

/** Greedy wrap: each line takes whole break groups of the cue's words while its width fits `maxWidth`. */
export function wrapLines(
  cue: string | readonly string[],
  style: CaptionStyle,
  measurer: TextMeasurer,
  maxWidth: number,
  language: string,
): { lines: string[]; lineWords: number[]; widths: number[] } {
  const width = lineWidth(style, measurer);
  const words = wordsOfCue(cue).map((word) => applyLetterCase(word, style.letterCase, language));
  const lines: string[][] = [];
  let current: string[] = [];
  for (const group of breakGroups(words, language)) {
    const candidate = [...current, ...group];
    if (current.length > 0 && width(candidate) > maxWidth) {
      lines.push(current);
      current = group;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  return {
    lines: lines.map((line) => line.join(' ')),
    lineWords: lines.map((line) => line.length),
    widths: lines.map(width),
  };
}

/** The anchor (block centre, as a fraction of the canvas height) that keeps a block inside the safe rect. */
export function clampAnchorY(
  anchorY: number,
  blockHeightPx: number,
  safe: Rect,
  canvasHeight: number = CANVAS_HEIGHT,
): number {
  const half = blockHeightPx / 2;
  const top = safe.y + half;
  const bottom = safe.y + safe.height - half;
  const centre = anchorY * canvasHeight;
  // A block taller than the rect is pinned to its top: QA reports the overflow.
  const clamped = top > bottom ? top : Math.min(bottom, Math.max(top, centre));
  return clamped / canvasHeight;
}

export function layoutCue(
  cue: string | readonly string[],
  style: CaptionStyle,
  measurer: TextMeasurer,
  safe: Rect,
  language: string,
  canvasHeight: number = CANVAS_HEIGHT,
): CueLayoutDetail {
  const { padding, stroke } = chromePx(style);
  const maxWidth = Math.max(1, safe.width - 2 * (padding + stroke));
  const { lines, lineWords, widths } = wrapLines(cue, style, measurer, maxWidth, language);
  const metrics = lines.map((line) => measurer.measure(line, style.font, style.weight, style.sizePx));
  const lineHeightPx = Math.ceil(
    Math.max(style.sizePx, ...metrics.map((metric) => metric.ascent + metric.descent)),
  );
  const textWidth = Math.max(0, ...widths);
  const pop = style.highlight === 'pop';
  const widthPx = Math.ceil(Math.min(safe.width, textWidth + 2 * (padding + stroke)));
  const room = pop ? roomHeight(lines.length, lineHeightPx) : 0;
  const heightPx = Math.ceil(lines.length * lineHeightPx + room + 2 * (padding + stroke));
  const anchorY = clampAnchorY(style.anchorY, heightPx, safe, canvasHeight);
  const popRoom = () => {
    const metrics = popMetrics(style, measurer);
    const push = wordsOfCue(cue).map((word) =>
      pushOf(
        measurer.measure(
          applyLetterCase(word, style.letterCase, language),
          style.font,
          style.weight,
          style.sizePx,
        ).width,
        metrics,
      ),
    );
    return { push, leadPx: popLead(lineHeightPx) };
  };
  return {
    lines,
    lineWords,
    widthPx,
    heightPx,
    topPx: Math.round(anchorY * canvasHeight - heightPx / 2),
    lineHeightPx,
    ...(pop ? { pop: popRoom() } : {}),
    paddingPx: padding,
    strokePx: stroke,
    overflow: textWidth > maxWidth || lines.length > style.maxLines,
    anchorY,
  };
}
