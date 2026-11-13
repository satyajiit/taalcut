// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Burnt-in captions: one block per cue at its laid-out place, its lines broken exactly where the layout broke
 * them, one span per word for the highlight (with the pop's motion, as laid out). The layouts are measured
 * before the layers run (graphics keep clear of them), so this layer only draws them.
 */
import { ok, RationalTime, type CaptionTrack } from '@taalcut/core';
import type { RenderPlan } from '../../plan/types';
import type { CueLayout } from '../../types';
import { windowSeconds } from '../../time/frames';
import { elementId } from '../animations';
import { captionAnimations } from '../caption-motion';
import { captionRules } from '../css';
import { element, escapeHtml } from '../html';
import { layerOutput, type CompositionLayer } from '../layer';

/** The cue's word indexes that start a line after the first (none when the counts aren't the cue's words). */
function lineBreaks(lineWords: readonly number[], wordCount: number): Set<number> {
  const breaks = new Set<number>();
  let at = 0;
  for (const count of lineWords) {
    if (at > 0) breaks.add(at);
    at += count;
  }
  return at === wordCount ? breaks : new Set();
}

function captionMarkup(track: CaptionTrack, plan: RenderPlan, layouts: readonly CueLayout[]): string[] {
  return track.cues.map((cue, cueIndex) => {
    const start = RationalTime.toFrames(cue.range.start, plan.rate);
    const window = windowSeconds(
      start,
      start + RationalTime.toFrames(cue.range.duration, plan.rate),
      plan.rate,
    );
    const breaks = lineBreaks(layouts[cueIndex]?.lineWords ?? [], cue.words.length);
    const words = cue.words
      .map((word, wordIndex) => {
        const w0 = RationalTime.toFrames(word.range.start, plan.rate);
        const w1 = w0 + RationalTime.toFrames(word.range.duration, plan.rate);
        const span = element(
          'span',
          {
            id: elementId.word(cueIndex, wordIndex),
            class: 'tc-word',
            'data-w0': String(w0),
            'data-w1': String(w1),
          },
          escapeHtml(word.text),
        );
        return breaks.has(wordIndex) ? `<br>${span}` : span;
      })
      .join(' ');
    return element(
      'div',
      {
        id: elementId.cue(cue.id),
        class: 'clip tc-cue tc-cap',
        'data-tc-text': true,
        'data-start': window.start,
        'data-duration': window.duration,
      },
      element('span', { class: 'tc-inner' }, words),
    );
  });
}

export function captionsLayer(
  layouts: readonly { readonly id: string; readonly layout: CueLayout }[],
): CompositionLayer {
  return {
    id: 'captions',
    build(context) {
      const captions = context.captions;
      if (!captions) return ok(layerOutput({}));
      const stack = context.fonts ? context.fonts.stack(captions.style.font) : [];
      const cueLayouts = layouts.map((entry) => entry.layout);
      return ok(
        layerOutput({
          markup: captionMarkup(captions, context.plan, cueLayouts),
          css: captionRules({ style: captions.style, safe: context.safe, layouts, stack }),
          motion: { tweens: captionAnimations(captions, context.rate, cueLayouts), splits: [] },
          fonts: [captions.style.font],
        }),
      );
    },
  };
}
