// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's CommentStore (EDT1-CMT) over migration 40's `timeline_comments`. A comment is one row, replaced whole by
 * `put`; its timeline must exist when it is created. Writes given a CommandContext are staged on the command's unit
 * of work, so they commit with its audit row. Lists are oldest first.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type CommentFilter,
  type CommentStore,
  type Result,
  type TimelineComment,
  type TimelineCommentId,
} from '@taalcut/core';
import { and, asc, count, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { timelines } from '../schema/projects';
import { stagedWriter } from '../stores/staged-write';
import { commentColumns, parsedComment, rowComment, rowComments } from './comment-rows';
import { timelineComments } from './comment-table';

export interface CommentStoreOptions {
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

const MISSING = (id: string) => err(NotFoundError({ entity: 'comment', id }));

function filtered(filter: CommentFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];
  if (filter.statuses)
    parts.push(
      filter.statuses.length === 0 ? sql`0` : inArray(timelineComments.status, [...filter.statuses]),
    );
  if (filter.ids)
    parts.push(filter.ids.length === 0 ? sql`0` : inArray(timelineComments.id, [...filter.ids]));
  return and(...parts);
}

export function createCommentStore(db: LibraryDatabase, options: CommentStoreOptions = {}): CommentStore {
  const { orm } = db;
  const write = stagedWriter(db, options.commands, 'comment');
  const row = (id: TimelineCommentId) =>
    orm.select().from(timelineComments).where(eq(timelineComments.id, id)).get();
  const order = [asc(timelineComments.createdAt), asc(timelineComments.id)];

  /** The comment's timeline exists, in the comment's project. */
  function timelineOf(comment: TimelineComment): Result<void> {
    const found = orm
      .select({ projectId: timelines.projectId })
      .from(timelines)
      .where(eq(timelines.id, comment.timelineId))
      .get();
    if (!found) return err(NotFoundError({ entity: 'timeline', id: comment.timelineId }));
    return found.projectId === comment.projectId
      ? ok(undefined)
      : err(ValidationError({ field: 'projectId' }));
  }

  return {
    async create(comment, context) {
      const parsed = parsedComment(comment);
      if (!parsed.ok) return parsed;
      const check = (): Result<void> =>
        row(comment.id)
          ? err(ConflictError({ entity: 'comment', id: comment.id }))
          : timelineOf(parsed.value);
      const saved = write(
        context,
        check,
        () => void orm.insert(timelineComments).values(commentColumns(parsed.value)).run(),
      );
      return saved.ok ? parsed : saved;
    },

    async put(comment, context) {
      const parsed = parsedComment(comment);
      if (!parsed.ok) return parsed;
      const check = (): Result<void> => {
        const current = row(comment.id);
        if (!current) return MISSING(comment.id);
        return current.timelineId === comment.timelineId && current.projectId === comment.projectId
          ? ok(undefined)
          : err(ValidationError({ field: 'timelineId' }));
      };
      const saved = write(context, check, () => {
        orm
          .update(timelineComments)
          .set(commentColumns(parsed.value))
          .where(eq(timelineComments.id, comment.id))
          .run();
      });
      return saved.ok ? parsed : saved;
    },

    async get(commentId) {
      const found = row(commentId);
      return found ? rowComment(found) : MISSING(commentId);
    },

    async list(timelineId, filter = {}) {
      const rows = orm
        .select()
        .from(timelineComments)
        .where(and(eq(timelineComments.timelineId, timelineId), filtered(filter)))
        .orderBy(...order)
        .all();
      return rowComments(rows);
    },

    async count(timelineId) {
      const found = orm
        .select({ n: count() })
        .from(timelineComments)
        .where(eq(timelineComments.timelineId, timelineId))
        .get();
      return ok(found?.n ?? 0);
    },

    async listByProject(projectId, filter = {}) {
      const rows = orm
        .select()
        .from(timelineComments)
        .where(and(eq(timelineComments.projectId, projectId), filtered(filter)))
        .orderBy(...order)
        .all();
      return rowComments(rows);
    },

    async remove(commentId, context) {
      const check = () => (row(commentId) ? ok(undefined) : MISSING(commentId));
      return write(context, check, () => {
        orm.delete(timelineComments).where(eq(timelineComments.id, commentId)).run();
      });
    },
  };
}
