// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The Drizzle table for timeline comments (EDT1-CMT, migration 40). */
import {
  COMMENT_AUTHORS,
  COMMENT_STATUSES,
  type ProjectId,
  type RunId,
  type TimelineCommentId,
  type TimelineId,
} from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from '../schema/chat';
import { timelines } from '../schema/projects';

export const timelineComments = sqliteTable(
  'timeline_comments',
  {
    id: text('id').$type<TimelineCommentId>().primaryKey(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    timelineId: text('timeline_id')
      .$type<TimelineId>()
      .notNull()
      .references(() => timelines.id, { onDelete: 'cascade' }),
    /** Core's EditTarget as JSON; read back through timelineCommentSchema. */
    anchor: text('anchor', { mode: 'json' }).$type<unknown>().notNull(),
    at: text('at', { mode: 'json' }).$type<unknown>(),
    body: text('body').notNull(),
    author: text('author', { enum: COMMENT_AUTHORS }).notNull(),
    status: text('status', { enum: COMMENT_STATUSES }).notNull(),
    reply: text('reply'),
    changeRefs: text('change_refs', { mode: 'json' }).$type<unknown>(),
    runId: text('run_id').$type<RunId>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('timeline_comments_timeline_idx').on(t.timelineId, t.createdAt, t.id),
    index('timeline_comments_project_idx').on(t.projectId, t.status),
  ],
);

export type CommentRow = typeof timelineComments.$inferSelect;
