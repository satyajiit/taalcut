// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption style matched to the reference (SPEC section 6). The template's
 * caption look maps to a CaptionStyle: the curated font of the same design
 * category that covers the language's script, the size from the
 * reference's cap height through that font's own metrics (44 to 160 px), and
 * the anchor clamped so the block sits inside the preset's safe rect.
 * Without a reference, the classic preset.
 */
import { CAPTION_FONTS, type CaptionStyle, type Rect, type TextOverlay } from '@taalcut/core';
import type { CaptionFontId } from '../types';
import { FONT_CATEGORY, fontCovers, fontMetrics, type FontCategory } from './fonts';
import { clampAnchorY } from './layout';
import { roomHeight } from './pop';

/**
 * A reference's caption look. TODO(templates): the templates lane's `captionLook` in the text pattern
 * (SPEC section 16); `captionLookFromOverlay` derives one from a template text overlay meanwhile.
 */
export interface CaptionLook {
  /** Centre of the caption block, as a fraction of the frame height. */
  readonly anchorY: number;
  /** Cap height as a share of the frame height (the template's textAppearance.size). */
  readonly capHeightRatio: number;
  readonly wordsPerScreen: number;
  readonly maxLines?: number;
  readonly letterCase: 'asIs' | 'upper';
  readonly highlight: CaptionStyle['highlight'];
  readonly textColor: string;
  readonly highlightColor: string;
  readonly stroke: { readonly color: string; readonly widthPx: number } | null;
  readonly background: { readonly color: string; readonly opacity: number } | null;
  readonly fontCategory: FontCategory;
  readonly weight: number;
}

const SIZE_MIN = 44;
const SIZE_MAX = 160;

/**
 * The default without a reference: white Poppins 800 at 72 px with a 4 px black stroke, the current word
 * in yellow. The platform research moved every safe rect's bottom edge up to y 1248 (1260 on TikTok),
 * so the classic 0.68 anchor (y 1306) would sit under the platforms' captions: 0.58 centres a two-line
 * block at y 1114, inside every preset's rect with room to spare.
 */
export const CLASSIC_STYLE: CaptionStyle = {
  version: 1,
  font: 'poppins',
  weight: 800,
  sizePx: 72,
  textColor: '#ffffff',
  highlightColor: '#ffd400',
  stroke: { color: '#000000', widthPx: 4 },
  background: null,
  highlight: 'color',
  letterCase: 'asIs',
  anchorY: 0.58,
  maxLines: 2,
  maxWords: 4,
};

export type CaptionScript = 'latin' | 'devanagari';

/** The script a caption's language is written in (v1: en, es, pt-BR in Latin; hi in Devanagari). */
export function scriptOf(language: string): CaptionScript {
  const [base, script] = language.split('-');
  if (script?.toLowerCase() === 'latn') return 'latin';
  return base === 'hi' || base === 'mr' || base === 'ne' ? 'devanagari' : 'latin';
}

/** Letters a font must have for a script: Spanish and Portuguese need Latin-1 and Latin Extended-A. */
const SCRIPT_PROBES: Readonly<Record<CaptionScript, string>> = {
  latin: 'AZaz09ñÑáéíóúüÁÉÍÓÚÜ¿¡ãõçâêôàÃÕÇÂÊÔÀœŒ',
  devanagari: 'अआइकखगघक्षत्रज्ञश्रर्कक़ािीुूृेैोौंःँ्।॥',
};

export function coversScript(font: CaptionFontId, script: CaptionScript): boolean {
  return [...SCRIPT_PROBES[script]].every((char) => fontCovers(font, char.codePointAt(0)!));
}

/** Where to look when a category has no font for the script (no condensed Devanagari font is curated). */
const CATEGORY_FALLBACKS: Readonly<Record<FontCategory, readonly FontCategory[]>> = {
  sans: ['sans'],
  geometric: ['geometric', 'sans'],
  humanist: ['humanist', 'sans'],
  rounded: ['rounded', 'humanist', 'sans'],
  condensed: ['condensed', 'geometric', 'sans'],
};

