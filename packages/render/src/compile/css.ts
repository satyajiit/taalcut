// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * tc.css: one rule per element id (place, size, fit, stacking), the caption
 * style, and @font-face for the bundled fonts. No inline styles anywhere:
 * the preview origin's CSP allows style-src 'self' only. Each layer writes
 * its own rules with these builders; `baseCss` is what every composition has.
 */
import type { CaptionStyle, Rect } from '@taalcut/core';
import { POP_ORIGIN_Y } from '../captions/pop';
import type { PlannedText } from '../plan/types';
import type { CaptionFontId, CueLayout, FontFaceFile } from '../types';
import { elementId } from './animations';
import { bundleUrl, cssString } from './html';
import { Z } from './layer';

/** Latin cap height is about 0.7 em in the curated fonts; text items give their size as a cap-height share. */
export const CAP_HEIGHT_EM = 0.7;
/** Text overlays use this curated font; captions use their own style. */
export const TEXT_FONT: CaptionFontId = 'notoSans';

export const familyList = (families: readonly string[]) =>
  [...families.map(cssString), 'sans-serif'].join(', ');

export function rgba(hex: string, opacity: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

export function fontFaces(faces: readonly FontFaceFile[]): string[] {
  return faces.map(
    (face) =>
      `@font-face { font-family: ${cssString(face.family)}; src: url(${cssString(`fonts/${bundleUrl(face.file)}`)}) format('truetype'); font-weight: ${face.weight}; font-style: normal; font-display: block; }`,
  );
}

/** The page, the root at the canvas size, and the classes every layer shares. */
export function baseCss(input: {
  readonly width: number;
  readonly height: number;
  readonly textFamilies: string;
}): string[] {
  return [
    'html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }',
    `#root { position: relative; width: ${input.width}px; height: ${input.height}px; overflow: hidden; background: #000; }`,
    `.clip, .tc-v { position: absolute; left: 0; top: 0; width: ${input.width}px; height: ${input.height}px; }`,
    '.tc-v, .tc-i { display: block; }',
    `.tc-flash { background: #fff; z-index: ${Z.flash}; }`,
    `.tc-text { z-index: ${Z.text}; color: #fff; font-family: ${input.textFamilies}; font-weight: 700; line-height: 1.15; white-space: pre-wrap; overflow-wrap: anywhere; }`,
  ];
}

/** A text item's own rule: its box on the canvas, size, alignment, case and background. */
export function textRule(text: PlannedText, width: number, height: number): string {
  const size = Math.round((text.sizeRatio * height) / CAP_HEIGHT_EM);
  const transform =
    text.letterCase === 'upper' ? 'uppercase' : text.letterCase === 'lower' ? 'lowercase' : 'none';
  const background =
    text.background === 'box'
      ? 'background-color: rgba(0, 0, 0, 0.55); padding: 8px 16px; border-radius: 12px;'
      : text.background === 'outline'
        ? '-webkit-text-stroke: 6px #000; paint-order: stroke fill;'
        : text.background === 'shadow'
          ? 'text-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);'
          : '';
  return (
    `#${elementId.text(text.id)} { left: ${Math.round(text.box.x * width)}px; ` +
    `top: ${Math.round(text.box.y * height)}px; width: ${Math.round(text.box.width * width)}px; ` +
    `height: auto; font-size: ${size}px; text-align: ${text.align}; text-transform: ${transform}; ${background} }`
  );
}

export interface CaptionCss {
  readonly style: CaptionStyle;
  readonly safe: Rect;
  readonly layouts: readonly { readonly id: string; readonly layout: CueLayout }[];
  readonly stack: readonly string[];
}

export function captionRules(captions: CaptionCss): string[] {
  const { style, safe } = captions;
  const stroke = style.stroke
    ? `-webkit-text-stroke: ${style.stroke.widthPx * 2}px ${style.stroke.color}; paint-order: stroke fill;`
    : '';
  const background = style.background
    ? `background-color: ${rgba(style.background.color, style.background.opacity)}; ` +
      `padding: ${style.background.paddingPx}px; border-radius: ${style.background.radiusPx}px; ` +
      '-webkit-box-decoration-break: clone; box-decoration-break: clone;'
    : '';
  const rules = [
    `.tc-cap { left: ${safe.x}px; width: ${safe.width}px; height: auto; z-index: ${Z.captions}; text-align: center; ` +
      `font-family: ${familyList(captions.stack)}; font-weight: ${style.weight}; ` +
      `font-size: ${style.sizePx}px; line-height: 1.2; color: ${style.textColor}; ` +
      `text-transform: ${style.letterCase === 'upper' ? 'uppercase' : 'none'}; ${stroke} }`,
    `.tc-cap .tc-inner { ${background} }`,
    `.tc-cap .tc-word { display: inline-block; transform-origin: 50% ${POP_ORIGIN_Y * 100}%; }`,
  ];
  // The text starts below the room the layout keeps for the stroke and the background's padding.
  const chrome = (style.background?.paddingPx ?? 0) + (style.stroke?.widthPx ?? 0);
  for (const { id, layout } of captions.layouts) {
    // Measured layouts carry their line height and line breaks: draw exactly those lines.
    const top = Math.round(layout.topPx) + (layout.lineHeightPx ? chrome : 0);
    const measured = layout.lineHeightPx
      ? ` line-height: ${layout.lineHeightPx}px; white-space: nowrap;`
      : '';
    rules.push(`#${elementId.cue(id)} { top: ${top}px;${measured} }`);
    // The pop's lead over every line, on word boxes one line tall (the scale's origin is a share of that).
    if (layout.pop && layout.lineHeightPx)
      rules.push(
        `#${elementId.cue(id)} .tc-word { height: ${layout.lineHeightPx}px; margin-top: ${layout.pop.leadPx}px; }`,
      );
  }
  return rules;
}
