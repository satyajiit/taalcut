// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for Saved on Instagram (migration 29): cached collections and
 * saved Reels metadata linked to templates.
 */
import type { TemplateId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { templates } from './templates';

export const instagramCollections = sqliteTable('instagram_collections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mediaCount: integer('media_count').notNull().default(0),
  coverUrl: text('cover_url'),
  watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
  autoBreakdown: integer('auto_breakdown', { mode: 'boolean' }).notNull().default(false),
  lastSyncedAt: integer('last_synced_at'),
  updatedAt: integer('updated_at').notNull(),
});

export const instagramSavedReels = sqliteTable(
  'instagram_saved_reels',
  {
    shortcode: text('shortcode').primaryKey(),
    mediaPk: text('media_pk').notNull(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => instagramCollections.id, { onDelete: 'cascade' }),
    permalink: text('permalink').notNull(),
    caption: text('caption'),
    authorHandle: text('author_handle'),
    durationMs: integer('duration_ms'),
    thumbnailUrl: text('thumbnail_url'),
    savedAt: integer('saved_at').notNull(),
    templateId: text('template_id')
      .$type<TemplateId>()
      .references(() => templates.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('instagram_saved_reels_collection_idx').on(t.collectionId, t.savedAt, t.shortcode),
    index('instagram_saved_reels_template_idx')
      .on(t.templateId)
      .where(sql`${t.templateId} IS NOT NULL`),
  ],
);
