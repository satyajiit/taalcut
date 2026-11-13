// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Composition graphics test helpers: a timeline with captions and slots, and the graphics commands on a real bus. */
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  FrameRate,
  newId,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  timelineSchema,
  type Id,
  type Timeline,
} from '@taalcut/core';
import { createCompositionCommands } from '../../src/compositions/commands';
import { memoryTimelines } from '../commands/support';
import { captionTrackOf, makeTimeline } from '../support/timeline';

export const rate = FrameRate.of(30);

/** Six seconds of footage in two slots, with captions of `cues` (one word per space) in `language`. */
export function spokenTimeline(
  cues: readonly (readonly [number, number, string])[],
  language = 'en',
  slots: readonly [Id<'TemplateSlot'>, Id<'TemplateSlot'>] = [
    newId<'TemplateSlot'>(),
    newId<'TemplateSlot'>(),
  ],
): Timeline {
  const timeline = makeTimeline({
    items: [
      { frames: 90, sourceStart: 0 },
      { frames: 90, sourceStart: 0 },
    ],
    captions: captionTrackOf(rate, cues, {}, language),
  });
  const [video, ...rest] = timeline.tracks;
  if (video?.kind !== 'video') throw new Error('makeTimeline gives V1 first');
  let index = 0;
  const items = video.items.map((item) =>
    item.type === 'clip' ? { ...item, slotId: slots[index++] ?? null } : item,
  );
  return timelineSchema.parse({ ...timeline, tracks: [{ ...video, items }, ...rest] });
}

/** The graphics commands on a real bus over timelines in memory, with `timeline.restore` for undo. */
export function graphicsBus(...timelines: Timeline[]) {
  const store = memoryTimelines(...timelines);
  const commands = createCompositionCommands({ timelines: store });
  // The timeline lane's restore, reduced to what graphics need: the tracks back as they were.
  const restore = defineCommand({
    name: TIMELINE_COMMANDS.restore,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ timelineId, tracks }, context) => {
      const updated = await store.update(
        timelineId,
        (timeline) => ({ ...timeline, ...(tracks ? { tracks } : {}) }),
        context,
      );
      return updated.ok ? ok({ result: { revision: updated.value.revision } }) : updated;
    },
  });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(1_000) });
  bus.register(...commands.all, restore);
  return { bus, commands, store };
}
