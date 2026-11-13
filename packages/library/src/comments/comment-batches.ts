// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's CommentBatchPort over the comment store and the bus (EDT1-CMT): the agent reads the open comments a message
 * sent into a batch on one timeline, marks them sent to its run, and at the run's end gives back the ones it left
 * unanswered. The commands are the agent's, for the run (`agent:<runId>`), as its tools' are.
 */
import {
  COMMENT_COMMANDS,
  commentToolView,
  editItemMap,
  ok,
  upgradeTimeline,
  type CommandBus,
  type CommandOrigin,
  type CommentBatch,
  type CommentBatchPort,
  type CommentStore,
  type RunId,
  type TimelineComment,
  type TimelineStore,
} from '@taalcut/core';

export interface CommentBatchDeps {
  readonly store: CommentStore;
  readonly timelines: Pick<TimelineStore, 'get'>;
  readonly bus: Pick<CommandBus, 'dispatch' | 'lifecycle'>;
}

const asRun = (runId: RunId): CommandOrigin => ({ source: 'agent', actor: `agent:${runId}` });

export function createCommentBatches({ store, timelines, bus }: CommentBatchDeps): CommentBatchPort {
  return {
    async open(ids) {
      const found: TimelineComment[] = [];
      for (const id of new Set(ids)) {
        const comment = await store.get(id);
        if (!comment.ok) {
          if (comment.error.code === 'core.not_found') continue;
          return comment;
        }
        if (comment.value.status === 'open') found.push(comment.value);
      }
      const first = found[0];
      if (!first) return ok(null);
      const stored = await timelines.get(first.timelineId);
      if (!stored.ok) return stored;
      const timeline = upgradeTimeline(stored.value.json, stored.value.schemaVersion);
      if (!timeline.ok) return timeline;
      const items = editItemMap(timeline.value);
      const templateId = stored.value.summary.template?.id;
      const { num, den } = timeline.value.canvas.rate;
      return ok({
        projectId: first.projectId,
        timelineId: first.timelineId,
        ...(templateId ? { templateId } : {}),
        revision: timeline.value.revision,
        rate: { num, den },
        comments: found
          .filter((comment) => comment.timelineId === first.timelineId)
          .map((comment) => {
            const {
              status: _status,
              reply: _reply,
              ...item
            } = commentToolView(comment, timeline.value, items);
            return item;
          }),
      } as CommentBatch);
    },

    async send(batch, runId) {
      const sent = await bus.dispatch(
        COMMENT_COMMANDS.send,
        {
          projectId: batch.projectId,
          timelineId: batch.timelineId,
          commentIds: batch.comments.map((comment) => comment.commentId),
          runId,
        },
        asRun(runId),
      );
      return sent.ok ? ok(undefined) : sent;
    },

    async release(batch, runId) {
      const result = await bus.lifecycle(
        COMMENT_COMMANDS.releaseRun,
        {
          projectId: batch.projectId,
          timelineId: batch.timelineId,
          commentIds: batch.comments.map((comment) => comment.commentId),
          runId,
        },
        runId,
      );
      return result.ok ? ok((result.value.result as { released: number }).released) : result;
    },
  };
}
