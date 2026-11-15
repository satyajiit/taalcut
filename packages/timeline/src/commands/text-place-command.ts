// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: `timeline.placeText`. Each group of the video's text goes where it was stated, at the size stated
 * (styles/place-text.ts): exactly, with no safe area, no smallest size and no refusal about where or how large.
 * One undo step: the tracks as they were.
 */
import {
  ConflictError,
  defineCommand,
  err,
  ok,
  placeTextPayloadSchema,
  TEXT_PLACE_COMMAND,
  TIMELINE_COMMANDS,
} from '@taalcut/core';
import { placeText } from '../styles/place-text';
import { commit, readFor, restorePayload, type CommandDeps } from './context';
import { affectedItems } from './mutation-receipt';

export function textPlaceCommand(deps: CommandDeps) {
  return defineCommand({
    name: TEXT_PLACE_COMMAND,
    payload: placeTextPayloadSchema,
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
      const found = timeline.template && deps.templates ? await deps.templates.read(timeline.template) : null;
      const edited = placeText(timeline, found?.ok ? found.value : null, payload.groups, {
        source: context.source,
      });
      if (!edited.ok) return edited;
      if (edited.value.changed.length === 0)
        return ok({
          result: { timelineId: timeline.id, revision: timeline.revision, affectedItemIds: [], placed: 0 },
        });
      const written = await commit(deps, timeline, edited.value.timeline, context);
      if (!written.ok) return written;
      return ok({
        result: {
          timelineId: written.value.id,
          revision: written.value.revision,
          affectedItemIds: affectedItems(timeline, written.value),
          placed: edited.value.placed.length,
        },
        inverse: { name: TIMELINE_COMMANDS.restore, payload: restorePayload(timeline, edited.value.changed) },
      });
    },
  });
}
