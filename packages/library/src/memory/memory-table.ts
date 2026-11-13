// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Drizzle table for memory items (LRN1-MEM, migration 30). `memory_fts` has no Drizzle table: it is FTS5,
 * queried with SQL and kept in step by the migration's triggers.
 */
import {
  MEMORY_DATA_KINDS,
  MEMORY_SCOPES,
  MEMORY_SOURCES,
  type ConversationId,
  type MemoryId,
  type ProjectId,
  type TemplateId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { conversations, projects } from '../schema/chat';
import { templates } from '../schema/templates';

export const memoryItems = sqliteTable(
  'memory_items',
  {
    id: text('id').$type<MemoryId>().primaryKey(),
    scope: text('scope', { enum: MEMORY_SCOPES }).notNull(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .$type<TemplateId>()
      .references(() => templates.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    source: text('source', { enum: MEMORY_SOURCES }).notNull(),
    dataKind: text('data_kind', { enum: MEMORY_DATA_KINDS }),
    /** Core's MemoryData as JSON; read back through memoryDataSchema. */
    data: text('data', { mode: 'json' }).$type<unknown>(),
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .references(() => conversations.id, { onDelete: 'set null' }),
    revision: integer('revision').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('memory_items_updated_idx').on(t.updatedAt, t.id),
    index('memory_items_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    index('memory_items_template_idx')
      .on(t.templateId)
      .where(sql`${t.templateId} IS NOT NULL`),
    index('memory_items_data_kind_idx')
      .on(t.dataKind)
      .where(sql`${t.dataKind} IS NOT NULL`),
  ],
);

export type MemoryRow = typeof memoryItems.$inferSelect;
