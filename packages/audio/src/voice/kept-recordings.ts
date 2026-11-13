// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  newId,
  ok,
  RationalTime,
  preserveSequenceTransitions,
  ValidationError,
  type Clip,
  type Result,
  type SequenceItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { trackOfRole } from '../commands/audio-track';

type Placed = { item: Clip; start: number; end: number };
function clips(track: Track | undefined, timeline: Timeline): Placed[] {
  let cursor = 0;
  return (track?.items ?? []).flatMap((item) => {
    if (item.type === 'transition' || item.type === 'text' || item.type === 'graphic') return [];
    const start = cursor;
    cursor += RationalTime.toFrames(item.duration, timeline.canvas.rate);
    return item.type === 'clip' ? [{ item, start, end: cursor }] : [];
  });
}

/** Regenerating speech owns only the clips named by voiceover.lines; human takes keep their exact timing. */
export function keepRecordedNarration(timeline: Timeline, incoming?: Track): Result<Track | null> {
  const existing = trackOfRole(timeline, 'voice');
  const generated = new Set(timeline.voiceover?.lines.map((line) => line.clipId) ?? []);
  const kept = clips(existing ?? undefined, timeline).filter(({ item }) => !generated.has(item.id));
  if (!kept.length) return ok(incoming ?? null);
  const incomingClips = clips(incoming, timeline).filter(
    ({ item }) => !kept.some((old) => old.item.id === item.id),
  );
  const placed = [...kept, ...incomingClips].sort((a, b) => a.start - b.start);
  const items: SequenceItem[] = [];
  let cursor = 0;
  for (const place of placed) {
    if (place.start < cursor)
      return err(
        ValidationError(
          { field: 'voiceover' },
          {
            detail: 'Generated speech overlaps a recorded take. Move or trim the take before placing speech.',
          },
        ),
      );
    if (place.start > cursor)
      items.push({
        type: 'gap',
        id: newId<'TimelineItem'>(),
        slotId: null,
        duration: RationalTime.of(place.start - cursor, timeline.canvas.rate),
      });
    items.push(place.item);
    cursor = place.end;
  }
  return ok({
    ...(incoming ?? existing!),
    items: preserveSequenceTransitions(
      [...(incoming?.items ?? []), ...(existing?.items ?? [])] as SequenceItem[],
      items,
    ),
  } as Track);
}
