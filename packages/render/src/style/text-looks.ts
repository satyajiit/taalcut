// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A Style's text looks on text items (P3-V10, SPEC P3.5): an item whose `styleKey` names an entry in the Style's
 * `textStyles` takes that look. The rules come after the items' own, so they override the default look.
 *
 * TXT1: the look is the whole of how the role's letters are drawn, and it says each part out loud: face, weight,
 * colour, outline or none, shadow or none, box or none, letter spacing. So an item's own chrome
 * (`appearance.background`, which the default look drew as a fixed black outline, shadow or box) never mixes with
 * a designed look. The type is sized by the face's own cap height (the faces differ: Oswald's capitals are 0.81 of
 * the em, Courier Prime's 0.58), so `appearance.size` is the capitals' height in every face and QA's readable
 * size means the same. A look's pixels are of a canvas 1080 on its shorter side. It dresses every text of the
 * role, whoever wrote the words: a person's edit changes what a text says, not which face the video is set in
 * (before TXT1 a text a person had reworded fell back to the default face beside its designed neighbours).
 */
import type { TextLook } from '@taalcut/core';
import { fontMetrics } from '../captions/fonts';
import { elementId } from '../compile/animations';
import { familyList, rgba } from '../compile/css';
import type { LayerContext } from '../compile/layer';
import type { PlannedText } from '../plan/types';
import type { CaptionFontId } from '../types';

/** The look a text item takes from the context's Style, or null. */
export function textLookFor(text: PlannedText, context: Pick<LayerContext, 'style'>): TextLook | null {
  if (!context.style) return null;
  return context.style.textStyles[text.styleKey] ?? null;
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** One look as declarations, on a canvas `scale` times the 1080 its pixels are stated for. */
export function lookDeclarations(look: TextLook, scale: number): string {
  const background = look.background
    ? `background-color: ${rgba(look.background.colour, look.background.opacity)}; ` +
      `padding: ${px(8 * scale)} ${px(16 * scale)}; border-radius: ${px(12 * scale)};`
    : 'background-color: transparent; padding: 0; border-radius: 0;';
  const stroke = look.stroke
    ? `-webkit-text-stroke: ${px(look.stroke.widthPx * 2 * scale)} ${look.stroke.colour}; paint-order: stroke fill;`
    : '-webkit-text-stroke: 0;';
  const shadow = look.shadow
    ? `text-shadow: 0 ${px(look.shadow.offsetPx * scale)} ${px(look.shadow.blurPx * scale)} ` +
      `${rgba(look.shadow.colour, look.shadow.opacity)};`
    : 'text-shadow: none;';
  // Figures the height of the capitals: the type is sized by its capitals, and a serif's old-style figures would
  // hang below the line of a title ("After 9 to 5").
  const spacing = `letter-spacing: ${look.letterSpacing ? `${look.letterSpacing}em` : 'normal'}; font-variant-numeric: lining-nums;`;
  return `${background} ${stroke} ${shadow} ${spacing}`;
}

export function textLookRules(
  texts: readonly PlannedText[],
  context: Pick<LayerContext, 'style' | 'fonts' | 'width' | 'height'>,
): { readonly css: string[]; readonly fonts: CaptionFontId[] } {
  const css: string[] = [];
  const fonts = new Set<CaptionFontId>();
  const scale = Math.min(context.width, context.height) / 1080;
  for (const text of texts) {
    const look = textLookFor(text, context);
    if (!look) continue;
    fonts.add(look.font.family);
    const stack = context.fonts ? context.fonts.stack(look.font.family) : [];
    // The capitals are `sizeRatio` of the frame's height in this face, whatever share of its em they take.
    const size = Math.round((text.sizeRatio * context.height) / fontMetrics(look.font.family).capHeight);
    css.push(
      `#${elementId.text(text.id)} { font-family: ${familyList(stack)}; font-weight: ${look.font.weight}; ` +
        `font-size: ${size}px; color: ${look.colour}; ${lookDeclarations(look, scale)} }`,
    );
  }
  return { css, fonts: [...fonts] };
}
