// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The items of a timeline's enabled text tracks by type (texts and motion graphics), in track order. */
import type { Timeline } from '@taalcut/core';

type TextTrack = Extract<Timeline['tracks'][number], { kind: 'text' }>;
export type TextTrackItem = TextTrack['items'][number];

export function enabledTextItems<K extends TextTrackItem['type']>(
  timeline: Timeline,
  type: K,
): Extract<TextTrackItem, { type: K }>[] {
  return timeline.tracks.flatMap((track) =>
    track.kind === 'text' && track.enabled
      ? track.items.filter((item): item is Extract<TextTrackItem, { type: K }> => item.type === type)
      : [],
  );
}

/** Earliest first. */
export const bySpanStart = (a: { span: { start: number } }, b: { span: { start: number } }) =>
  a.span.start - b.span.start;
