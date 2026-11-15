// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1: `timeline.designText`. The looks someone stated for the video's text become a Style of the video's own and
 * the video is pointed at it (styles/design-text.ts); every role the video's text uses must have one. Where the
 * text sits is `timeline.placeText`'s. One undo step: the video's Style and tracks as they were. The Style it made stays in the library, as any Style a
 * video stops using does; a redo finds it by the id the payload carries and makes no second one.
 */
import {
  ConflictError,
  defineCommand,
  designTextPayloadSchema,
  err,
  newId,
  NotFoundError,
  NotImplementedError,
  ok,
  TEXT_DESIGN_COMMAND,
  TIMELINE_COMMANDS,
  type AsyncResult,
  type Style,
  type StyleId,
} from '@taalcut/core';
import { InvalidMove } from '../errors';
import { designedStyle, designText, missingLooks } from '../styles/design-text';
import { commit, readFor, restorePayload, type CommandDeps } from './context';
import { affectedItems } from './mutation-receipt';

export function textDesignCommand(deps: CommandDeps) {
  /** The Style with this id, or null when there is none (an error for anything else). */
  async function find(styleId: StyleId): AsyncResult<Style | null> {
    const found = await deps.styles!.get(styleId);
    if (found.ok) return found;
    return NotFoundError.is(found.error) ? ok(null) : found;
  }

  return defineCommand({
    name: TEXT_DESIGN_COMMAND,
    payload: designTextPayloadSchema,
    sideEffect: 'write',
    handle: async (payload, context) => {
      const styles = deps.styles;
      if (!styles?.create) return err(NotImplementedError({ feature: 'timeline.styles' }));
      const current = await readFor(deps.store, payload.timelineId, payload.projectId);
      if (!current.ok) return current;
      if (
        payload.revision !== undefined &&
        context.replay !== 'redo' &&
        payload.revision !== current.value.revision
      )
        return err(ConflictError({ entity: 'timeline', id: payload.timelineId }));
      const timeline = current.value;
      const missing = missingLooks(timeline, payload.looks);
      if (missing) return err(InvalidMove(undefined, { detail: missing }));

      const styleId = payload.styleId ?? newId<'Style'>();
      const made = await find(styleId);
      if (!made.ok) return made;
      let style = made.value;
      if (!style) {
        const previous = timeline.styleId ? await find(timeline.styleId) : ok(null);
        if (!previous.ok) return previous;
        const designed = designedStyle({
          id: styleId,
          name: payload.name,
          looks: payload.looks,
          previous: previous.value,
          madeFrom: timeline.template
            ? { templateId: timeline.template.id, version: timeline.template.version }
            : (previous.value?.madeFrom ?? null),
          now: deps.clock.now(),
        });
        if (!designed.ok) return designed;
        const stored = await styles.create(designed.value, context);
        if (!stored.ok) return stored;
        style = stored.value;
      }

      const edited = designText(timeline, style, payload.looks);
      if (!edited.ok) return edited;
      const roles = payload.looks.map((entry) => entry.role);
      if (edited.value.changed.length === 0)
        return ok({
          result: {
            timelineId: timeline.id,
            revision: timeline.revision,
            affectedItemIds: [],
            styleId,
            roles,
          },
        });
      const written = await commit(deps, timeline, edited.value.timeline, context);
      if (!written.ok) return written;
      return ok({
        result: {
          timelineId: written.value.id,
          revision: written.value.revision,
          affectedItemIds: affectedItems(timeline, written.value),
          styleId,
          roles,
        },
        inverse: { name: TIMELINE_COMMANDS.restore, payload: restorePayload(timeline, edited.value.changed) },
      });
    },
  });
}
