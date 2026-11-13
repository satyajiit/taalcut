// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A timeline's video track, length and frame, for planning sound against it. Display maths, never stored. */
import type { SequenceItem, Timeline } from '@taalcut/core';

/** The items of V1, the only video track (timeline rules). */
export function videoItems(timeline: Timeline): readonly SequenceItem[] {
  for (const track of timeline.tracks) if (track.kind === 'video') return track.items;
  return [];
}

/** The video track's length in frames: its clips and gaps (transitions overlap their neighbours). */
export function timelineFrames(timeline: Timeline): number {
  let frames = 0;
  for (const item of videoItems(timeline)) if (item.type !== 'transition') frames += item.duration.value;
  return frames;
}

/** One frame at the canvas rate (33.37 ms at 29.97 fps). */
export function frameMs(timeline: Timeline): number {
  return (1000 * timeline.canvas.rate.den) / timeline.canvas.rate.num;
}

export function timelineMs(timeline: Timeline): number {
  return timelineFrames(timeline) * frameMs(timeline);
}
