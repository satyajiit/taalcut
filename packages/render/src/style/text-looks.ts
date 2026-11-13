// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A Style's text looks on text items (P3-V10, SPEC P3.5): an item whose `styleKey` names an entry in the
 * Style's `textStyles` takes that font, weight, colour, box and stroke, unless a person wrote it (their edit
 * wins). The rules come after the items' own, so they override the default look. Fonts are the curated set.
 */
import type { TextLook } from '@taalcut/core';
import { elementId } from '../compile/animations';
import { familyList, rgba } from '../compile/css';
import type { LayerContext } from '../compile/layer';
import type { PlannedText } from '../plan/types';
import type { CaptionFontId } from '../types';

/** The look a text item takes from the context's Style, or null. */
export function textLookFor(text: PlannedText, context: Pick<LayerContext, 'style'>): TextLook | null {
  if (!context.style || text.origin === 'user') return null;
  return context.style.textStyles[text.styleKey] ?? null;
}

export function textLookRules(
  texts: readonly PlannedText[],
  context: Pick<LayerContext, 'style' | 'fonts'>,
): { readonly css: string[]; readonly fonts: CaptionFontId[] } {
  const css: string[] = [];
  const fonts = new Set<CaptionFontId>();
  for (const text of texts) {
    const look = textLookFor(text, context);
    if (!look) continue;
    fonts.add(look.font.family);
    const stack = context.fonts ? context.fonts.stack(look.font.family) : [];
    const background = look.background
      ? ` background-color: ${rgba(look.background.colour, look.background.opacity)}; padding: 8px 16px; border-radius: 12px;`
      : '';
    const stroke = look.stroke
      ? ` -webkit-text-stroke: ${look.stroke.widthPx * 2}px ${look.stroke.colour}; paint-order: stroke fill;`
      : '';
    css.push(
      `#${elementId.text(text.id)} { font-family: ${familyList(stack)}; font-weight: ${look.font.weight}; ` +
        `color: ${look.colour};${background}${stroke} }`,
    );
  }
  return { css, fonts: [...fonts] };
}
