// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Style from the reference (SPEC section 6) and cue layout inside the safe rect. */
import { beforeAll, describe, expect, it } from 'vitest';
import { captionStyleSchema } from '@taalcut/core';
import { clampAnchorY, layoutCue } from '../../src/captions/layout';
import type { DetailedTextMeasurer } from '../../src/captions/measure';
import {
  blockHeightEstimate,
  captionLookFromOverlay,
  CLASSIC_STYLE,
  coversScript,
  fontFor,
  matchCaptionStyle,
  scriptOf,
  type CaptionLook,
} from '../../src/captions/style';
import { captionStyleForCanvas } from '../../src/plan/canvas';
import { EXPORT_PRESETS, presetFor, safeRectFor } from '../../src/presets/presets.v1';
import { GOLDEN, testMeasurer } from '../support/fonts';

let measurer: DetailedTextMeasurer;
beforeAll(async () => {
  measurer = await testMeasurer();
});

const look: CaptionLook = {
  anchorY: 0.8,
  capHeightRatio: 0.025,
  wordsPerScreen: 3,
  letterCase: 'upper',
  highlight: 'box',
  textColor: '#ffffff',
  highlightColor: '#ff3366',
  stroke: null,
  background: { color: '#000000', opacity: 0.7 },
  fontCategory: 'condensed',
  weight: 400,
};

const inside = (top: number, height: number, safe: { y: number; height: number }) =>
  top >= safe.y && top + height <= safe.y + safe.height;

describe('matchCaptionStyle', () => {
  it('without a reference: the classic style, valid, and inside every preset', () => {
    const style = matchCaptionStyle(null, 'en', presetFor('device'));
    expect(style).toEqual(CLASSIC_STYLE);
    expect(captionStyleSchema.parse(style)).toEqual(style);
    for (const preset of EXPORT_PRESETS) {
      // Landscape presets draw the style scaled to their canvas, at their own anchor (P3-V2).
      const drawn = captionStyleForCanvas(style, { width: 1080, height: 1920 }, preset);
      const height = blockHeightEstimate(drawn);
      expect(inside(drawn.anchorY * preset.height - height / 2, height, preset.safe), preset.id).toBe(true);
    }
  });

  it('maps a condensed reference to Anton in Latin and to a Devanagari font in Hindi', () => {
    const latin = matchCaptionStyle(look, 'es', presetFor('reels'));
    expect(latin.font).toBe('anton');
    expect(latin).toMatchObject({ highlight: 'box', letterCase: 'upper', maxWords: 3, maxLines: 1 });
    expect(latin.background).toMatchObject({ color: '#000000', opacity: 0.7 });
    // Cap height 0.025 × 1920 = 48 px; Anton's cap height is 0.859 em → 56 px.
    expect(latin.sizePx).toBe(56);
    const hindi = matchCaptionStyle(look, 'hi', presetFor('reels'));
    expect(coversScript(hindi.font, 'devanagari')).toBe(true);
    expect(hindi.font).toBe('poppins');
    expect(captionStyleSchema.parse(hindi)).toEqual(hindi);
  });

  it('clamps the size to 44–160 px and the anchor into the preset safe rect', () => {
    expect(matchCaptionStyle({ ...look, capHeightRatio: 0.002 }, 'en', presetFor('device')).sizePx).toBe(44);
    expect(matchCaptionStyle({ ...look, capHeightRatio: 0.3 }, 'en', presetFor('device')).sizePx).toBe(160);
    for (const { id } of EXPORT_PRESETS) {
      const style = matchCaptionStyle({ ...look, anchorY: 0.95 }, 'hi', presetFor(id));
      const safe = presetFor(id).safe;
      const height = blockHeightEstimate(style);
      expect(inside(style.anchorY * 1920 - height / 2, height, safe), id).toBe(true);
    }
  });

  it('finds a font for every category and script, and knows each language’s script', () => {
    expect(scriptOf('hi')).toBe('devanagari');
    expect(scriptOf('hi-Latn')).toBe('latin');
    expect(scriptOf('pt-BR')).toBe('latin');
    expect(fontFor('rounded', 'devanagari')).toBe('baloo2');
    expect(fontFor('humanist', 'latin')).toBe('mukta');
    expect(fontFor('geometric', 'latin')).toBe('poppins');
  });

  it('derives a look from a template caption overlay', () => {
    const derived = captionLookFromOverlay({
      text: 'one two three',
      box: { x: 0.1, y: 0.7, width: 0.8, height: 0.1 },
      appearance: { size: 0.03, align: 'center', case: 'upper', background: 'outline' },
    });
    expect(derived).toMatchObject({
      anchorY: 0.75,
      capHeightRatio: 0.03,
      wordsPerScreen: 3,
      letterCase: 'upper',
    });
    expect(derived.stroke).not.toBeNull();
  });
});

describe('layoutCue', () => {
  it('wraps at word boundaries inside the safe width and clamps the block into the rect', () => {
    const safe = safeRectFor([]);
    for (const [language, text] of [
      ['en', GOLDEN.en],
      ['hi', GOLDEN.hi],
      ['es', GOLDEN.es],
      ['pt-BR', GOLDEN.pt],
      ['hi', GOLDEN.hinglish],
    ] as const) {
      const layout = layoutCue(
        text,
        { ...CLASSIC_STYLE, anchorY: 0.95, maxLines: 3 },
        measurer,
        safe,
        language,
      );
      expect(layout.widthPx).toBeLessThanOrEqual(safe.width);
      expect(layout.lines.join(' ')).toBe(text);
      expect(inside(layout.topPx, layout.heightPx, safe), language).toBe(true);
      expect(layout.lineHeightPx).toBeGreaterThanOrEqual(CLASSIC_STYLE.sizePx);
    }
  });

  it('counts the stroke and the background padding, and flags a word too wide for the rect', () => {
    const safe = safeRectFor([]);
    const plain = layoutCue('Hello', { ...CLASSIC_STYLE, stroke: null }, measurer, safe, 'en');
    const boxed = layoutCue(
      'Hello',
      { ...CLASSIC_STYLE, background: { color: '#000000', opacity: 1, paddingPx: 20, radiusPx: 8 } },
      measurer,
      safe,
      'en',
    );
    expect(boxed.widthPx - plain.widthPx).toBe(2 * (20 + 4));
    expect(boxed.heightPx - plain.heightPx).toBe(2 * (20 + 4));
    const long = layoutCue(
      'प्रतिस्पर्धात्मकताविश्लेषणप्रक्रियाओं',
      { ...CLASSIC_STYLE, font: 'mukta', sizePx: 140, maxLines: 1 },
      measurer,
      safe,
      'hi',
    );
    expect(long.overflow).toBe(true);
  });

  it('pins a block taller than the rect to its top', () => {
    expect(clampAnchorY(0.9, 2000, { x: 0, y: 288, width: 100, height: 960 }) * 1920).toBe(288 + 1000);
    expect(clampAnchorY(0.5, 100, { x: 0, y: 288, width: 100, height: 960 })).toBe(0.5);
  });
});
