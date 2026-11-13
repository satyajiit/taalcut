// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, ShortsRunId } from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from '../schema/chat';

export const shortsRuns = sqliteTable(
  'shorts_runs',
  {
    id: text('id').$type<ShortsRunId>().primaryKey().notNull(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('shorts_runs_project_idx').on(table.projectId, table.updatedAt)],
);

export const shortsAnalysisCache = sqliteTable('shorts_analysis_cache', {
  key: text('key').primaryKey().notNull(),
  document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});
