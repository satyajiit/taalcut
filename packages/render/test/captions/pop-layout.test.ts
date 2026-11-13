// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption layout with the pop's room (SPEC section 6, "Room for the pop"): pop captions are set as plain text
 * and wrap so that each line's widest moment fits, carry each word's push and the lead over every line, in
 * Latin and Devanagari, and stay inside the safe rect; every other highlight lays out exactly as before.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type CaptionStyle, type Rect } from '@taalcut/core';
import { buildCaptionCues } from '../../src/captions/cues';
import { fontMetrics } from '../../src/captions/fonts';
import { chromePx, layoutCue, wrapLines } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import { lineReach, popLead, pushOf, roomHeight } from '../../src/captions/pop';
import { blockHeightEstimate, CLASSIC_STYLE } from '../../src/captions/style';
import { applyLetterCase, breakUnits } from '../../src/captions/text';
import { safeRectFor } from '../../src/presets/presets.v1';
import { GOLDEN, testMeasurer } from '../support/fonts';

const safe = safeRectFor([]);
const POP: CaptionStyle = { ...CLASSIC_STYLE, highlight: 'pop', maxLines: 3 };
const PLAIN_HIGHLIGHTS = ['none', 'color', 'box', 'underline'] as const;
const LONG_EN = 'Meet the team that ships every Friday and the people who make it happen all year';
let measurer: DetailedTextMeasurer;

beforeAll(async () => {
  measurer = await testMeasurer();
});

const textWidth = (text: string, style: CaptionStyle) =>
  measurer.measure(text, style.font, style.weight, style.sizePx).width;
const metricsOf = (style: CaptionStyle) => ({
  strokePx: style.stroke?.widthPx ?? 0,
  spacePx: textWidth(' ', style),
});
/** A line's width at its widest moment, from first principles: plain text and its reach on both sides. */
const popWidth = (line: string, style: CaptionStyle) =>
  textWidth(line, style) +
  2 *
    lineReach(
      line.split(' ').map((word) => textWidth(word, style)),
      metricsOf(style),
    );
const maxWidthOf = (style: CaptionStyle, rect: Rect = safe) => {
  const { padding, stroke } = chromePx(style);
  return rect.width - 2 * (padding + stroke);
};

