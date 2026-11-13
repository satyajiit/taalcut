// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text items (overlay text from the template, the Editor or the user): plain text, always escaped, placed by
 * their box on the canvas, revealed by tc.js. A Style's text look (P3-V10, style/text-looks.ts) restyles the
 * items whose `styleKey` it names, unless a person wrote the text.
 */
import { ok } from '@taalcut/core';
import { textLookRules } from '../../style/text-looks';
import { windowSeconds } from '../../time/frames';
import { elementId, textAnimations } from '../animations';
import { textRule } from '../css';
import { element, escapeHtml } from '../html';
import { layerOutput, type CompositionLayer } from '../layer';

export const textsLayer: CompositionLayer = {
  id: 'texts',
  build(context) {
    const { plan, rate, width, height } = context;
    const markup = plan.texts.map((text) => {
      const window = windowSeconds(text.span.start, text.span.end, rate);
      return element(
        'div',
        {
          id: elementId.text(text.id),
          class: 'clip tc-text',
          'data-tc-text': true,
          'data-start': window.start,
          'data-duration': window.duration,
          lang: text.language ?? undefined,
        },
        escapeHtml(text.text),
      );
    });
    const looks = textLookRules(plan.texts, context);
    return ok(
      layerOutput({
        markup,
        css: [...plan.texts.map((text) => textRule(text, width, height)), ...looks.css],
        motion: { tweens: textAnimations(plan.texts, rate), splits: [] },
        fonts: looks.fonts,
      }),
    );
  },
};
