// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `comments.restore` (EDT1-CMT): every other comment command's inverse. Puts the comment back as it was, or removes
 * it when it didn't exist (an add undone). Internal: only undo and redo run it.
 */
import {
  COMMENT_COMMANDS,
  commentCommandPayloads,
  defineCommand,
  ok,
  type CommandContext,
  type CommentStore,
  type ProjectId,
  type TimelineCommentId,
} from '@taalcut/core';

const N = COMMENT_COMMANDS;

export interface CommentRestoreDeps {
  readonly store: CommentStore;
  readonly changed: (
    context: CommandContext,
    projectId: ProjectId,
    change: 'created' | 'updated' | 'deleted',
    ids: readonly TimelineCommentId[],
  ) => void;
}

export function commentRestore({ store, changed }: CommentRestoreDeps) {
  return defineCommand({
    name: N.restore,
    payload: commentCommandPayloads[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ projectId, commentId, comment }, context) => {
      const found = await store.get(commentId);
      if (!found.ok && found.error.code !== 'core.not_found') return found;
      if (comment === null) {
        if (!found.ok) return ok({ result: { commentId } });
        const removed = await store.remove(commentId, context);
        if (!removed.ok) return removed;
        changed(context, projectId, 'deleted', [commentId]);
        return ok({ result: { commentId } });
      }
      const stored = found.ok ? await store.put(comment, context) : await store.create(comment, context);
      if (!stored.ok) return stored;
      changed(context, projectId, found.ok ? 'updated' : 'created', [commentId]);
      return ok({ result: { commentId } });
    },
  });
}
