// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * batch.applyStyle (P3-V16): one look on up to 50 videos in any projects, as one app-wide undo step
 * (`project: () => null`). Every video is read and edited before any is written, and the writes join the
 * command's one unit of work, so a missing video or a revision race fails the whole batch and nothing changes.
 * Its inverse, the internal batch.restoreStyles, puts back the Style and captions of each video still at the
 * revision the batch left; the others were changed since and keep their look (listed `changedSince`).
 */
import {
  BATCH_COMMANDS,
  batchCommandPayloads as payloads,
  defineCommand,
  ok,
  type AsyncResult,
  type CommandContext,
} from '@taalcut/core';
import { applyEdits, restoreEdits, type Edited, type RestorePayload } from './batch-edits';
import { commit, type CommandDeps } from './context';
import { affectedItems } from './mutation-receipt';

type RestoreItem = RestorePayload['items'][number];

/** Writes every edited video in the command's unit of work; the first refusal fails them all. */
async function writeAll(
  deps: CommandDeps,
  edited: readonly Edited[],
  context: CommandContext,
): AsyncResult<RestoreItem[]> {
  const restore: RestoreItem[] = [];
  for (const { before, edit } of edited) {
    if (edit.changed.length === 0) continue;
    const written = await commit(deps, before, edit.timeline, context);
    if (!written.ok) {
      // The whole batch fails: the videos already noted never change, so nothing is announced for them.
      deps.announcer.drop(context);
      return written;
    }
    restore.push({
      projectId: before.projectId,
      timelineId: before.id,
      styleId: before.styleId,
      captions: before.captions,
      revision: written.value.revision,
    });
  }
  return ok(restore);
}

export function createBatchCommands(deps: CommandDeps) {
  const apply = defineCommand({
    name: BATCH_COMMANDS.applyStyle,
    payload: payloads[BATCH_COMMANDS.applyStyle],
    sideEffect: 'write',
    project: () => null,
    affectedProjects: (payload) => payload.items.map((item) => item.projectId),
    handle: async (payload, context) => {
      const edits = await applyEdits(deps, payload, context.replay === 'redo');
      if (!edits.ok) return edits;
      const restore = await writeAll(deps, edits.value.edited, context);
      if (!restore.ok) return restore;
      const result = {
        ...edits.value.result,
        receipts: edits.value.edited.map(({ before, edit }) => ({
          timelineId: before.id,
          revision: before.revision + (edit.changed.length ? 1 : 0),
          affectedItemIds: affectedItems(before, edit.timeline),
        })),
      };
      if (restore.value.length === 0) return ok({ result });
      return ok({
        result,
        inverse: { name: BATCH_COMMANDS.restoreStyles, payload: { items: restore.value } },
      });
    },
  });

  const restore = defineCommand({
    name: BATCH_COMMANDS.restoreStyles,
    payload: payloads[BATCH_COMMANDS.restoreStyles],
    sideEffect: 'write',
    internal: true,
    project: () => null,
    affectedProjects: (payload) => payload.items.map((item) => item.projectId),
    // Undo runs this; redo runs batch.applyStyle again, so it needs no inverse of its own.
    handle: async (payload, context) => {
      const edits = await restoreEdits(deps, payload);
      if (!edits.ok) return edits;
      const written = await writeAll(deps, edits.value.edited, context);
      return written.ok ? ok({ result: edits.value.result }) : written;
    },
  });

  return { apply, restore, all: [apply, restore] };
}
