// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle mirrors of migration 45; creation stores validate JSON at their public boundaries. */
import type { ProjectId } from '@taalcut/core';
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './chat';

export const creationProjects = sqliteTable('creation_projects', {
  projectId: text('project_id')
    .$type<ProjectId>()
    .primaryKey()
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  state: text('state', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const authoredPrograms = sqliteTable(
  'authored_programs',
  {
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    hash: text('hash').notNull(),
    manifest: text('manifest', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.id, table.hash] })],
);
