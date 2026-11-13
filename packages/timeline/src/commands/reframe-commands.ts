// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.setReframe (P3-V2): which part of a video clip's source shows and how zoomed. A caller may name the
 * revision it read (the agent's tool does; the reframe panel doesn't), so a change made meanwhile is
 * `core.conflict` rather than lost. A redo re-runs the stored payload after undo itself made a new revision, so it
 * skips that check (review M10), as `captions.applyTranslation` does.
 */
import {
  ConflictError,
  defineCommand,
  err,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
} from '@taalcut/core';
import { setReframe } from '../edits/reframe';
import { setVisualLayout } from '../edits/visual-layout';
import { writeEdit, type CommandDeps } from './context';

export function createReframeCommands(deps: CommandDeps) {
  const reframe = defineCommand({
    name: TIMELINE_COMMANDS.setReframe,
    payload: payloads[TIMELINE_COMMANDS.setReframe],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => {
        const stale = payload.revision !== undefined && payload.revision !== timeline.revision;
        if (stale && context.replay !== 'redo')
          return err(
            ConflictError(
              { entity: 'timeline', id: timeline.id },
              { detail: `revision is ${timeline.revision}` },
            ),
          );
        return setReframe(timeline, payload, {
          source: context.source,
          ...(deps.config ? { config: deps.config } : {}),
          ...(deps.ids ? { ids: deps.ids } : {}),
        });
      }),
  });
  const layout = defineCommand({
    name: TIMELINE_COMMANDS.setVisualLayout,
    payload: payloads[TIMELINE_COMMANDS.setVisualLayout],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) =>
        setVisualLayout(timeline, payload, { source: context.source }),
      ),
  });
  return { reframe, layout, all: [reframe, layout] };
}
