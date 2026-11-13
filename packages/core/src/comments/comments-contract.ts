// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.comments (EDT1-CMT), owner agent: read-only, served over the library's CommentStore; changes are
 * COMMENT_COMMANDS (`commands.dispatch`). The editor follows a timeline's comments with `watch`: the list now, then
 * the list again whenever one of them changes, which includes a timeline edit that moved a comment with its anchor
 * and a run answering one.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type TimelineId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { eventIterator, implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import {
  COMMENT_STATUSES,
  MAX_TIMELINE_COMMENTS,
  timelineCommentSchema,
  type TimelineComment,
} from './comment-schema';

const timelineId = idSchema<'Timeline'>();

export const commentsListInputSchema = z.object({
  timelineId,
  /** Absent: every status. */
  statuses: z.array(z.enum(COMMENT_STATUSES)).max(COMMENT_STATUSES.length).optional(),
});
export type CommentsListInput = z.output<typeof commentsListInputSchema>;

export const commentListSchema = z.array(timelineCommentSchema).max(MAX_TIMELINE_COMMENTS);

export const commentsContract = {
  /** The timeline's comments, oldest first. */
  list: ipc.input(commentsListInputSchema).output(commentListSchema),
  /** Every comment of the timeline now, then again after each change to one. */
  watch: ipc.input(z.object({ timelineId })).output(eventIterator(commentListSchema)),
};

/** What the agent process serves appContract.comments from (comments over the library's store). */
export interface CommentsService {
  list(input: CommentsListInput): AsyncResult<TimelineComment[]>;
  /** Throws a TaalcutError (e.g. timeline.not_found) to end the stream. */
  watch(timelineId: TimelineId, signal: AbortSignal): AsyncIterable<TimelineComment[]>;
}

const never = new AbortController().signal;

export function commentsRouter(service: CommentsService) {
  const os = implementContract(commentsContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await service.list(input))),
    watch: os.watch.handler(async function* ({ input, signal }) {
      yield* service.watch(input.timelineId, signal ?? never);
    }),
  });
}