/** The greedy wrap every plain highlight has always had: shaped text only. */
function plainWrap(text: string, style: CaptionStyle, maxWidth: number, language: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const unit of breakUnits(applyLetterCase(text, style.letterCase, language), language)) {
    if (current.trim() && textWidth((current + unit).trim(), style) > maxWidth) {
      lines.push(current.trim());
      current = unit;
    } else current += unit;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

describe('layout with the pop’s room', () => {
  it('wraps where the lines’ widest moments say, greedily', () => {
    for (const [text, language, style] of [
      [LONG_EN, 'en', POP],
      [GOLDEN.hi, 'hi', { ...POP, font: 'mukta', weight: 700 }],
      [LONG_EN, 'en', { ...POP, font: 'anton', weight: 400, sizePx: 96, letterCase: 'upper' }],
    ] as const) {
      const maxWidth = maxWidthOf(style);
      const { lines, widths } = wrapLines(text, style, measurer, maxWidth, language);
      expect(lines.length).toBeGreaterThan(1);
      lines.forEach((line, index) => {
        expect(widths[index]).toBeCloseTo(popWidth(line, style), 6);
        expect(widths[index]).toBeLessThanOrEqual(maxWidth);
        const next = lines[index + 1];
        // The next line's first word would not have fitted on this one.
        if (next) expect(popWidth(`${line} ${next.split(' ')[0]}`, style)).toBeGreaterThan(maxWidth);
      });
    }
  });

  it('breaks a line plain text keeps whole when the popped look would not fit', () => {
    const text = 'Meet the team today';
    const plain = { ...POP, highlight: 'color' as const };
    const { padding, stroke } = chromePx(POP);
    const narrow = { ...safe, width: Math.ceil(textWidth(text, plain)) + 2 * (padding + stroke) + 1 };
    expect(layoutCue(text, plain, measurer, narrow, 'en').lines).toEqual([text]);
    const popped = layoutCue(text, POP, measurer, narrow, 'en');
    expect(popped.lines.length).toBeGreaterThan(1);
    expect(popped.overflow).toBe(false);
  });

  it('sets the lines as plain text and keeps one space between words', () => {
    const plain = { ...POP, highlight: 'color' as const };
    const popped = layoutCue(LONG_EN, POP, measurer, safe, 'en');
    // Wherever every plain line's widest moment fits, the wrap is plain text's.
    let same = 0;
    for (let width = safe.width; width >= 360; width -= 3) {
      const rect = { ...safe, width };
      const lines = layoutCue(LONG_EN, plain, measurer, rect, 'en').lines;
      if (lines.some((line) => popWidth(line, POP) > maxWidthOf(POP, rect))) continue;
      expect(layoutCue(LONG_EN, POP, measurer, rect, 'en').lines).toEqual(lines);
      same += 1;
    }
    expect(same).toBeGreaterThan(5);
    expect(popped.lines.join(' ')).toBe(LONG_EN);
    expect(popped.lineWords).toEqual(popped.lines.map((line) => line.split(' ').length));
  });

  it('carries each word’s push and the lead, and reserves the widest moment and the lead in the block', () => {
    const layout = layoutCue(LONG_EN, POP, measurer, safe, 'en');
    const lineHeight = layout.lineHeightPx;
    expect(layout.pop?.push).toEqual(
      LONG_EN.split(' ').map((word) => pushOf(textWidth(word, POP), metricsOf(POP))),
    );
    expect(layout.pop?.leadPx).toBe(popLead(lineHeight));
    const chrome = 2 * (layout.paddingPx + layout.strokePx);
    expect(layout.heightPx).toBe(
      Math.ceil(layout.lines.length * lineHeight + roomHeight(layout.lines.length, lineHeight) + chrome),
    );
    const widest = Math.max(...layout.lines.map((line) => popWidth(line, POP)));
    expect(layout.widthPx).toBe(Math.ceil(Math.min(safe.width, widest + chrome)));
  });

  it('keeps the block, popped words and all, inside the safe rect at both of its edges', () => {
    for (const anchorY of [0, 1]) {
      const layout = layoutCue(LONG_EN, { ...POP, anchorY }, measurer, safe, 'en');
      expect(layout.topPx).toBeGreaterThanOrEqual(safe.y);
      expect(layout.topPx + layout.heightPx).toBeLessThanOrEqual(safe.y + safe.height);
    }
  });

  it('lays Devanagari out with the same room', () => {
    const style = { ...POP, font: 'poppins' as const };
    const text = 'क्षमा त्रिशूल ज्ञान श्रम कर्क ज़िंदगी कि कृ';
    const layout = layoutCue(text, style, measurer, safe, 'hi');
    expect(layout.overflow).toBe(false);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.pop?.push).toHaveLength(text.split(' ').length);
    for (const line of layout.lines) expect(popWidth(line, style)).toBeLessThanOrEqual(maxWidthOf(style));
  });

  it('flags a word too wide to pop inside the safe rect as an overflow', () => {
    const layout = layoutCue('Internationalisation', { ...POP, sizePx: 96 }, measurer, safe, 'en');
    expect(layout.lines).toEqual(['Internationalisation']);
    expect(layout.overflow).toBe(true);
  });

  it('lays every other highlight out exactly as before', () => {
    const styles: CaptionStyle[] = [
      CLASSIC_STYLE,
      { ...CLASSIC_STYLE, font: 'mukta', weight: 700, maxLines: 3 },
      { ...CLASSIC_STYLE, background: { color: '#000000', opacity: 0.6, paddingPx: 18, radiusPx: 14 } },
      { ...CLASSIC_STYLE, font: 'anton', weight: 400, sizePx: 96, letterCase: 'upper', maxLines: 3 },
    ];
    for (const base of styles)
      for (const [language, text] of [
        ['en', LONG_EN],
        ['hi', GOLDEN.hi],
        ['es', GOLDEN.es],
        ['pt-BR', GOLDEN.pt],
        ['hi', GOLDEN.hinglish],
      ] as const)
        for (const highlight of PLAIN_HIGHLIGHTS) {
          const style = { ...base, highlight };
          const layout = layoutCue(text, style, measurer, safe, language);
          const lines = plainWrap(text, style, maxWidthOf(style), language);
          const chrome = 2 * (layout.paddingPx + layout.strokePx);
          expect(layout.lines).toEqual(lines);
          expect(layout.heightPx).toBe(Math.ceil(lines.length * layout.lineHeightPx + chrome));
          expect(layout.widthPx).toBe(
            Math.ceil(
              Math.min(safe.width, Math.max(...lines.map((line) => textWidth(line, style))) + chrome),
            ),
          );
          expect(layout.pop).toBeUndefined();
          expect(layout.lineWords).toEqual(lines.map((line) => line.split(' ').length));
        }
  });

  it('counts the pop’s rise and drop in the block a style needs at most', () => {
    const metrics = fontMetrics(POP.font);
    const lineHeight = (metrics.ascender + metrics.descender) * POP.sizePx;
    const chrome = 2 * (POP.stroke?.widthPx ?? 0);
    expect(blockHeightEstimate(POP)).toBe(
      Math.ceil(POP.maxLines * lineHeight + roomHeight(POP.maxLines, lineHeight) + chrome),
    );
    expect(blockHeightEstimate({ ...POP, highlight: 'color' })).toBe(
      Math.ceil(POP.maxLines * lineHeight + chrome),
    );
  });

  it('groups pop cues so each one’s popped lines fit', () => {
    const rate = FrameRate.of(30);
    const words = LONG_EN.split(' ').map((text, index) => ({
      text,
      range: { start: RationalTime.of(index * 20, rate), duration: RationalTime.of(20, rate) },
      confidence: 0.9,
    }));
    const style = { ...POP, maxLines: 2, maxWords: 12 };
    const cues = buildCaptionCues(words, style, measurer, safe, { language: 'en', rate });
    const text = (cue: (typeof cues)[number]) => cue.words.map((word) => word.text).join(' ');
    for (const cue of cues)
      expect(layoutCue(text(cue), style, measurer, safe, 'en').lines.length).toBeLessThanOrEqual(2);
    // The widest moments can only take words from a cue, never add them.
    const plain = buildCaptionCues(words, { ...style, highlight: 'color' }, measurer, safe, {
      language: 'en',
      rate,
    });
    expect(cues.length).toBeGreaterThanOrEqual(plain.length);
  });
});
