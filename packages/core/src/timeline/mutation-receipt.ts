// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Timeline } from './timeline-schema';

/** All changed, added, removed and moved items, without the display card's truncation. */
export function affectedTimelineItems(before: Timeline, after: Timeline): string[] {
  const entries = (timeline: Timeline) => {
    const out = new Map<string, string>();
    for (const track of timeline.tracks) {
      let start = 0;
      for (const item of track.items) {
        out.set(
          item.id,
          JSON.stringify({
            track: track.id,
            start,
            item,
            style: timeline.styleId,
            grade: timeline.grade,
            mix: timeline.mix,
            music: timeline.music,
          }),
        );
        if (track.kind !== 'text' && item.type !== 'transition') start += item.duration.value;
      }
    }
    for (const cue of timeline.captions?.cues ?? [])
      out.set(
        cue.id,
        JSON.stringify({
          cue,
          style: timeline.captions?.style,
          enabled: timeline.captions?.enabled,
          language: timeline.captions?.language,
        }),
      );
    for (const marker of timeline.markers) out.set(marker.id, JSON.stringify(marker));
    return out;
  };
  const old = entries(before);
  const next = entries(after);
  return [...new Set([...old.keys(), ...next.keys()])].filter((id) => old.get(id) !== next.get(id));
}