/** The curated font of a category that covers the script, in CAPTION_FONTS order. */
export function fontFor(category: FontCategory, script: CaptionScript): CaptionFontId {
  for (const candidate of CATEGORY_FALLBACKS[category]) {
    const found = CAPTION_FONTS.find(
      (font) => FONT_CATEGORY[font] === candidate && coversScript(font, script),
    );
    if (found) return found;
  }
  return script === 'devanagari' ? 'notoSansDevanagari' : 'notoSans';
}

/** The block height a style needs at most: maxLines lines (with the pop's room), plus stroke and padding. */
export function blockHeightEstimate(style: CaptionStyle): number {
  const metrics = fontMetrics(style.font);
  const lineHeight = Math.max(1, metrics.ascender + metrics.descender) * style.sizePx;
  const chrome = 2 * ((style.background?.paddingPx ?? 0) + (style.stroke?.widthPx ?? 0));
  const room = style.highlight === 'pop' ? roomHeight(style.maxLines, lineHeight) : 0;
  return Math.ceil(style.maxLines * lineHeight + room + chrome);
}

/** The style with its anchor moved so its tallest block fits the preset's safe rect. */
export function clampStyleToPreset(style: CaptionStyle, preset: { readonly safe: Rect }): CaptionStyle {
  return { ...style, anchorY: clampAnchorY(style.anchorY, blockHeightEstimate(style), preset.safe) };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function matchCaptionStyle(
  look: CaptionLook | null,
  language: string,
  preset: { readonly safe: Rect; readonly height: number },
): CaptionStyle {
  const script = scriptOf(language);
  if (!look) {
    const font = coversScript(CLASSIC_STYLE.font, script) ? CLASSIC_STYLE.font : fontFor('geometric', script);
    return clampStyleToPreset({ ...CLASSIC_STYLE, font }, preset);
  }
  const font = fontFor(look.fontCategory, script);
  const capHeightPx = look.capHeightRatio * preset.height;
  const sizePx = Math.round(clamp(capHeightPx / fontMetrics(font).capHeight, SIZE_MIN, SIZE_MAX));
  const words = Math.round(clamp(look.wordsPerScreen, 1, 12));
  const style: CaptionStyle = {
    version: 1,
    font,
    weight: Math.round(clamp(look.weight, 100, 900) / 100) * 100,
    sizePx,
    textColor: look.textColor,
    highlightColor: look.highlightColor,
    stroke: look.stroke
      ? { color: look.stroke.color, widthPx: Math.round(clamp(look.stroke.widthPx, 1, 16)) }
      : null,
    background: look.background
      ? {
          color: look.background.color,
          opacity: clamp(look.background.opacity, 0, 1),
          paddingPx: Math.round(clamp(sizePx * 0.25, 0, 48)),
          radiusPx: Math.round(clamp(sizePx * 0.2, 0, 48)),
        }
      : null,
    highlight: look.highlight,
    letterCase: look.letterCase,
    anchorY: clamp(look.anchorY, 0, 1),
    maxLines: Math.round(clamp(look.maxLines ?? (words > 3 ? 2 : 1), 1, 3)),
    maxWords: words,
  };
  return clampStyleToPreset(style, preset);
}

/** A caption look from a template's caption text overlay (position, size, case, background kind). */
export function captionLookFromOverlay(
  overlay: Pick<TextOverlay, 'box' | 'appearance' | 'text'>,
): CaptionLook {
  const { appearance, box } = overlay;
  const outlined = appearance.background === 'outline' || appearance.background === 'shadow';
  return {
    anchorY: box.y + box.height / 2,
    capHeightRatio: appearance.size,
    wordsPerScreen: Math.max(1, overlay.text.trim().split(/\s+/u).length),
    letterCase: appearance.case === 'upper' ? 'upper' : 'asIs',
    highlight: 'none',
    textColor: '#ffffff',
    highlightColor: '#ffd400',
    stroke: outlined ? { color: '#000000', widthPx: 4 } : null,
    background: appearance.background === 'box' ? { color: '#000000', opacity: 0.6 } : null,
    fontCategory: 'sans',
    weight: 700,
  };
}
