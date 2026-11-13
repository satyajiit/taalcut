// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The Drizzle tables for a project's HyperFrames workspace (HFW1-WS, migration 41). */
import { COMMAND_SOURCES, type CommandId, type ProjectId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from '../schema/chat';

export const workspaceRevisions = sqliteTable(
  'workspace_revisions',
  {
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    base: integer('base').notNull(),
    /** Core's WorkspaceFile[] as JSON; read back through workspaceRevisionSchema. */
    files: text('files', { mode: 'json' }).$type<unknown>().notNull(),
    fileCount: integer('file_count').notNull(),
    bytes: integer('bytes').notNull(),
    origin: text('origin', { enum: COMMAND_SOURCES }).notNull(),
    /** The workspace.writeFiles that made it: its redo finds it again. */
    commandId: text('command_id').$type<CommandId>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.revision] }),
    uniqueIndex('workspace_revisions_command_uq')
      .on(t.commandId)
      .where(sql`${t.commandId} IS NOT NULL`),
  ],
);

export const workspaceHeads = sqliteTable('workspace_heads', {
  projectId: text('project_id')
    .$type<ProjectId>()
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** The revision the workspace is at; 0 is the empty workspace. */
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type WorkspaceRevisionRow = typeof workspaceRevisions.$inferSelect;
