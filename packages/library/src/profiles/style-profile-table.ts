// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Drizzle tables for style profiles (LRN1-STY, migration 31): one derived profile per source set, and the set
 * each project is made like. JSON columns are read back through core's schemas.
 */
import type { ProjectId } from '@taalcut/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from '../schema/chat';

export const styleProfiles = sqliteTable('style_profiles', {
  /** core's styleSourceKey. */
  sourceKey: text('source_key').primaryKey(),
  /** What it was built from (templates' styleProfileDigest). */
  digest: text('digest').notNull(),
  /** core's StyleProfile as JSON; null while the set has no member. */
  profile: text('profile', { mode: 'json' }).$type<unknown>(),
  /** core's StyleProfileSummary as JSON. */
  summary: text('summary', { mode: 'json' }).$type<unknown>().notNull(),
  builtAt: integer('built_at').notNull(),
});

export const projectStyles = sqliteTable(
  'project_styles',
  {
    projectId: text('project_id')
      .$type<ProjectId>()
      .primaryKey()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('project_styles_source_idx').on(t.sourceKey)],
);

export type StyleProfileRow = typeof styleProfiles.$inferSelect;
