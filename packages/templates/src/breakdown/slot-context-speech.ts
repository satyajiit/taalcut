// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The words said during each slot (LRN1-CTX). The draft keeps speech segments with their times, not word
 * times, so a segment's words are spread evenly over its time and a word belongs to the slot its midpoint
 * falls in: every word lands in exactly one slot, and a segment that spans a cut splits at it. A script
 * written without spaces is one word per segment, placed at the segment's midpoint.
 */
import { RationalTime, type FrameRate } from '@taalcut/core';
import type { BreakdownDraft } from './draft';

type Segment = NonNullable<BreakdownDraft['audio']['speech']>['segments'][number];

interface Bounds {
  readonly start: number;
  readonly end: number;
}

/** Each segment's words with the frame (at `rate`) of their midpoint, in time order. */
export function placedWords(
  segments: readonly Segment[],
  rate: FrameRate,
): { readonly word: string; readonly at: number }[] {
  const placed: { word: string; at: number }[] = [];
  const ordered = [...segments].sort((a, b) => RationalTime.compare(a.start, b.start));
  for (const segment of ordered) {
    const words = segment.text.split(/\s+/u).filter((word) => word.length > 0);
    if (words.length === 0) continue;
    const start = RationalTime.toSeconds(segment.start);
    const length = RationalTime.toSeconds(segment.duration) / words.length;
    words.forEach((word, index) => {
      const middle = start + length * (index + 0.5);
      // The frame the midpoint falls in: seconds only at this edge, never stored.
      placed.push({ word, at: RationalTime.fromSeconds(middle, rate, 'floor').value });
    });
  }
  return placed;
}

/** The words whose midpoint falls in each slot, joined by spaces; null for a slot where nothing is said. */
export function speechBySlot(
  draft: Pick<BreakdownDraft, 'audio' | 'canvas'>,
  slots: readonly Bounds[],
): (string | null)[] {
  const words = placedWords(draft.audio.speech?.segments ?? [], draft.canvas.rate);
  return slots.map((slot) => {
    const said = words.filter((item) => item.at >= slot.start && item.at < slot.end).map((item) => item.word);
    return said.length > 0 ? said.join(' ') : null;
  });
}
