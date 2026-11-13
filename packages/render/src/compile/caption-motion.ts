// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption word highlights as GSAP tweens (SPEC G.2, section 6): a colour, box or underline step for the word being
 * said, or with the pop its scale to POP_SCALE and back while the other words of its line move apart by its push
 * and back, with the same timing and easing (captions/pop.ts). Pure; times are frames until tracks.ts turns them
 * into seconds.
 */
import { RationalTime, type CaptionTrack, type FrameRate } from '@taalcut/core';
import { popWindows, POP_SCALE, wordSpans, type PopWindow } from '../captions/pop';
import type { MotionTween } from '../motion/motion-data';
import type { FrameSpan } from '../plan/types';
import type { CueLayout } from '../types';
import { EASE_IN_OUT, elementId, REST } from './animations';
import { stepAnimation, trackAnimation, type Segment } from './tracks';

const HIGHLIGHT_PROPERTY = { color: 'color', box: 'backgroundColor', underline: 'boxShadow' } as const;

/** Each word's line, when the layout's lines are the cue's words in order (else null: nothing to push). */
function lineOfWord(layout: CueLayout | undefined, wordCount: number): number[] | null {
  if (!layout) return null;
  const lines = layout.lineWords.flatMap((count, line) => Array.from({ length: count }, () => line));
  return lines.length === wordCount ? lines : null;
}

/** A word's scale over its pop. */
const scaleSegments = (pop: PopWindow): Segment[] => [
  { from: pop.start, to: pop.peak, start: 1, end: POP_SCALE, easing: EASE_IN_OUT },
  { from: pop.peak, to: pop.end, start: POP_SCALE, end: 1, easing: EASE_IN_OUT },
];

/** A word moved `by` pixels and back over another word's pop. */
const pushSegments = (pop: PopWindow, by: number): Segment[] => [
  { from: pop.start, to: pop.peak, start: 0, end: by, easing: EASE_IN_OUT },
  { from: pop.peak, to: pop.end, start: by, end: 0, easing: EASE_IN_OUT },
];

/** The pop's tweens for one cue: each word's own scale, then its moves while the others of its line pop. */
function popAnimations(
  cueIndex: number,
  window: FrameSpan,
  pops: readonly (PopWindow | null)[],
  layout: CueLayout | undefined,
  rate: FrameRate,
): MotionTween[] {
  const push = layout?.pop?.push;
  const lines = push ? lineOfWord(layout, pops.length) : null;
  return pops.flatMap((own, wordIndex) => {
    const target = elementId.word(cueIndex, wordIndex);
    const scale = own ? trackAnimation(target, 'scale', window, 1, scaleSegments(own), rate) : [];
    if (!push || !lines) return scale;
    const moves = pops.flatMap((pop, popped) => {
      const by = push[popped] ?? 0;
      if (!pop || popped === wordIndex || lines[popped] !== lines[wordIndex] || by === 0) return [];
      return pushSegments(pop, popped < wordIndex ? by : -by);
    });
    return [...scale, ...trackAnimation(target, 'x', window, 0, moves, rate)];
  });
}

export function captionAnimations(
  track: CaptionTrack,
  rate: FrameRate,
  layouts: readonly CueLayout[],
): MotionTween[] {
  const { style } = track;
  const highlight = style.highlight;
  if (highlight === 'none') return [];
  return track.cues.flatMap((cue, cueIndex) => {
    const start = RationalTime.toFrames(cue.range.start, rate);
    const window = { start, end: start + RationalTime.toFrames(cue.range.duration, rate) };
    const spans = wordSpans(cue.words, rate);
    // One word pops at a time, so pushes never stack (captions/pop.ts).
    if (highlight === 'pop')
      return popAnimations(cueIndex, window, popWindows(spans), layouts[cueIndex], rate);
    const property = HIGHLIGHT_PROPERTY[highlight];
    const on = highlight === 'underline' ? `inset 0 -0.14em 0 ${style.highlightColor}` : style.highlightColor;
    const off = highlight === 'color' ? style.textColor : REST[property];
    return spans.flatMap((span, wordIndex) =>
      stepAnimation(elementId.word(cueIndex, wordIndex), property, window, off, on, span, rate),
    );
  });
}
