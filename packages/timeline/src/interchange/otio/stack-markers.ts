// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OTIO stack's markers (P2-M1, P3-V5): text, captions, the timeline's own markers and, unless they are written as
 * Transition.1, transitions, all in the stack's (the timeline's) time so an editor sees them in place.
 */
import { RationalTime, type Timeline } from '@taalcut/core';
import { MARKER_TEXT } from '../../model/markers';
import { positions, sequenceLength, videoItems } from '../../model/sequence';
import { marker, range, rt, timeRange } from './otio-items';
import type { OtioMarker } from './schema';

/** Transitions as markers at their cut, named for the transition, when they aren't written as Transition.1. */
function transitionMarkers(timeline: Timeline): OtioMarker[] {
  const rate = timeline.canvas.rate;
  const items = videoItems(timeline);
  const starts = new Map(positions(items).map((position) => [position.itemIndex, position.start]));
  return items.flatMap((item, index) => {
    if (item.type !== 'transition') return [];
    const at = starts.get(index + 1) ?? sequenceLength(items);
    return [
      marker(
        'transition',
        'PURPLE',
        range(rt(RationalTime.of(at, rate)), rt(RationalTime.zero(rate))),
        item.kind,
        item.id,
      ),
    ];
  });
}

/** Every text item of the text tracks, in yellow. */
function textMarkers(timeline: Timeline): OtioMarker[] {
  return timeline.tracks.flatMap((track) =>
    track.kind !== 'text'
      ? []
      : track.items.flatMap((item) =>
          item.type === 'text'
            ? [marker(item.role, 'YELLOW', range(rt(item.start), rt(item.duration)), item.text, item.id)]
            : [],
        ),
  );
}

/** Each caption cue, its words joined, in cyan. */
function captionMarkers(timeline: Timeline): OtioMarker[] {
  return (timeline.captions?.cues ?? []).map((cue) =>
    marker('caption', 'CYAN', timeRange(cue.range), cue.words.map((word) => word.text).join(' '), cue.id),
  );
}

type TimelineMarker = Timeline['markers'][number];

const markerColour = (item: TimelineMarker): OtioMarker['color'] =>
  item.kind === 'qa' ? 'RED' : item.kind === 'note' ? 'GREEN' : item.colour;

/** The timeline's markers: QA in red, notes in green, the rest in their own colour. */
function timelineMarkers(timeline: Timeline): OtioMarker[] {
  return timeline.markers.map((item) =>
    marker(
      item.kind,
      markerColour(item),
      timeRange(item.range),
      MARKER_TEXT[item.label] ?? item.label,
      item.id,
    ),
  );
}

/** Text, captions and markers (and transitions as markers), sorted by where they start. */
export function stackMarkers(timeline: Timeline, transitionsAsMarkers: boolean): OtioMarker[] {
  const out = [
    ...textMarkers(timeline),
    ...captionMarkers(timeline),
    ...timelineMarkers(timeline),
    ...(transitionsAsMarkers ? transitionMarkers(timeline) : []),
  ];
  return out.sort((a, b) => a.marked_range.start_time.value - b.marked_range.start_time.value);
}
