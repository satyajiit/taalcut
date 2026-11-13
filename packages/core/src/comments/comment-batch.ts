// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: "Send N comments to Taalcut" as the agent gets it. A chat message carrying comment ids
 * (`messageExtrasShape.comments`) starts one run; at its start the agent reads the open ones on one timeline into a
 * batch (logged in run.started, so a resume or a replay answers the same comments), marks them sent to the run, and
 * the Editor answers each with `comments.reply`. When the run ends, a comment still sent goes back to open.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema, type RunId, type TimelineCommentId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { MAX_COMMENT_BATCH } from './comment-schema';
import { commentBatchItemSchema } from './comment-tools';

/** The open comments a run answers, on one timeline, where each was when the run began. */
export const commentBatchSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  /** The timeline's template, when it was made from one (the Editor's input names it). */
  templateId: ulidSchema('Template').optional(),
  revision: z.int().min(1),
  /** Frames per second is num/den. */
  rate: z.object({ num: z.int().positive(), den: z.int().positive() }),
  comments: z.array(commentBatchItemSchema).min(1).max(MAX_COMMENT_BATCH),
});
export type CommentBatch = z.output<typeof commentBatchSchema>;

/** What the agent asks of the comments for a batch (the library's, in the agent process). */
export interface CommentBatchPort {
  /**
   * The open comments among `ids`, on the first one's timeline, in that order; null when none is open (sent already,
   * answered, removed). Reads only.
   */
  open(ids: readonly TimelineCommentId[]): AsyncResult<CommentBatch | null>;
  /** The run has them: each goes from open to sent, for `runId` (comments.send). */
  send(batch: CommentBatch, runId: RunId): AsyncResult<void>;
  /** The run ended: each of its comments still sent goes back to open. Resolves how many did. */
  release(batch: CommentBatch, runId: RunId): AsyncResult<number>;
}
