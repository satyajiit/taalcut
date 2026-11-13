// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Markers the timeline writes itself. Their labels are i18n keys, so the
 * editor shows them in the user's language; OTIO export writes the English
 * text, since Resolve shows the comment as it is.
 */
import { RationalTime, TimeRange, type FrameRate, type Marker, type TimelineItemId } from '@taalcut/core';

export const MARKER_LABELS = {
  /** A moved cut found no grid point that fits (SPEC, "Re-sync" step 2). */
  offBeat: 'timeline.marker.offBeat',
  /** The pick has no motion peak that lands on its beat anchor (in-point rule). */
  noSyncPoint: 'timeline.marker.noSyncPoint',
  /** The template's transition had no media to overlap: a plain cut. */
  noHandle: 'timeline.marker.noHandle',
  /** The opening the taste rule asks to hook the viewer. */
  hook: 'timeline.marker.hook',
} as const;

export const MARKER_TEXT: Readonly<Record<string, string>> = {
  [MARKER_LABELS.offBeat]: 'Off the beat',
  [MARKER_LABELS.noSyncPoint]: 'No motion peak on the beat',
  [MARKER_LABELS.noHandle]: 'Plain cut: no media for the transition',
  [MARKER_LABELS.hook]: 'Hook',
};

const COLOUR: Record<Marker['kind'], Marker['colour']> = {
  hook: 'ORANGE',
  beat: 'BLUE',
  qa: 'RED',
  note: 'GREEN',
};

export function marker(
  id: TimelineItemId,
  kind: Marker['kind'],
  label: string,
  start: number,
  length: number,
  rate: FrameRate,
): Marker {
  return {
    id,
    kind,
    label,
    colour: COLOUR[kind],
    range: TimeRange.of(RationalTime.of(start, rate), RationalTime.of(length, rate)),
  };
}

export function isMarkerAt(item: Marker, label: string, frame: number): boolean {
  return item.label === label && item.range.start.value === frame;
}
