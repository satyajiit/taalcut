// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeline comments as stored (EDT1-CMT). @taalcut/library implements the store (its comments migration) and
 * registers it as CommentStoreToken in the agent process; writes with a CommandContext are staged in the command's
 * unit of work, so they commit with its audit row or not at all. A comment belongs to its timeline: deleting the
 * timeline or its project deletes its comments. The library also moves comments with their anchors whenever a
 * timeline is written (see comment-schema.ts).
 */
import type { ProjectId, TimelineCommentId, TimelineId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { CommentStatus, TimelineComment } from './comment-schema';

export interface CommentFilter {
  /** Absent: every status; empty: none. */
  readonly statuses?: readonly CommentStatus[];
  /** Only these comments. Absent: all of the timeline's. */
  readonly ids?: readonly TimelineCommentId[];
}

export interface CommentStore {
  /** core.conflict when the id exists; core.not_found (entity 'timeline') when its timeline doesn't. */
  create(comment: TimelineComment, context?: CommandContext): AsyncResult<TimelineComment>;
  /** Replaces a comment (its id, project and timeline stay); core.not_found (entity 'comment') when gone. */
  put(comment: TimelineComment, context?: CommandContext): AsyncResult<TimelineComment>;
  /** core.not_found (entity 'comment'). */
  get(commentId: TimelineCommentId): AsyncResult<TimelineComment>;
  /** The timeline's comments that match, oldest first. */
  list(timelineId: TimelineId, filter?: CommentFilter): AsyncResult<TimelineComment[]>;
  /** How many comments the timeline keeps. */
  count(timelineId: TimelineId): AsyncResult<number>;
  /** The project's comments in these statuses, oldest first (a project's open notes, a run's sent ones). */
  listByProject(projectId: ProjectId, filter?: CommentFilter): AsyncResult<TimelineComment[]>;
  /** core.not_found (entity 'comment'). */
  remove(commentId: TimelineCommentId, context?: CommandContext): AsyncResult<void>;
}

export const CommentStoreToken = createToken<CommentStore>('core.commentStore');
