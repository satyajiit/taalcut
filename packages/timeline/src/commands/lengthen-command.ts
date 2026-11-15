// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: `timeline.lengthenSlot`. One of the person's clips runs the stated frames longer, the reel's music plays
 * that much of itself again, and everything after is that much later (edits/lengthen.ts). The handler applies
 * what the payload states and measures nothing: that the frames are whole bars and the splice a bar line is the
 * tool's check against the measured bars (tools/lengthen-tools.ts). One undo step: the tracks, markers, captions,
 * beat map, cast and mix as they were.
 */
import {
  ConflictError,
  defineCommand,
  err,
  LENGTHEN_SLOT_COMMAND,
  lengthenSlotPayloadSchema,
  ok,
  TIMELINE_COMMANDS,
} from '@taalcut/core';
import { lengthenSlot } from '../edits/lengthen';
import { commit, readFor, restorePayload, type CommandDeps } from './context';
import { affectedItems } from './mutation-receipt';

export function lengthenCommand(deps: CommandDeps) {
  return defineCommand({
    name: LENGTHEN_SLOT_COMMAND,
    payload: lengthenSlotPayloadSchema,
    sideEffect: 'write',
    handle: async (payload, context) => {
      const current = await readFor(deps.store, payload.timelineId, payload.projectId);
      if (!current.ok) return current;
      if (
        payload.revision !== undefined &&
        context.replay !== 'redo' &&
        payload.revision !== current.value.revision
      )
        return err(ConflictError({ entity: 'timeline', id: payload.timelineId }));
      const timeline = current.value;
      const edited = lengthenSlot(
        timeline,
        {
          clipId: payload.clipId,
          frames: payload.frames,
          bars: payload.bars,
          at: payload.at,
          crossfade: payload.crossfade,
          footage: payload.footage,
        },
        {
          source: context.source,
          ...(deps.config ? { config: deps.config } : {}),
          ...(deps.ids ? { ids: deps.ids } : {}),
        },
      );
      if (!edited.ok) return edited;
      const written = await commit(deps, timeline, edited.value.timeline, context);
      if (!written.ok) return written;
      return ok({
        result: {
          timelineId: written.value.id,
          revision: written.value.revision,
          affectedItemIds: affectedItems(timeline, written.value),
          frames: edited.value.frames,
        },
        inverse: { name: TIMELINE_COMMANDS.restore, payload: restorePayload(timeline, edited.value.changed) },
      });
    },
  });
}
