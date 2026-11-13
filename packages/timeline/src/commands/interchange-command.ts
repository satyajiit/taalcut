// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.exportInterchange (P3-V5): writes an OTIO or FCPXML file of a timeline at its current (or the named)
 * revision. Audited so the agent and the export dialog share one path; it changes nothing in the app, so it has
 * no inverse and nothing to undo.
 */
import {
  ConflictError,
  defineCommand,
  err,
  NotImplementedError,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
} from '@taalcut/core';
import { exportInterchange } from '../interchange/export-interchange';
import { readFor, type CommandDeps } from './context';

export function createInterchangeCommands(deps: CommandDeps) {
  const exportFile = defineCommand({
    name: TIMELINE_COMMANDS.exportInterchange,
    payload: payloads[TIMELINE_COMMANDS.exportInterchange],
    sideEffect: 'write',
    handle: async (payload) => {
      if (!deps.interchange) return err(NotImplementedError({ feature: 'timeline.interchange' }));
      const timeline = await readFor(deps.store, payload.timelineId, payload.projectId);
      if (!timeline.ok) return timeline;
      if (payload.revision !== undefined && payload.revision !== timeline.value.revision)
        return err(
          ConflictError(
            { entity: 'timeline', id: payload.timelineId },
            { detail: `revision is ${timeline.value.revision}, not ${payload.revision}` },
          ),
        );
      const written = await exportInterchange(
        deps.interchange,
        timeline.value,
        payload.format,
        payload.pathStyle,
      );
      return written.ok ? ok({ result: written.value }) : written;
    },
  });
  return { exportFile, all: [exportFile] };
}
