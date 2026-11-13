// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: comment command names and payloads, so the editor, ⌘K, the agent's chat service and its comment tools
 * dispatch them typed. Handlers: @taalcut/library. Each joins its project's history.
 *
 * - add, edit, remove and setStatus are a person's (the editor's Comments tab, pins and inspector): undoable, their
 *   inverse the internal `comments.restore` with the whole previous comment (null: it didn't exist).
 * - send (open → sent, with the run's id) is the agent's chat service's when a message carries comments. It has no
 *   inverse: ⌘Z never takes back what was sent.
 * - reply is the agent's answer (`comments.reply` tool): one line, resolved or back to open, and what it changed.
 *   Undoing it (with the run's changes) puts the comment back to open without the reply.
 *
 * Who may write what: an author is set from the source (a person's comment is `user`, anything else `agent`). Only a
 * person changes, removes, resolves or dismisses a `user` comment (core.comment_not_yours otherwise); anyone else may
 * only reopen a sent one, which is how a run gives back what it didn't answer. Nothing answers a dismissed comment.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { defineError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { editTargetSchema } from '../timeline/edit-target';
import {
  COMMENT_CHANGE_REFS_MAX,
  commentAtSchema,
  commentBodySchema,
  commentChangeRefSchema,
  commentReplySchema,
  MAX_COMMENT_BATCH,
  timelineCommentSchema,
  type CommentStatus,
} from './comment-schema';

export const COMMENT_COMMANDS = {
  /** write; inverse comments.restore (null). The anchor must be on the timeline now. */
  add: 'comments.add',
  /** write: its words, what it's on or the moment in it; inverse comments.restore. */
  edit: 'comments.edit',
  /** write: undo brings it back; inverse comments.restore. */
  remove: 'comments.remove',
  /** write: resolve, dismiss or reopen; inverse comments.restore. */
  setStatus: 'comments.setStatus',
  /** write, no inverse: the open ones among `commentIds` go to `runId` (status sent). */
  send: 'comments.send',
  /** write: the agent's answer; inverse comments.restore (the comment open again, no reply). */
  reply: 'comments.reply',
  /** Internal: every other comment command's inverse. */
  restore: 'comments.restore',
  /** Server-only: reopen comments still sent to the ending run, with no undo entry. */
  releaseRun: 'comments.releaseRun',
} as const;

/** What a person may set a comment to (sent is only ever set by `comments.send`). */
export const COMMENT_SET_STATUSES = [
  'open',
  'resolved',
  'dismissed',
] as const satisfies readonly CommentStatus[];
/** How a reply leaves the comment: done, or still open with the reason as the reply. */
export const COMMENT_REPLY_STATUSES = ['resolved', 'open'] as const satisfies readonly CommentStatus[];

const timeline = { projectId: idSchema<'Project'>(), timelineId: idSchema<'Timeline'>() };
const commentId = idSchema<'TimelineComment'>();
const sameTimeline = (payload: { timelineId: string; anchor?: { timelineId: string } | undefined }) =>
  !payload.anchor || payload.anchor.timelineId === payload.timelineId;
const onTimeline = { message: 'The anchor is on another timeline', path: ['anchor'] };

export const commentCommandPayloads = {
  [COMMENT_COMMANDS.add]: z
    .object({
      ...timeline,
      commentId,
      anchor: editTargetSchema,
      at: commentAtSchema.optional(),
      body: commentBodySchema,
    })
    .refine(sameTimeline, onTimeline),
  [COMMENT_COMMANDS.edit]: z.object({
    ...timeline,
    commentId,
    patch: z
      .object({
        body: commentBodySchema,
        anchor: editTargetSchema,
        /** null: about the whole of its anchor. */
        at: commentAtSchema.nullable(),
      })
      .partial()
      .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' }),
  }),
  [COMMENT_COMMANDS.remove]: z.object({ ...timeline, commentId }),
  [COMMENT_COMMANDS.setStatus]: z.object({ ...timeline, commentId, status: z.enum(COMMENT_SET_STATUSES) }),
  [COMMENT_COMMANDS.send]: z.object({
    ...timeline,
    commentIds: z.array(commentId).min(1).max(MAX_COMMENT_BATCH),
    runId: idSchema<'AgentRun'>(),
  }),
  [COMMENT_COMMANDS.releaseRun]: z.object({
    ...timeline,
    commentIds: z.array(commentId).min(1).max(MAX_COMMENT_BATCH),
    runId: idSchema<'AgentRun'>(),
  }),
  [COMMENT_COMMANDS.reply]: z.object({
    ...timeline,
    commentId,
    reply: commentReplySchema,
    status: z.enum(COMMENT_REPLY_STATUSES),
    changeRefs: z.array(commentChangeRefSchema).max(COMMENT_CHANGE_REFS_MAX).default([]),
  }),
  [COMMENT_COMMANDS.restore]: z.object({ ...timeline, commentId, comment: timelineCommentSchema.nullable() }),
};

/** `comments.send`'s result: the comments it sent, in the order asked (the ones that weren't open are left out). */
export const commentSendResultSchema = z.object({ sent: z.array(commentId).max(MAX_COMMENT_BATCH) });
export type CommentSendResult = z.output<typeof commentSendResultSchema>;

/** Someone other than a person tried to change, remove, resolve or dismiss a person's comment. */
export const CommentNotYours = defineError('core.comment_not_yours');
/** A reply to a comment the person dismissed, or a reopen of one that wasn't sent. */
export const CommentClosed = defineError<{ status: CommentStatus }>('core.comment_closed');
/** The comment's anchor isn't on the timeline (any more): nothing to comment on. */
export const CommentTargetGone = defineError('core.comment_target_gone');
/** The timeline already keeps MAX_TIMELINE_COMMENTS comments. */
export const CommentsFull = defineError<{ limit: number }>('core.comments_full');
