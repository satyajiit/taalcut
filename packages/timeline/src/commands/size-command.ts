// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import {
  ConflictError,
  defineCommand,
  err,
  ok,
  SIMPLE_EDITOR_COMMANDS as N,
  simpleEditorPayloads as P,
  TIMELINE_COMMANDS,
  VIDEO_SIZES,
} from '@taalcut/core';
import { derivedIds } from '../model/derived-ids';
import { checkEdited } from '../model/validate';
import { noteTimelines, readFor, type CommandDeps } from './context';

/** Canvas geometry is normalized throughout text/graphics/reframing, preserving content and relative placement. */
export function makeSizeCommand(deps: CommandDeps) {
  return defineCommand({
    name: N.makeSize,
    payload: P[N.makeSize],
    sideEffect: 'write',
    handle: async (payload, context) => {
      const read = await readFor(deps.store, payload.timelineId, payload.projectId);
      if (!read.ok) return read;
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ ...read.value, revision: 0, updatedAt: 0 }))
        .digest('hex');
      if (
        context.replay === 'redo'
          ? payload.sourceFingerprint !== fingerprint
          : read.value.revision !== payload.revision
      )
        return err(ConflictError({ entity: 'timeline', id: payload.timelineId }));
      const source = structuredClone(read.value);
      // Stable identity on redo, independent of the time it runs again.
      const id = derivedIds<'Timeline'>(`size:${context.commandId}`, source.createdAt)();
      const copy = checkEdited({
        ...source,
        id,
        name: `${source.name.slice(0, 185)} (${payload.aspect})`,
        exportAtCanvasSize: true,
        canvas: { ...VIDEO_SIZES[payload.aspect], rate: source.canvas.rate },
        revision: 1,
        createdAt: deps.clock.now(),
        updatedAt: deps.clock.now(),
      });
      if (!copy.ok) return copy;
      const saved = await deps.store.create(copy.value, context);
      if (!saved.ok) return saved;
      noteTimelines(deps, context, { projectId: payload.projectId, change: 'created', ids: [id] });
      return ok({
        replayPayload: { ...payload, sourceFingerprint: fingerprint },
        result: { timelineId: id, revision: 1, affectedItemIds: [] },
        inverse: {
          name: TIMELINE_COMMANDS.discard,
          payload: { projectId: payload.projectId, timelineIds: [id] },
        },
      });
    },
  });
}
