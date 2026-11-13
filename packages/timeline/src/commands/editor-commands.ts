// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: core's EDITOR_COMMANDS (split, delete, insert, duplicate, speed, transitions, colour, markers), each a
 * pure edit run through writeEdit, so each is one undo step with its re-sync. FIX-TRIM's slip is slip-command.ts. New items take ids from the command's
 * id (commandItemIds), so a redo makes the same ones and a chip still points at them.
 */
import {
  defineCommand,
  EDITOR_COMMANDS,
  editorCommandPayloads as payloads,
  ok,
  type CommandContext,
  type CommandOutcome,
  type AsyncResult,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { deleteClip } from '../edits/delete';
import { addMarker, setGrade } from '../edits/grade-marker';
import { duplicateClip } from '../edits/insert';
import { setSpeed } from '../edits/speed-edit';
import { splitClip } from '../edits/split';
import { removeTransition, setTransition } from '../edits/transition-edit';
import type { EditOptions, EditResult } from '../edits/types';
import { commandItemIds } from '../model/derived-ids';
import { writeEdit, type CommandDeps, type TimelineResult } from './context';
import { insertWith } from './insert-command';
import { createSlipCommand } from './slip-command';

type Made = EditResult & { readonly itemId?: TimelineItemId };
type Edit = (timeline: Timeline, options: EditOptions & { readonly ids: () => TimelineItemId }) => Result<Made> | AsyncResult<Made>;

/** Runs `edit` as a command and answers the item it made, if any, beside the revision. */
export async function writeMade(
  deps: CommandDeps,
  payload: { readonly projectId: Timeline['projectId']; readonly timelineId: Timeline['id'] },
  context: CommandContext,
  edit: Edit,
): AsyncResult<CommandOutcome<TimelineResult & { readonly itemId?: TimelineItemId }>> {
  const ids = deps.ids ?? commandItemIds(context.commandId);
  const options = { source: context.source, ids, ...(deps.config ? { config: deps.config } : {}) };
  let made: TimelineItemId | undefined;
  const written = await writeEdit(deps, payload, context, async (timeline) => {
    const edited = await edit(timeline, options);
    if (edited.ok && edited.value.itemId && edited.value.changed.length > 0) made = edited.value.itemId;
    return edited;
  });
  if (!written.ok || made === undefined) return written;
  return ok({ ...written.value, result: { ...written.value.result, itemId: made } });
}

export function createEditorCommands(deps: CommandDeps) {
  const split = defineCommand({
    name: EDITOR_COMMANDS.splitClip,
    payload: payloads[EDITOR_COMMANDS.splitClip],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => splitClip(timeline, payload, options)),
  });

  const remove = defineCommand({
    name: EDITOR_COMMANDS.deleteClip,
    payload: payloads[EDITOR_COMMANDS.deleteClip],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => deleteClip(timeline, payload, options)),
  });

  const insert = defineCommand({
    name: EDITOR_COMMANDS.insertClip,
    payload: payloads[EDITOR_COMMANDS.insertClip],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => insertWith(deps, timeline, payload, options)),
  });

  const duplicate = defineCommand({
    name: EDITOR_COMMANDS.duplicateClip,
    payload: payloads[EDITOR_COMMANDS.duplicateClip],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => duplicateClip(timeline, payload, options)),
  });

  const speed = defineCommand({
    name: EDITOR_COMMANDS.setSpeed,
    payload: payloads[EDITOR_COMMANDS.setSpeed],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => setSpeed(timeline, payload, options)),
  });

  const transition = defineCommand({
    name: EDITOR_COMMANDS.setTransition,
    payload: payloads[EDITOR_COMMANDS.setTransition],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => setTransition(timeline, payload, options)),
  });

  const untransition = defineCommand({
    name: EDITOR_COMMANDS.removeTransition,
    payload: payloads[EDITOR_COMMANDS.removeTransition],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => removeTransition(timeline, payload, options)),
  });

  const grade = defineCommand({
    name: EDITOR_COMMANDS.setGrade,
    payload: payloads[EDITOR_COMMANDS.setGrade],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => setGrade(timeline, payload, options)),
  });

  const marker = defineCommand({
    name: EDITOR_COMMANDS.addMarker,
    payload: payloads[EDITOR_COMMANDS.addMarker],
    sideEffect: 'write',
    handle: (payload, context) => writeMade(deps, payload, context, (timeline, options) => addMarker(timeline, payload, options.ids)),
  });

  const slip = createSlipCommand(deps);

  const all = [split, remove, insert, duplicate, speed, transition, untransition, grade, marker, slip];
  return { split, remove, insert, duplicate, speed, transition, untransition, grade, marker, slip, all };
}
