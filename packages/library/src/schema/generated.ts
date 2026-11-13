// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle table for what the GeneratedAssetSink kept (P3-B6, P3-B7, P3-V6; migration 22): the project each file
 * was made for, and since when nothing refers to it (library.collect purges it 30 days after).
 */
import type { AssetId, ProjectId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { projects } from './chat';
import { assets } from './library';

export const generatedAssets = sqliteTable(
  'generated_assets',
  {
    assetId: text('asset_id')
      .$type<AssetId>()
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** The project it was made for; null for app-wide packs (or once that project is gone). */
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    /** Null while a timeline (or a saved version) uses it; set by the sink and by library.collect. */
    unreferencedSince: integer('unreferenced_since'),
  },
  (t) => [
    index('generated_assets_unreferenced_idx')
      .on(t.unreferencedSince)
      .where(sql`${t.unreferencedSince} IS NOT NULL`),
    index('generated_assets_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
  ],
);
