// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: the agent's comment tools (family `comments`), model-facing, so every schema converts to JSON Schema
 * (ulidSchema, plain integers for frames). `comments.list` reads a timeline's comments with where each one is now;
 * `comments.reply` answers one (COMMENT_COMMANDS.reply), naming the items its change touched by id. A comment's
 * words are the person's: marked untrusted, so the agent fences them as data.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/ids';
import { EDIT_ITEM_KINDS } from '../timeline/edit-target';
import { editItemMap, editTargetFrame, editTargetSpan, type EditItemMap } from '../timeline/edit-target-span';
import type { Timeline } from '../timeline/timeline-schema';
import { COMMENT_REPLY_STATUSES } from './comment-commands';
import {
  COMMENT_CHANGE_REFS_MAX,
  COMMENT_REPLY_MAX,
  COMMENT_STATUSES,
  MAX_TIMELINE_COMMENTS,
  type TimelineComment,
} from './comment-schema';

export const COMMENT_TOOLS = { list: 'comments.list', reply: 'comments.reply' } as const;

/** What a comment is on, flat: an item's kind, a stretch of time, or the whole video. */
export const COMMENT_ON = [...EDIT_ITEM_KINDS, 'range', 'timeline'] as const;
export type CommentOn = (typeof COMMENT_ON)[number];

const commentId = ulidSchema('TimelineComment');
const frame = z.int().nonnegative();

export const commentsListToolInputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  statuses: z
    .array(z.enum(COMMENT_STATUSES))
    .max(COMMENT_STATUSES.length)
    .optional()
    .describe('Which comments; default open and sent'),
});
export type CommentsListToolInput = z.output<typeof commentsListToolInputSchema>;

/**
 * One comment as the model reads it: what it is on, where that is now and the moment it points at (canvas frames),
 * and the person's words.
 */
export const commentToolViewSchema = z.object({
  commentId,
  status: z.enum(COMMENT_STATUSES),
  on: z.enum(COMMENT_ON),
  /** The clip's, text's, graphic's, caption's, audio's or transition's id; absent for a range or the video. */
  itemId: ulidSchema('TimelineItem').optional(),
  /** The anchor's span now; null when its item is gone. */
  start: frame.nullable(),
  end: frame.nullable(),
  /** The moment the comment points at, when it names one. */
  frame: frame.optional(),
  body: z.string().meta({ untrusted: 'user-comment' }),
  reply: z.string().optional(),
});
export type CommentToolView = z.output<typeof commentToolViewSchema>;

/**
 * One comment as a run gets it (the agent's run.started and its note to the model), as `comments.list` shows it,
 * where its anchor was when the run began.
 */
export const commentBatchItemSchema = commentToolViewSchema.omit({ status: true, reply: true });
export type CommentBatchItem = z.output<typeof commentBatchItemSchema>;

/** A comment as the model reads it, against the timeline as it is now. */
export function commentToolView(
  comment: TimelineComment,
  timeline: Timeline,
  items: EditItemMap = editItemMap(timeline),
): CommentToolView {
  const { anchor } = comment;
  const span = editTargetSpan(timeline, anchor, items);
  const frame = comment.at && span ? editTargetFrame(timeline, anchor, comment.at, items) : null;
  return {
    commentId: comment.id,
    status: comment.status,
    on: anchor.kind === 'item' ? anchor.itemKind : anchor.kind,
    ...(anchor.kind === 'item' ? { itemId: anchor.itemId as CommentToolView['itemId'] } : {}),
    start: span?.start ?? null,
    end: span?.end ?? null,
    ...(frame !== null ? { frame } : {}),
    body: comment.body,
    ...(comment.reply ? { reply: comment.reply } : {}),
  };
}

export const commentsListToolOutputSchema = z.object({
  timelineId: ulidSchema('Timeline'),
  revision: z.int().min(1),
  /** Frames per second is num/den. */
  rate: z.object({ num: z.int().positive(), den: z.int().positive() }),
  comments: z.array(commentToolViewSchema).max(MAX_TIMELINE_COMMENTS),
});
export type CommentsListToolOutput = z.output<typeof commentsListToolOutputSchema>;

export const commentReplyToolInputSchema = z.object({
  commentId,
  reply: z
    .string()
    .trim()
    .min(1)
    .max(COMMENT_REPLY_MAX)
    .describe('One line to the person: what you changed, or why you could not'),
  status: z
    .enum(COMMENT_REPLY_STATUSES)
    .describe('resolved when the change is made; open when you could not make it'),
  changed: z
    .array(ulidSchema('TimelineItem'))
    .max(COMMENT_CHANGE_REFS_MAX)
    .optional()
    .describe('Ids of the clips, texts, graphics, captions or audio your change touched'),
});
export type CommentReplyToolInput = z.output<typeof commentReplyToolInputSchema>;

export const commentReplyToolOutputSchema = z.object({ commentId, status: z.enum(COMMENT_STATUSES) });
export type CommentReplyToolOutput = z.output<typeof commentReplyToolOutputSchema>;
