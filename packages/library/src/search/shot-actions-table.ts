// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Drizzle table for what people in each shot are doing (LIB1-FIND, migration shot_actions): one row per shot
 * and action, written by the migration's trigger from the shot's analysis, read by the action filter and its
 * choices. `shot_fts.actions` has no Drizzle table: it is FTS5, queried with SQL.
 */
import type { ShotId } from '@taalcut/core';
import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { shots } from '../schema/library';

export const shotActions = sqliteTable(
  'shot_actions',
  {
    action: text('action').notNull(),
    shotId: text('shot_id')
      .$type<ShotId>()
      .notNull()
      .references(() => shots.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.action, t.shotId] }), index('shot_actions_shot_idx').on(t.shotId)],
);
