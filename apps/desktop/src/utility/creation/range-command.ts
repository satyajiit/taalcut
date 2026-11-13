// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  CREATION_COMMANDS as names,
  creationCommandPayloads as payloads,
  defineCommand,
  err,
  newId,
  ok,
  RationalTime,
  ValidationError,
  type SequenceItem,
} from '@taalcut/core';
import { checkEdited } from '@taalcut/timeline';
import type { CreationCommandKit } from './command-kit';
import { readCreationTimeline } from './programs';

/** Placement changes only the video sequence; soundtrack edits remain ordinary audio commands. */
export function creationRangeCommand(kit: CreationCommandKit) {
  return defineCommand({
    name: names.setProgramRange,
    payload: payloads[names.setProgramRange],
    sideEffect: 'write',
    handle: kit.handle(async (input, context) => {
      const found = await readCreationTimeline(kit.timelines, input);
      if (!found.ok) return found;
      const timeline = found.value;
      if (context.replay !== 'redo' && timeline.revision !== input.revision)
        return err(ConflictError({ entity: 'timeline', id: timeline.id }));
      const track = timeline.tracks[0];
      const item = track?.items.find((entry) => entry.id === input.itemId);
      if (
        track?.kind !== 'video' ||
        item?.type !== 'program' ||
        track.items.some((entry) => entry.id !== item.id && entry.type !== 'gap')
      )
        return err(
          ValidationError(
            { field: 'itemId' },
            { detail: 'Video placement requires a single authored program.' },
          ),
        );
      if (item.locked && context.source === 'agent')
        return err(ValidationError({ field: 'itemId' }, { detail: 'The video is locked.' }));
      const rate = timeline.canvas.rate;
      const sourceStart = RationalTime.rescale(input.sourceStart, rate, 'round');
      const duration = RationalTime.rescale(input.duration, rate, 'round');
      const start = RationalTime.rescale(input.start, rate, 'round');
      const index = track.items.indexOf(item);
      const leading = track.items.slice(0, index).find((entry) => entry.type === 'gap');
      const items: SequenceItem[] = [
        ...(start.value > 0
          ? [
              {
                type: 'gap' as const,
                id: leading?.id ?? newId<'TimelineItem'>(),
                duration: start,
                slotId: null,
              },
            ]
          : []),
        { ...item, sourceStart, duration },
        ...track.items.slice(index + 1),
      ];
      const edited = checkEdited({ ...timeline, tracks: [{ ...track, items }, ...timeline.tracks.slice(1)] });
      if (!edited.ok) return edited;
      const saved = await kit.timelines.put(edited.value, timeline.revision, context);
      if (!saved.ok) return saved;
      kit.note(context, 'timeline', timeline.id);
      return ok({
        result: saved.value,
        inverse: {
          name: names.restore,
          payload: { projectId: input.projectId, snapshot: { kind: 'timeline', timeline } },
        },
      });
    }),
  });
}
