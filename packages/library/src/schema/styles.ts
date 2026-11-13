// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables for Styles (P3-V10, migration 20): one row per Style with its document, the template version a
 * look was made from and the logo it names; logos as content-addressed assets beside template assets.
 */
import { LOGO_MEDIA_TYPES, STYLE_KINDS, type StyleId, type TemplateId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const styles = sqliteTable(
  'styles',
  {
    id: text('id').$type<StyleId>().primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: STYLE_KINDS }).notNull(),
    revision: integer('revision').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    /** The Style as JSON; read back through core's styleSchema. */
    document: text('document', { mode: 'json' }).$type<unknown>().notNull(),
    madeFromTemplateId: text('made_from_template_id').$type<TemplateId>(),
    madeFromVersion: integer('made_from_version'),
    /** The logo's style asset (sha256), so an asset no Style names can be released. */
    logoAsset: text('logo_asset'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('styles_updated_idx').on(t.updatedAt, t.id),
    index('styles_made_from_idx')
      .on(t.madeFromTemplateId, t.madeFromVersion)
      .where(sql`${t.madeFromTemplateId} IS NOT NULL`),
    index('styles_logo_idx')
      .on(t.logoAsset)
      .where(sql`${t.logoAsset} IS NOT NULL`),
  ],
);

export const styleAssets = sqliteTable('style_assets', {
  sha256: text('sha256').primaryKey(),
  mediaType: text('media_type', { enum: LOGO_MEDIA_TYPES }).notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  /** When the last Style naming it stopped (or null while one does, or none ever did). */
  releasedAt: integer('released_at'),
});
