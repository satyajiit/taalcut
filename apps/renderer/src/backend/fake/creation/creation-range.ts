// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CREATION_COMMANDS,
  creationCommandPayloads,
  err,
  newId,
  ok,
  RationalTime,
  timelineSchema,
  ValidationError,
  type SequenceItem,
  type Timeline,
} from '@taalcut/core';

export function rangeCreationFixture(timeline: Timeline, raw: unknown) {
  const input = creationCommandPayloads[CREATION_COMMANDS.setProgramRange].parse(raw);
  const track = timeline.tracks[0];
  const item = track?.items.find((entry) => entry.id === input.itemId);
  if (
    track?.kind !== 'video' ||
    item?.type !== 'program' ||
    track.items.some((entry) => entry.id !== item.id && entry.type !== 'gap')
  )
    return err(ValidationError({ field: 'itemId' }));
  const atRate = (time: RationalTime) => RationalTime.rescale(time, timeline.canvas.rate, 'round');
  const start = atRate(input.start);
  const index = track.items.indexOf(item);
  const leading = track.items.slice(0, index).find((entry) => entry.type === 'gap');
  const items: SequenceItem[] = [
    ...(start.value > 0
      ? [{ type: 'gap' as const, id: leading?.id ?? newId<'TimelineItem'>(), duration: start, slotId: null }]
      : []),
    { ...item, sourceStart: atRate(input.sourceStart), duration: atRate(input.duration) },
    ...track.items.slice(index + 1),
  ];
  const parsed = timelineSchema.safeParse({
    ...timeline,
    tracks: [{ ...track, items }, ...timeline.tracks.slice(1)],
  });
  return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'range' }));
}
